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
