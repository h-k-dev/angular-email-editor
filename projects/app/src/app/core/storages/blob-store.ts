import { DOCUMENT, DestroyRef, Service, inject } from '@angular/core';

const DATABASE = 'angular-email-editor';
const STORE = 'blobs';

/**
 * Bytes by key, in IndexedDB — what localStorage cannot hold: it stores
 * strings, so a blob would go in as base64 (a third bigger) against a quota
 * of a few megabytes. IndexedDB keeps a Blob as a Blob.
 *
 * Deliberately a key-value store and nothing more: one object store, no
 * indexes, no queries. Every operation opens the database lazily and
 * degrades instead of throwing — where IndexedDB is missing or refuses to
 * open (a private mode, a test DOM), reads find nothing and writes report
 * `false`, so a caller keeps working without the bytes.
 *
 * Not reactive: IndexedDB has no change event. A caller that shares keys
 * across tabs signals the change some other way and reads here on demand.
 */
@Service()
export class BlobStore {
  readonly #factory = inject(DOCUMENT).defaultView?.indexedDB ?? null;
  #database: Promise<IDBDatabase | null> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => void this.#database?.then((database) => database?.close()));
  }

  /** The blob under the key; `undefined` when there is none. */
  async get(key: string): Promise<Blob | undefined> {
    const database = await this.#open();
    if (!database) return undefined;
    try {
      const value = await request(
        database.transaction(STORE, 'readonly').objectStore(STORE).get(key),
      );
      return value instanceof Blob ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /** Writes every entry in one transaction — all of them or none — and
      reports whether they were stored. */
  async put(entries: readonly (readonly [key: string, blob: Blob])[]): Promise<boolean> {
    if (!entries.length) return true;
    return this.#write((store) => {
      for (const [key, blob] of entries) store.put(blob, key);
    });
  }

  /** Removes the keys, in one transaction. */
  async delete(keys: readonly string[]): Promise<boolean> {
    if (!keys.length) return true;
    return this.#write((store) => {
      for (const key of keys) store.delete(key);
    });
  }

  /** Removes everything. */
  async clear(): Promise<boolean> {
    return this.#write((store) => store.clear());
  }

  /** Every key held. */
  async keys(): Promise<string[]> {
    const database = await this.#open();
    if (!database) return [];
    try {
      const keys = await request(
        database.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys(),
      );
      return keys.filter((key): key is string => typeof key === 'string');
    } catch {
      return [];
    }
  }

  async #write(work: (store: IDBObjectStore) => void): Promise<boolean> {
    const database = await this.#open();
    if (!database) return false;
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      work(transaction.objectStore(STORE));
      await completion(transaction);
      return true;
    } catch {
      return false;
    }
  }

  /** Opens the database once and shares the connection. A connection an
      upgrade elsewhere asks to close (a newer version of the app in another
      tab) is closed and forgotten; the next operation opens it again. */
  #open(): Promise<IDBDatabase | null> {
    if (this.#database) return this.#database;
    const factory = this.#factory;
    if (!factory) return (this.#database = Promise.resolve(null));
    this.#database = new Promise<IDBDatabase | null>((resolve) => {
      let opening: IDBOpenDBRequest;
      try {
        opening = factory.open(DATABASE, 1);
      } catch {
        resolve(null);
        return;
      }
      opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
      opening.onsuccess = () => {
        const database = opening.result;
        database.onversionchange = () => {
          database.close();
          this.#database = null;
        };
        resolve(database);
      };
      // Blocked (an older connection still open) is not a failure: that
      // connection hears versionchange and closes, and success follows.
      opening.onerror = () => resolve(null);
    });
    return this.#database;
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
