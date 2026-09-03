import { Node } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';

/**
 * Inline images — the half of the attachment story that lives in the
 * document. Dropped and pasted image files enter the editor as data-URL
 * images (the only thing a browser editor can hold on its own), but a data
 * URL is not an email image: Gmail and Outlook refuse it and the recipient
 * sees a hole. The email form is a `cid:` reference to a `multipart/related`
 * part — and assembling MIME is the host's job, not ours.
 *
 * So the editor reports the truth about the document at send time
 * ({@link promoteInlineImages}): every data-URL image is decoded into its
 * bytes and re-pointed at a generated Content-ID *in the payload copy only*;
 * the document itself keeps its data URL (the editor still has to display
 * it, and the round trip never learns about the promotion). Images that
 * already reference a `cid:` — an imported reply's inline parts — are
 * reported with the bytes the configured registry holds for them, else by
 * id alone: the host received those parts with the import and owns them.
 */
export interface InlineImage {
  /** The Content-ID the payload's HTML references as `src="cid:<cid>"` —
      bare, without the `cid:` scheme or the `<…>` the MIME header wraps it
      in. */
  cid: string;
  /** The image bytes, typed — present for images the editor holds itself
      (dropped, pasted, picked), `null` for pre-existing `cid:` references
      whose part the host already has. */
  blob: Blob | null;
}

export interface PromotedInlineImages {
  /** A copy of the document with every data-URL image pointing at its
      `cid:` — serialize this for the payload; the original is untouched. */
  doc: Node;
  /** Every inline part the payload references, in document order, each id
      once. */
  images: InlineImage[];
}

const DATA_URL = /^\s*data:([^,]*?)(;base64)?,([\s\S]*)$/i;

/** Decodes a `data:` URL into a typed `Blob` — base64 or percent-encoded,
    the media type without its parameters. `null` for anything that is not a
    well-formed data URL, so a malformed source is left alone rather than
    sent as garbage. */
export function decodeDataUrl(src: string): Blob | null {
  const match = DATA_URL.exec(src);
  if (!match) return null;
  const type = (match[1].split(';')[0].trim() || 'text/plain').toLowerCase();
  try {
    const bytes = match[2]
      ? Uint8Array.from(atob(match[3].replace(/\s/g, '')), (char) => char.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(match[3]));
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

const isDataUrl = (src: string): boolean => /^\s*data:/i.test(src);
const cidOf = (src: string): string | null =>
  /^\s*cid:/i.test(src) ? src.trim().slice(4).trim() || null : null;

/** Generated ids are deterministic (`image-1@aee`, `image-2@aee`, …) so the
    same document always yields the same payload — a Content-ID only has to
    be unique within its message. */
const generatedCid = (n: number): string => `image-${n}@aee`;

/** The send-time projection: data-URL images become `cid:` parts in a copy
    of the document; every inline reference — promoted or pre-existing — is
    listed once, in document order. Pure: the input document is never
    modified, and an image whose data URL cannot be decoded keeps its source
    (the source-pane lint names it). Identical data URLs share one part. */
export function promoteInlineImages(
  doc: Node,
  registry?: InlineImageRegistry,
): PromotedInlineImages {
  const imageType = doc.type.schema.nodes['image'];
  if (!imageType) return { doc, images: [] };

  // Ids already referenced by the document must not be handed out again.
  const used = new Set<string>();
  doc.descendants((node) => {
    if (node.type !== imageType) return;
    const cid = cidOf(String(node.attrs['src']));
    if (cid) used.add(cid);
  });

  const tr = new Transform(doc);
  const images: InlineImage[] = [];
  const reported = new Set<string>();
  const promoted = new Map<string, string>();
  let counter = 0;

  doc.descendants((node, pos) => {
    if (node.type !== imageType) return;
    const src = String(node.attrs['src']);

    const existing = cidOf(src);
    if (existing) {
      if (!reported.has(existing)) {
        reported.add(existing);
        images.push({ cid: existing, blob: registry?.blob(existing) ?? null });
      }
      return;
    }
    if (!isDataUrl(src)) return;

    let cid = promoted.get(src);
    if (!cid) {
      const blob = decodeDataUrl(src);
      if (!blob) return;
      do cid = generatedCid(++counter);
      while (used.has(cid));
      used.add(cid);
      promoted.set(src, cid);
      images.push({ cid, blob });
    }
    // Attribute-only change: node sizes are unchanged, positions stay valid.
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: `cid:${cid}` });
  });

  return { doc: tr.doc, images };
}

/**
 * The inline image registry — the half of the attachment story that the
 * editor owns (decided 2026-09-02, the Gmail model): one map per composer
 * from Content-ID to bytes, with a display URL for each. Two writers — the
 * editor (a dropped, pasted or picked file) and the host (an import's MIME
 * parts) — and four readers: the editor view, the preview, the send intent,
 * and the host persisting a draft's parts. With a registry configured
 * ({@link createInlineImages}) a drop produces `src="cid:…"` at once and the
 * document stays light; without one, today's data-URL path still applies.
 * The contract is framework-free; the Angular service implements it with a
 * signal underneath.
 */
