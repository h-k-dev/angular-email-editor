import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { emailExtensions } from './kits';
import { decodeDataUrl, promoteInlineImages } from './inline-images';

const schema = createSchema(emailExtensions);
const html = (doc: ReturnType<typeof parseHTML>) => serializeToHTML(doc, schema);

// "hi" as base64 — two bytes, so a decoded size is a real assertion.
const PNG = 'data:image/png;base64,aGk=';
const img = (src: string, alt = 'a') => `<img src="${src}" alt="${alt}">`;

describe('decodeDataUrl', () => {
  it('decodes base64 into a typed blob, media type without parameters', async () => {
    const blob = decodeDataUrl('data:image/png;charset=binary;base64,aGk=')!;
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(2);
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe('hi');
  });

  it('decodes percent-encoded data URLs', async () => {
    const blob = decodeDataUrl('data:image/svg+xml,%3Csvg%3E')!;
    expect(blob.type).toBe('image/svg+xml');
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe('<svg>');
  });

  it('returns null for anything that is not a well-formed data URL', () => {
    expect(decodeDataUrl('https://x.io/a.png')).toBeNull();
    expect(decodeDataUrl('data:image/png')).toBeNull();
    expect(decodeDataUrl('data:image/png;base64,***')).toBeNull();
  });
});

describe('promoteInlineImages', () => {
  it('re-points data-URL images at generated cids in a copy, and reports the bytes', () => {
    const doc = parseHTML(`<div>a</div>${img(PNG)}`, schema);
    const { doc: promoted, images } = promoteInlineImages(doc);

    expect(html(promoted)).toContain('src="cid:image-1@aee"');
    expect(html(promoted)).not.toContain('data:');
    expect(images).toHaveLength(1);
    expect(images[0].cid).toBe('image-1@aee');
    expect(images[0].blob?.type).toBe('image/png');
    expect(images[0].blob?.size).toBe(2);
    // Pure: the input document is untouched.
    expect(html(doc)).toContain(PNG);
  });

  it('lists pre-existing cid references by id with no bytes, each once, in document order', () => {
    const doc = parseHTML(
      `${img('cid:part1@mail')}${img(PNG)}${img('cid:part1@mail')}${img('cid:part2@mail')}`,
      schema,
    );
    const { images } = promoteInlineImages(doc);
    expect(images.map((image) => image.cid)).toEqual(['part1@mail', 'image-1@aee', 'part2@mail']);
    expect(images.map((image) => image.blob === null)).toEqual([true, false, true]);
  });

  it('shares one part between identical data URLs and skips ids the document already uses', () => {
    const doc = parseHTML(`${img('cid:image-1@aee')}${img(PNG)}${img(PNG)}`, schema);
    const { doc: promoted, images } = promoteInlineImages(doc);
    expect(images.map((image) => image.cid)).toEqual(['image-1@aee', 'image-2@aee']);
    expect(html(promoted).match(/cid:image-2@aee/g)).toHaveLength(2);
  });

  it('leaves an undecodable data URL alone — the lint names it, sending garbage would not', () => {
    const doc = parseHTML(img('data:image/png;base64,***'), schema);
    const { doc: promoted, images } = promoteInlineImages(doc);
    expect(images).toEqual([]);
    expect(html(promoted)).toBe(html(doc));
  });

  it('is a no-op for a document without inline images', () => {
    const doc = parseHTML(`<div>text</div>${img('https://x.io/a.png')}`, schema);
    const { doc: promoted, images } = promoteInlineImages(doc);
    expect(images).toEqual([]);
    expect(promoted).toBe(doc);
  });
});
