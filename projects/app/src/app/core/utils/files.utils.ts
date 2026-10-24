/**
 * Image extensions, lower case, without the dot — what an image's name ends
 * in when its MIME type does not say so. Formats a browser can draw, and the
 * phones' own (HEIC, HEIF): a chip names those an image too, and simply
 * shows no picture where the browser cannot draw it.
 */
const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'ico',
  'jfif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);

/** MIME types that say nothing about what a file is — a browser's fallback
    for a type it does not know, or none at all. */
const VAGUE_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

/** What a file looks like before it is opened: its name and, if the browser
    knows it, its MIME type. A `File` satisfies it. */
export interface FileLike {
  readonly name: string;
  readonly type?: string;
}

/** The extension of a name, lower case, without the dot; empty for none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Whether a file is an image. Its MIME type decides when it says anything —
 * `image/*` is, anything specific that is not is not; when the type is
 * missing or only the generic `application/octet-stream` (a HEIC off a
 * phone in a desktop browser, a file from a drive without a type), the name's
 * extension decides.
 */
export function isImageFile(file: FileLike): boolean {
  const type = (file.type ?? '').toLowerCase();
  if (!VAGUE_TYPES.has(type)) return type.startsWith('image/');
  return IMAGE_EXTENSIONS.has(fileExtension(file.name));
}