export interface InlineImageRegistry {
  /** Registers bytes and returns their Content-ID — a supplied one is kept
      (an import's part), otherwise one is generated, unique within this
      registry. Re-registering a cid replaces its bytes. */
  add(blob: Blob, cid?: string): string;
  /** The display URL for the editor (an object URL); undefined for a part
      the registry does not hold. */
  resolve(cid: string): string | undefined;
  /** The bytes; undefined when the host owns the part. */
  blob(cid: string): Blob | undefined;
  /** Change notification, so views can re-resolve; returns the unsubscribe. */
  subscribe?(listener: () => void): () => void;
}

export interface InlineImageStoreOptions {
  /** How display URLs are made (default `URL.createObjectURL`) … */
  createUrl?: (blob: Blob) => string;
  /** … and released (default `URL.revokeObjectURL`). */
  revokeUrl?: (url: string) => void;
}

/** The in-memory registry. Parts stay registered after their image is
    deleted from the document (undo brings it back); the send intent reports
    only what the document references, and so should a host's draft. Every
    URL is released by {@link revokeAll} when the composer goes away. */
export class InlineImageStore implements InlineImageRegistry {
  readonly #parts = new Map<string, { blob: Blob; url: string }>();
  readonly #listeners = new Set<() => void>();
  #counter = 0;

  constructor(private readonly options: InlineImageStoreOptions = {}) {}

  add(blob: Blob, cid?: string): string {
    const id = cid ?? this.#nextId();
    const previous = this.#parts.get(id);
    if (previous) this.#revoke(previous.url);
    this.#parts.set(id, { blob, url: this.#createUrl(blob) });
    for (const listener of this.#listeners) listener();
    return id;
  }

  resolve(cid: string): string | undefined {
    return this.#parts.get(cid)?.url;
  }

  blob(cid: string): Blob | undefined {
    return this.#parts.get(cid)?.blob;
  }

  has(cid: string): boolean {
    return this.#parts.has(cid);
  }

  /** Every registered Content-ID, in registration order. */
  cids(): string[] {
    return [...this.#parts.keys()];
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Releases every display URL and forgets every part. */
  revokeAll(): void {
    for (const { url } of this.#parts.values()) this.#revoke(url);
    this.#parts.clear();
    for (const listener of this.#listeners) listener();
  }

  #nextId(): string {
    let id: string;
    do id = `image-${++this.#counter}@aee`;
    while (this.#parts.has(id));
    return id;
  }

  #createUrl(blob: Blob): string {
    return (this.options.createUrl ?? ((b) => URL.createObjectURL(b)))(blob);
  }

  #revoke(url: string): void {
    (this.options.revokeUrl ?? ((u) => URL.revokeObjectURL(u)))(url);
  }
}

/** The registry configured for an editor, if any — plugin state, so the
    Image node, the send intent and the host all read the same one. */
export const inlineImagesKey = new PluginKey<InlineImagesState>('inlineImages');

interface InlineImagesState {
  registry: InlineImageRegistry;
  /** Bumped on every registry change: the image decorations carry it, so a
      node view re-resolves its `cid:` when a part arrives late. */
  version: number;
}

export const inlineImageRegistry = (state: EditorState): InlineImageRegistry | undefined =>
  inlineImagesKey.getState(state)?.registry;

const isCidSource = (src: unknown): boolean => typeof src === 'string' && /^\s*cid:/i.test(src);

/**
 * The registry extension — the roadmap's "`cid:` resolver input", and the
 * editor's write side. Hands the registry to the Image node (drops register
 * their bytes and insert `cid:` sources; node views resolve them for display)
 * and to the send intent (bytes for `inlineImages`). A registry change is a
 * meta transaction that bumps a version carried by a node decoration on every
 * `cid:` image, which is how ProseMirror re-renders those node views without
 * the document changing.
 */
export const createInlineImages = (options: {
  registry: InlineImageRegistry;
}): FunctionalExtension =>
  defineExtension({
    name: 'inlineImages',
    plugins: () => [
      new Plugin<InlineImagesState>({
        key: inlineImagesKey,
        state: {
          init: () => ({ registry: options.registry, version: 0 }),
          apply: (tr, value) =>
            tr.getMeta(inlineImagesKey) ? { ...value, version: value.version + 1 } : value,
        },
        view: (view) => {
          const off = options.registry.subscribe?.(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(inlineImagesKey, true));
          });
          return { destroy: () => off?.() };
        },
        props: {
          decorations(state) {
            const version = inlineImagesKey.getState(state)?.version ?? 0;
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'image' && isCidSource(node.attrs['src'])) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { version }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ],
  });

/** Rewrites every `cid:` image source the resolver knows — the preview's
    projection (a sandboxed, opaque-origin frame cannot load the editor's
    blob URLs, so the preview resolves to data URLs). Unknown cids are left
    untouched. Pure. */
export function rewriteInlineImageSources(
  html: string,
  resolve: (cid: string) => string | undefined,
): string {
  return html.replace(/(<img\b[^>]*?\bsrc=")cid:([^"]*)(")/gi, (match, before, cid, after) => {
    const url = resolve(cid.trim());
    return url ? `${before}${url}${after}` : match;
  });
}
