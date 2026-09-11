import {
  InjectionToken,
  Service,

  // Singals
  Signal,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  Attachment,
  AttachmentChipOptions,
  AttachmentStatus,
  simulatedDuration,
} from 'angular-email-editor';

/** The pacing of a simulated transfer: the line's speed and the bounds on
    how long one runs — the library's own pacing shape, so the store and
    the chip's fake speak the same terms. */
export type AttachmentUploadLine = Omit<AttachmentChipOptions, 'linger'>;

/**
 * What the composer keeps of an attachment once it is handed off: a local
 * key to track it by, the metadata a chip draws, and the id the store gave
 * it — `null` until the upload settles. Never the bytes: a real host uploads
 * on drop and remembers only the reference, and this demo does the same.
 */
export interface AttachmentRef extends Attachment {
  /** Local identity, from the moment of the drop. */
  readonly key: string;
  /** The store's id, once the upload is done; `null` while it is in flight. */
  readonly id: string | null;
}

/** How the simulated store paces itself. */
export interface AttachmentUploadOptions {
  /** How often a transfer reports while its bytes move, in ms. */
  readonly tick: number;
  /** The line preprocessing runs over — what a real store spends
      fingerprinting a file or scanning it for viruses, a stretch that has
      no number. Paced by size like the upload, since it reads the same
      bytes and, when the scan is on the far side, crosses the same network.
      Every file preprocesses at once: nothing competes for it. */
  readonly preprocess: AttachmentUploadLine;
  /** How many transfers may upload at once. The rest wait their turn, in
      the order they finished preprocessing — the cap a real store puts on
      its connections, so progress stays honest and the backend stays safe. */
  readonly concurrency: number;
  /** How long the full bar stays before the transfer settles, in ms — so
      100% is something the eye gets to see, not a frame on the way out. */
  readonly linger: number;
  /** The line the bytes move over. A mobile-class uplink by default, so a
      small file and a middling one visibly take different times — the
      library's own default is a fast line that clamps both to its floor. */
  readonly line: AttachmentUploadLine;
}

/** Overrides for the simulated store. Specs shorten them all. `preprocess`
    and `line` are replaced whole, not merged. */
export const ATTACHMENT_UPLOAD_OPTIONS = new InjectionToken<Partial<AttachmentUploadOptions>>(
  'ATTACHMENT_UPLOAD_OPTIONS',
  { factory: () => ({}) },
);

const DEFAULT_OPTIONS: AttachmentUploadOptions = {
  tick: 50,
  // Faster than the upload but of the same order, so a file that uploads
  // slowly was seen to scan slowly first: 760 KB scans in the 400 ms floor,
  // 2.5 MB in about 1.2 s, and past 8 MB the 4 s ceiling holds.
  preprocess: {
    bytesPerSecond: 2 * 1024 * 1024,
    minDuration: 400,
    maxDuration: 4000,
    fallbackDuration: 800,
  },
  concurrency: 2,
  linger: 700,
  // About 12 Mbit/s up — a decent 4G connection. 760 KB takes half a
  // second, 2.5 MB close to two, and anything past 12 MB hits the ceiling.
  line: {
    bytesPerSecond: 1.5 * 1024 * 1024,
    minDuration: 400,
    maxDuration: 8000,
    fallbackDuration: 1500,
  },
};

/** One transfer as the store sees it: its stage, and how far along the
    bytes are while they move. */
interface Transfer {
  readonly status: AttachmentStatus;
  readonly progress: number | null;
}

const NONE: Signal<Transfer | null> = signal(null).asReadonly();

/**
 * The upload-on-drop store, simulated — through the stages a real one goes
 * through, over the connections a real one has. A dropped file is first
 * `preprocessing` (fingerprinted, scanned: a stretch with nothing to count,
 * so the chip sweeps), then `queued` until one of the store's connections
 * is free, then `uploading` over the store's line (`simulatedDuration`: the
 * size over the line's speed, clamped — a mobile-class line, so sizes tell
 * apart), so the strip shows real, determinate progress from here instead
 * of playing a fake. The full bar lingers a moment, and then the
 * transfer is `complete` and the reference gets its id.
 *
 * Only references leave this service: the composer's form holds
 * `AttachmentRef`s, its rule blocks a send while any id is still `null`, and
 * the chips read their status and progress here by key.
 */
