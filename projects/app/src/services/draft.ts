import {
  InjectionToken,
  Service,
  inject,

  // Signals
  linkedSignal,
  signal,
} from '@angular/core';
import { InlineImageRegistry, inlineImageCids } from 'angular-email-editor';
import { BlobStore } from './blob-store';
import { LocalStorage } from './local-storage';

/** Where the draft lives in localStorage. */
export const DRAFT_KEY = 'angular-email-editor:draft';

/** How long the composer lets the message rest before saving it, in ms.
    Specs set it to 0. */
export const DRAFT_SAVE_DELAY = new InjectionToken<number>('DRAFT_SAVE_DELAY', {
  factory: () => 500,
});

/** An attachment as a draft keeps it: the store's id and what a chip draws.
    Never the local key — that is one session's identity — and never an
    attachment still uploading, which has no id to keep. */
export interface DraftAttachment {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
  readonly size?: number;
}

/** What a draft holds: the envelope, the body, the attachments. The inline
    images the body references by `cid:` are kept beside it, in the blob
    store. */
export interface DraftContent {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject: string;
  /** The inbox snippet; absent in drafts written before it existed. */
  readonly previewText?: string;
  readonly html: string;
  /** The HTML as it came in, before the editor read it; absent for a
      message written here, and in drafts written before it existed. */
  readonly original?: string | null;
  readonly attachments: readonly DraftAttachment[];
}

/** What storage says the draft is, as news: `null` content when there is
    none (another tab sent or discarded it). A fresh object per change, so
    a change is a change even when the content is `null` twice. */
export interface IncomingDraft {
  readonly content: DraftContent | null;
}

/** How a save is made. */
export interface SaveOptions {
  /** Write the body now, before the images it references are in the blob
      store — for a page on its way out, which may not live to see the put
      resolve. The put still runs; a tab that reads the draft first shows
      such an image as missing, which beats losing the text. */
  readonly now?: boolean;
}

/** The draft as the one string storage holds — keys in a fixed order, so
    the same content is always the same string, and an unchanged draft is
    recognisable without comparing field by field. */
export function serializeDraft(content: DraftContent | null): string | null {
  if (!content) return null;
  const { from, to, cc, bcc, subject, previewText, html, original, attachments } = content;
  return JSON.stringify({
    v: 1,
    from,
    to,
    cc,
    bcc,
    subject,
    // Left out when empty, so a draft without one stays the string it was.
    ...(previewText && { previewText }),
    html,
    ...(original && { original }),
    attachments: attachments.map(({ id, name, type, size }) => ({ id, name, type, size })),
  });
}

/** The stored string as a draft; `null` for no draft — and for anything
    unreadable: storage is shared with whatever else runs on the origin, and
    a draft from a future format is not this version's to guess at. */
export function parseDraft(raw: string | null): DraftContent | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value['v'] !== 1) return null;
  const { from, to, cc, bcc, subject, previewText, html, original, attachments } = value;
  if (
    !isStrings(from) ||
    !isStrings(to) ||
    !isStrings(cc) ||
    !isStrings(bcc) ||
    typeof subject !== 'string' ||
    (previewText !== undefined && typeof previewText !== 'string') ||
    typeof html !== 'string' ||
    (original !== undefined && original !== null && typeof original !== 'string') ||
    !Array.isArray(attachments) ||
    !attachments.every(isDraftAttachment)
  ) {
    return null;
  }
  return {
    from,
    to,
    cc,
    bcc,
    subject,
    ...(previewText !== undefined && { previewText }),
    html,
    ...(original !== undefined && { original }),
    attachments,
  };
}

/**
 * The one draft — there is never more than one at a time. The message lives
 * in localStorage (small, synchronous, and shared: every tab hears a save
 * through `pairSignal`), its inline images in the {@link BlobStore} under
 * their Content-IDs. The composer decides what the draft is and when to save
 * it; this service decides how it is kept:
 *
 * - **Unchanged saves cost nothing.** The draft is one deterministic string;
 *   a save equal to what storage holds writes nothing, so a tab that takes
 *   in another tab's draft and "saves" it back is silent.
 * - **Bytes before the body.** A save whose body references images the blob
 *   store does not have yet puts those first and writes the body after, so
 *   no tab ever reads a `cid:` it cannot find. A later save or a discard
 *   supersedes one still putting its images. Except on the way out: a page
 *   being hidden or unloaded saves with `now`, and the body goes first —
 *   the put may never resolve, and the text is the part worth keeping.
 * - **News, not echoes.** {@link incoming} reports what storage says the
 *   draft is — but never this tab's own write coming back, which, arriving
 *   after an asynchronous save, could be older than what the user has typed
 *   since.
 * - **News first.** While storage holds a draft this tab has not taken in
 *   yet, a save writes nothing: it was made from a message that draft is
 *   about to replace, and writing it would bury the newer one unread.
 *
 * Orphaned images — referenced by no draft — are swept once, when the app
 * starts, and all of them go with a discard. Not on every save: another tab
 * may have just put the image its next save is about to reference.
 */
