import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { emailExtensions } from './kits';
import {
  InlineImageStore,
  decodeDataUrl,
  promoteInlineImages,
  rewriteInlineImageSources,
} from './inline-images';

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

describe('InlineImageStore', () => {
  const fakeUrls = () => {
    let n = 0;
    const revoked: string[] = [];
    return {
      options: { createUrl: () => `blob:fake/${++n}`, revokeUrl: (url: string) => revoked.push(url) },
      revoked,
    };
  };

  it('registers bytes under a generated cid, a supplied one, and never reuses an id', () => {
    const { options } = fakeUrls();
    const store = new InlineImageStore(options);
    const a = new Blob(['a'], { type: 'image/png' });
    expect(store.add(a)).toBe('image-1@aee');
    expect(store.add(a, 'part1@mail')).toBe('part1@mail');
    expect(store.add(a, 'image-2@aee')).toBe('image-2@aee');
    expect(store.add(a)).toBe('image-3@aee');
    expect(store.cids()).toEqual(['image-1@aee', 'part1@mail', 'image-2@aee', 'image-3@aee']);
    expect(store.resolve('image-1@aee')).toBe('blob:fake/1');
    expect(store.blob('part1@mail')).toBe(a);
    expect(store.resolve('nope')).toBeUndefined();
  });

  it('notifies subscribers, replaces bytes under a re-registered cid, and revokes on release', () => {
    const { options, revoked } = fakeUrls();
    const store = new InlineImageStore(options);
    let changes = 0;
    const off = store.subscribe(() => changes++);
    store.add(new Blob(['a']), 'p');
    const b = new Blob(['b']);
    store.add(b, 'p');
    expect(changes).toBe(2);
    expect(store.blob('p')).toBe(b);
    expect(revoked).toEqual(['blob:fake/1']);
    store.revokeAll();
    expect(revoked).toEqual(['blob:fake/1', 'blob:fake/2']);
    expect(store.cids()).toEqual([]);
    expect(changes).toBe(3);
    off();
    store.add(new Blob(['c']));
    expect(changes).toBe(3);
  });
});

describe('rewriteInlineImageSources', () => {
  it('rewrites the cid sources it can resolve and leaves the rest', () => {
    const html =
      '<div><img src="cid:a" alt="x"> <img alt="y" src="cid:b"> <img src="https://x/y.png"></div>';
    expect(rewriteInlineImageSources(html, (cid) => (cid === 'a' ? 'data:image/png;base64,AA' : undefined))).toBe(
      '<div><img src="data:image/png;base64,AA" alt="x"> <img alt="y" src="cid:b"> <img src="https://x/y.png"></div>',
    );
  });
});

describe('promoteInlineImages with a registry', () => {
  it('reports the bytes the registry holds for a cid reference', () => {
    const store = new InlineImageStore({ createUrl: () => 'blob:fake', revokeUrl: () => {} });
    const bytes = new Blob(['hi'], { type: 'image/png' });
    store.add(bytes, 'p1');
    const doc = parseHTML(`${img('cid:p1')}${img('cid:host-owned')}`, schema);
    const { images } = promoteInlineImages(doc, store);
    expect(images).toEqual([
      { cid: 'p1', blob: bytes },
      { cid: 'host-owned', blob: null },
    ]);
  });
});