@Service()
export class AttachmentUploads {
  readonly #options = { ...DEFAULT_OPTIONS, ...inject(ATTACHMENT_UPLOAD_OPTIONS) };
  readonly #transfers = new Map<string, WritableSignal<Transfer>>();
  readonly #settled = new Map<string, (id: string) => void>();
  readonly #done = new Map<string, Promise<string>>();
  readonly #sizes = new Map<string, number | undefined>();
  /** Whatever stops a transfer's current timer, by key. */
  readonly #stop = new Map<string, () => void>();
  /** Preprocessed, waiting for a connection — first in, first out. */
  readonly #waiting: string[] = [];
  /** Holding a connection right now. */
  readonly #uploading = new Set<string>();
  #next = 0;

  /** Begins a transfer and returns its reference — id still `null`. */
  start(attachment: Attachment): AttachmentRef {
    const key = `upload-${++this.#next}`;
    this.#transfers.set(key, signal<Transfer>({ status: 'preprocessing', progress: null }));
    this.#sizes.set(key, attachment.size);
    this.#done.set(key, new Promise<string>((resolve) => this.#settled.set(key, resolve)));

    // Preprocessing runs for every file at once, paced by its size; a
    // connection is what it waits for afterwards.
    const timer = setTimeout(
      () => {
        this.#stop.delete(key);
        this.#transfers.get(key)?.set({ status: 'queued', progress: null });
        this.#waiting.push(key);
        this.#pump();
      },
      simulatedDuration(attachment.size, this.#options.preprocess),
    );
    this.#stop.set(key, () => clearTimeout(timer));

    return {
      key,
      id: null,
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
    };
  }

  /** Which stage a transfer is in; `null` for a key this store never saw. */
  status(key: string): Signal<AttachmentStatus | null> {
    const transfer = this.#transfers.get(key) ?? NONE;
    return computed(() => transfer()?.status ?? null);
  }

  /** How far a transfer is, 0–1, while the bytes move; `null` while there
      is nothing to count, and for a key this store never saw. */
  progress(key: string): Signal<number | null> {
    const transfer = this.#transfers.get(key) ?? NONE;
    return computed(() => transfer()?.progress ?? null);
  }

  /** Resolves with the store's id once the transfer settles. A cancelled
      transfer never resolves — whoever waited has already let go. */
  whenDone(key: string): Promise<string> {
    return this.#done.get(key) ?? new Promise<string>(() => {});
  }

  /** Stops a transfer and forgets it — the chip was removed mid-flight. A
      waiting transfer leaves the line; an uploading one frees its
      connection for the next in line. */
  cancel(key: string): void {
    this.#stop.get(key)?.();
    this.#stop.delete(key);
    const waiting = this.#waiting.indexOf(key);
    if (waiting >= 0) this.#waiting.splice(waiting, 1);
    this.#uploading.delete(key);
    this.#transfers.delete(key);
    this.#sizes.delete(key);
    this.#settled.delete(key);
    this.#done.delete(key);
    this.#pump();
  }

  /** Hands free connections to whoever has waited longest. */
  #pump(): void {
    while (this.#uploading.size < this.#options.concurrency && this.#waiting.length) {
      this.#upload(this.#waiting.shift()!);
    }
  }

  /** Moves a transfer's bytes over one connection, then settles it. */
  #upload(key: string): void {
    const transfer = this.#transfers.get(key);
    if (!transfer) return;
    this.#uploading.add(key);
    const { linger } = this.#options;
    const duration = simulatedDuration(this.#sizes.get(key), this.#options.line);
    const started = Date.now();
    transfer.set({ status: 'uploading', progress: 0 });
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      transfer.set({ status: 'uploading', progress: Math.min(1, elapsed / duration) });
      // Full, but let it be seen before it goes.
      if (elapsed < duration + linger) return;
      clearInterval(timer);
      this.#stop.delete(key);
      this.#uploading.delete(key);
      transfer.set({ status: 'complete', progress: 1 });
      this.#settled.get(key)?.(`att_${key.slice('upload-'.length)}`);
      this.#pump();
    }, this.#options.tick);
    this.#stop.set(key, () => clearInterval(timer));
  }
}