@Service()
export class Draft {
  readonly #storage = inject(LocalStorage);
  readonly #blobs = inject(BlobStore);
  readonly #raw = this.#storage.pairSignal(DRAFT_KEY);

  /** The draft string this tab last had in common with storage: written by
      it, or taken in from another tab. */
  #synced: string | null | undefined = undefined;
  /** Content-IDs known to be in the blob store. */
  readonly #storedParts = new Set<string>();
  /** Bumped by every save and discard; a save that is still putting its
      images writes only if nothing has come after it. */
  #generation = 0;

  /** The stored draft as it changes — at first, the one the app opens with;
      then every save and discard another tab makes. */
  readonly incoming = linkedSignal<string | null, IncomingDraft>({
    source: this.#raw,
    computation: (raw, previous) => {
      if (previous && raw === this.#synced) return previous.value;
      this.#synced = raw;
      if (raw === null) this.#storedParts.clear();
      return { content: parseDraft(raw) };
    },
  }).asReadonly();

  readonly #savedAt = signal<Date | null>(null);
  /** When this tab last saved a draft; `null` before it has, and once the
      draft is gone. */
  readonly savedAt = this.#savedAt.asReadonly();

  readonly #failed = signal(false);
  /** The last save did not reach storage — full, or unavailable. */
  readonly failed = this.#failed.asReadonly();

  constructor() {
    void this.#sweep();
  }

  /** Keeps the content as the draft — `null` for none, which removes it —
      with the bytes of every inline image it references, read from the
      composer's registry. */
  save(content: DraftContent | null, parts: InlineImageRegistry, options?: SaveOptions): void {
    const generation = ++this.#generation;
    const raw = serializeDraft(content);
    if (raw === this.#raw() || this.#unread()) return;
    const missing = content
      ? inlineImageCids(content.html).filter(
          (cid) => !this.#storedParts.has(cid) && parts.blob(cid),
        )
      : [];
    const now = !missing.length || !!options?.now;
    if (now) this.#write(raw);
    if (!missing.length) return;
    const entries = missing.map((cid) => [cid, parts.blob(cid)!] as const);
    void this.#blobs.put(entries).then((stored) => {
      if (stored) for (const cid of missing) this.#storedParts.add(cid);
      // Written even when the bytes were not: the text is worth keeping,
      // and an image the store lacks shows as missing, not as garbage.
      if (!now && generation === this.#generation && !this.#unread()) this.#write(raw);
    });
  }

  /** Throws the draft away, images and all. */
  discard(): void {
    ++this.#generation;
    this.#write(null);
    this.#storedParts.clear();
    void this.#blobs.clear();
  }

  /** Registers every image the html references that the registry lacks,
      from the blob store — a restored draft's, or one another tab saved.
      An editor shows such an image as missing until its bytes arrive, and
      re-resolves it then. */
  async loadParts(html: string, parts: InlineImageRegistry): Promise<void> {
    const wanted = inlineImageCids(html).filter((cid) => !parts.blob(cid));
    await Promise.all(
      wanted.map(async (cid) => {
        const blob = await this.#blobs.get(cid);
        if (!blob) return;
        this.#storedParts.add(cid);
        if (!parts.blob(cid)) parts.add(blob, cid);
      }),
    );
  }

  /** Storage holds a draft {@link incoming} has not handed out yet. */
  #unread(): boolean {
    return this.#synced !== undefined && this.#raw() !== this.#synced;
  }

  #write(raw: string | null): void {
    const stored = this.#storage.setItem(DRAFT_KEY, raw);
    // A refused write leaves storage as it was — and so in sync as before.
    if (stored) this.#synced = raw;
    this.#failed.set(!stored);
    this.#savedAt.set(stored && raw !== null ? new Date() : null);
  }

  /** Drops the images no draft references — leftovers of a session that
      ended mid-save, or of images deleted before the last save. Spares any
      this tab has put in the meantime. */
  async #sweep(): Promise<void> {
    const keys = await this.#blobs.keys();
    const referenced = new Set(inlineImageCids(parseDraft(this.#raw())?.html ?? ''));
    for (const key of keys) if (referenced.has(key)) this.#storedParts.add(key);
    await this.#blobs.delete(
      keys.filter((key) => !referenced.has(key) && !this.#storedParts.has(key)),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isDraftAttachment(value: unknown): value is DraftAttachment {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    (value['type'] === undefined || typeof value['type'] === 'string') &&
    (value['size'] === undefined || typeof value['size'] === 'number')
  );
}
