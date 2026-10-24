import {
  InjectionToken,
  Service,

  // Singals
  Signal,
  WritableSignal,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import {
  Attachment,
  AttachmentChipOptions,
  AttachmentStatus,
  simulatedDuration,
} from '@h-k-dev/angular-email-editor/attachment-chip';

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
  /** Whether the connection is up, asked at every tick of an upload: a
      transfer whose connection drops fails, as a real one does — the
      browser's own word by default, so DevTools' Offline shows it. */
  readonly online: () => boolean;
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
  online: () => globalThis.navigator?.onLine ?? true,
};

/** One transfer as the store sees it: its stage, and how far along the
    bytes are while they move. */
interface Transfer {
  readonly status: AttachmentStatus;
  readonly progress: number | null;
}

const NONE: Signal<Transfer | null> = signal(null).asReadonly();

/**
 * Where a set of transfers stands together — what a summary of them shows
 * (the strip's toggle while the chips are out of sight): whether any is
 * still in flight, how many are, and how far the batch is, 0–1, by bytes.
 * `progress` is `null` while nothing is moving bytes yet — every file in
 * the batch still preprocessing or queued — so a summary sweeps rather than
 * sitting at 0%.
 */
export interface UploadSummary {
  readonly busy: boolean;
  readonly pending: number;
  readonly progress: number | null;
}

const IDLE: UploadSummary = { busy: false, pending: 0, progress: null };

/**
 * The upload-on-drop store, simulated — through the stages a real one goes
 * through, over the connections a real one has. A dropped file is first
 * `preprocessing` (fingerprinted, scanned: a stretch with nothing to count,
 * so the chip sweeps), then `queued` until one of the store's connections
 * is free, then `uploading` over the store's line (`simulatedDuration`: the
 * size over the line's speed, clamped — a mobile-class line, so sizes tell
 * apart), so the strip shows real, determinate progress from here instead
 * of playing a fake. The full bar lingers a moment, and then the
 * transfer is `complete` and the reference gets its id. An upload whose
 * connection drops is `failed`: it gives its connection up, keeps its
 * place in nothing, and waits for `retry` — or for its chip to go.
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

  /** Takes back an attachment the store already holds — one a restored
      draft refers to by id — and returns a reference to it under a key of
      this session: keys are local identity and never persisted, so a
      reference from before a reload, or from another tab, cannot collide
      with a transfer started here. Its transfer is complete from the start. */
  adopt(attachment: Attachment & { readonly id: string }): AttachmentRef {
    const key = `upload-${++this.#next}`;
    this.#transfers.set(key, signal<Transfer>({ status: 'complete', progress: 1 }));
    this.#done.set(key, Promise.resolve(attachment.id));
    return {
      key,
      id: attachment.id,
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

  /**
   * The transfers of `keys` — one composer's attachments — summed up, for
   * whatever shows them together (the strip's toggle while the chips are
   * away). Progress is over the **batch**: the files sent since everything
   * last settled. A batch takes in each file as it starts and keeps the
   * ones already done until the last of it settles, so the bar runs from
   * nothing to full once per batch — a file attached long ago does not
   * start the next upload at half — and empties when the batch is through.
   * Each file weighs its size (one byte when unknown); one uploading counts
   * its bytes so far, one done counts whole.
   */
  summary(keys: () => readonly string[]): Signal<UploadSummary> {
    const batch = linkedSignal<readonly (readonly [string, Transfer | null])[], readonly string[]>(
      {
        source: () => keys().map((key) => [key, this.#transfers.get(key)?.() ?? null] as const),
        computation: (transfers, previous) => {
          // A failed transfer is out of the batch: nothing of it moves, and
          // the batch must still be able to finish without it.
          const flying = transfers
            .filter(([, transfer]) => transfer && !settled(transfer.status))
            .map(([key]) => key);
          if (!flying.length) return [];
          const present = new Set(
            transfers.filter(([, transfer]) => transfer?.status !== 'failed').map(([key]) => key),
          );
          const kept = (previous?.value ?? []).filter((key) => present.has(key));
          return [...new Set([...kept, ...flying])];
        },
      },
    );
    return computed(() => {
      const members = batch();
      if (!members.length) return IDLE;
      let total = 0;
      let done = 0;
      let pending = 0;
      let moving = false;
      for (const key of members) {
        const transfer = this.#transfers.get(key)?.();
        const size = Math.max(1, this.#sizes.get(key) ?? 1);
        total += size;
        if (transfer?.status === 'complete') {
          done += size;
          moving = true;
          continue;
        }
        pending++;
        if (transfer?.status === 'uploading') {
          done += size * (transfer.progress ?? 0);
          moving = true;
        }
      }
      return { busy: pending > 0, pending, progress: moving ? done / total : null };
    });
  }

  /** Resolves with the store's id once the transfer settles. A cancelled
      transfer never resolves — whoever waited has already let go. */
  whenDone(key: string): Promise<string> {
    return this.#done.get(key) ?? new Promise<string>(() => {});
  }

  /** Starts a failed transfer again: back in line for a connection, its
      bytes from the start. A no-op for any other. */
  retry(key: string): void {
    const transfer = this.#transfers.get(key);
    if (transfer?.().status !== 'failed') return;
    transfer.set({ status: 'queued', progress: null });
    this.#waiting.push(key);
    this.#pump();
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
      // The connection dropped: the transfer fails and frees its slot.
      if (!this.#options.online()) {
        clearInterval(timer);
        this.#stop.delete(key);
        this.#uploading.delete(key);
        transfer.set({ status: 'failed', progress: null });
        this.#pump();
        return;
      }
      const elapsed = Date.now() - started;
      transfer.set({ status: 'uploading', progress: Math.min(1, elapsed / duration) });
      // Full, but let it be seen before it goes.
      if (elapsed < duration + linger) return;
      clearInterval(timer);
      this.#stop.delete(key);
      this.#uploading.delete(key);
      transfer.set({ status: 'complete', progress: 1 });
      // The store's id, unique the way a server's is: a draft keeps it
      // across reloads and tabs, where this session's counter restarts.
      this.#settled.get(key)?.(`att_${crypto.randomUUID()}`);
      this.#pump();
    }, this.#options.tick);
    this.#stop.set(key, () => clearInterval(timer));
  }
}

/** Done with, one way or the other: nothing more moves until someone acts. */
function settled(status: AttachmentStatus): boolean {
  return status === 'complete' || status === 'failed';
}
