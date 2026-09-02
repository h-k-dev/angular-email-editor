import { Node } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';

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
 * reported by id with no bytes: the host received those parts with the
 * import and owns them.
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
export function promoteInlineImages(doc: Node): PromotedInlineImages {
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
        images.push({ cid: existing, blob: null });
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
