/**
 * What a chip needs to draw an attachment: a name and, if they are known, a
 * MIME type and a size. Deliberately structural rather than a class — a
 * browser `File` already satisfies it, so a host that holds `File[]` binds it
 * straight in with no adapter, and one that holds parsed MIME parts
 * (postal-mime hands back a name, a `mimeType` and the content, not a
 * `File`) maps three fields.
 */
export interface Attachment {
  readonly name: string;
  /** MIME type, e.g. `application/pdf`. Only the icon reads it. */
  readonly type?: string;
  /** Size in bytes. Shown under the name, and what simulated progress
      paces itself by. */
  readonly size?: number;
}

/**
 * Where an attachment's transfer is, in the stages uploaders agree on —
 * Uppy, tus and their kin name them the same way. `preprocessing` is the
 * work before the bytes move (a fingerprint, a virus scan) and has no
 * number; `queued` is accepted and waiting for a connection, with nothing
 * happening yet; `uploading` is the bytes moving, with a number;
 * `postprocessing` is the work after (a transcode, a scan on the far side),
 * again with none; `complete` is done. A chip draws a sweep for the stages
 * where work runs without a number, a bar for the one with, and keeps
 * quiet while a transfer only waits.
 *
 * The set is a vocabulary, not a sequence: which stages a pipeline has, and
 * in what order, is the host's — a store that scans on the far side queues
 * before it preprocesses, one that caps its connections queues after.
 */
export type AttachmentStatus =
  'preprocessing' | 'queued' | 'uploading' | 'postprocessing' | 'complete';

/** The stages during which the transfer is not done — a waiting one
    included, since the message is no more sendable for it. */
export function attachmentInFlight(status: AttachmentStatus | null | undefined): boolean {
  return (
    status === 'preprocessing' ||
    status === 'queued' ||
    status === 'uploading' ||
    status === 'postprocessing'
  );
}

/** The families a chip draws a distinct icon for. */
export type AttachmentKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'archive'
  | 'spreadsheet'
  | 'presentation'
  | 'document'
  | 'message'
  | 'file';

/** MIME → kind. Ordered: the first match wins, so the specific document
    types are tested before the `text/*` catch-all, and the Office types —
    which all spell out "document" — before the plain document pattern. */
const KINDS: readonly (readonly [RegExp, AttachmentKind])[] = [
  [/^image\//, 'image'],
  [/^video\//, 'video'],
  [/^audio\//, 'audio'],
  [/pdf$/, 'pdf'],
  [/(zip|compressed|tar|rar|7z)/, 'archive'],
  [/(spreadsheet|excel|csv)/, 'spreadsheet'],
  [/(presentation|powerpoint)/, 'presentation'],
  [/(word|document|rtf|opendocument\.text)/, 'document'],
  [/^message\/|rfc822/, 'message'],
  [/^text\//, 'document'],
];

/** The kind of file a MIME type stands for; `file` when the type is unknown
    or matches nothing above. Case-insensitive — a type off the wire may be
    shouted. */
export function attachmentKind(type: string | undefined): AttachmentKind {
  if (!type) return 'file';
  const mime = type.toLowerCase();
  for (const [pattern, kind] of KINDS) if (pattern.test(mime)) return kind;
  return 'file';
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/**
 * A byte count the way a mail client prints it: binary steps, one decimal
 * below ten ("2.5 MB", "15 MB"), none for bytes. The number follows the
 * locale ("2,5 MB" in German); the unit labels are the ones every mail
 * client uses, not CLDR's ("kB", "byte").
 */
export function formatAttachmentSize(bytes: number, locale = 'en-US'): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
  return `${number} ${SIZE_UNITS[unit]}`;
}
