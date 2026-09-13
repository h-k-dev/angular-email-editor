import { TestBed } from '@angular/core/testing';
import { InlineImageStore } from 'angular-email-editor';
import { BlobStore } from './blob-store';
import { DRAFT_KEY, Draft, DraftContent, parseDraft, serializeDraft } from './draft';
import { LocalStorage } from './local-storage';

/** The blob store, in memory — with a gate a spec can hold puts behind. */
class MemoryBlobs {
  readonly data = new Map<string, Blob>();
  gate: Promise<void> = Promise.resolve();
  async get(key: string) {
    return this.data.get(key);
  }
  async put(entries: readonly (readonly [string, Blob])[]) {
    await this.gate;
    for (const [key, blob] of entries) this.data.set(key, blob);
    return true;
  }
  async delete(keys: readonly string[]) {
    for (const key of keys) this.data.delete(key);
    return true;
  }
  async clear() {
    this.data.clear();
    return true;
  }
  async keys() {
    return [...this.data.keys()];
  }
}

const content = (overrides: Partial<DraftContent> = {}): DraftContent => ({
  from: ['me@example.com'],
  to: ['ada@example.com'],
  cc: [],
  bcc: [],
  subject: 'Hi',
  html: '<div>hello</div>',
  attachments: [],
  ...overrides,
});

/** Another tab writing the draft: storage changes, and this tab hears it. */
function otherTab(value: string | null): void {
  if (value === null) localStorage.removeItem(DRAFT_KEY);
  else localStorage.setItem(DRAFT_KEY, value);
  window.dispatchEvent(
    new StorageEvent('storage', { key: DRAFT_KEY, newValue: value, storageArea: localStorage }),
  );
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Draft', () => {
  let blobs: MemoryBlobs;
  let parts: InlineImageStore;

  const start = () => {
    TestBed.configureTestingModule({ providers: [{ provide: BlobStore, useValue: blobs }] });
    return TestBed.inject(Draft);
  };

  beforeEach(() => {
    localStorage.clear();
    blobs = new MemoryBlobs();
    parts = new InlineImageStore({ createUrl: () => 'blob:fake', revokeUrl: () => {} });
  });

  afterEach(() => localStorage.clear());

  it('serializes deterministically and reads back only what it wrote', () => {
    const draft = content({ attachments: [{ id: 'att_1', name: 'a.pdf', size: 3 }] });
    const raw = serializeDraft(draft)!;
    expect(serializeDraft({ ...draft, subject: draft.subject })).toBe(raw);
    expect(parseDraft(raw)).toEqual(draft);
    expect(serializeDraft(null)).toBeNull();
    for (const unreadable of ['not json', '{"v":2}', '[]', JSON.stringify({ v: 1, to: 'x' })]) {
      expect(parseDraft(unreadable)).toBeNull();
    }
  });

  it('opens with the stored draft', () => {
    localStorage.setItem(DRAFT_KEY, serializeDraft(content())!);
    expect(start().incoming().content).toEqual(content());
  });

  it('saves, says when, and does not report its own save as news', () => {
    const service = start();
    const opened = service.incoming();
    expect(opened.content).toBeNull();

    service.save(content(), parts);
    expect(localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(content()));
    expect(service.savedAt()).toBeInstanceOf(Date);
    expect(service.failed()).toBe(false);
    expect(service.incoming()).toBe(opened);

    // Nothing to keep: the draft goes.
    service.save(null, parts);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(service.savedAt()).toBeNull();
    expect(service.incoming()).toBe(opened);
  });

  it('writes nothing for a save that changes nothing', () => {
    const service = start();
    service.save(content(), parts);
    const setItem = vi.spyOn(TestBed.inject(LocalStorage), 'setItem');
    service.save(content(), parts);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reports another tab's saves and discards — even one that repeats this tab's last save", () => {
    const service = start();
    service.save(content({ subject: 'mine' }), parts);

    otherTab(serializeDraft(content({ subject: 'theirs' })));
    expect(service.incoming().content?.subject).toBe('theirs');

    // Their undo lands back on what this tab once wrote: still news.
    otherTab(serializeDraft(content({ subject: 'mine' })));
    expect(service.incoming().content?.subject).toBe('mine');

    const before = service.incoming();
    otherTab(null);
    expect(service.incoming()).not.toBe(before);
    expect(service.incoming().content).toBeNull();

    otherTab('garbage');
    expect(service.incoming().content).toBeNull();
  });

  it('writes nothing over a draft from another tab that has not been taken in yet', () => {
    const service = start();
    service.incoming();
    otherTab(serializeDraft(content({ subject: 'theirs' })));
    // A save made from the message that draft is about to replace.
    service.save(content({ subject: 'stale' }), parts);
    expect(parseDraft(localStorage.getItem(DRAFT_KEY))?.subject).toBe('theirs');

    expect(service.incoming().content?.subject).toBe('theirs');
    service.save(content({ subject: 'next' }), parts);
    expect(parseDraft(localStorage.getItem(DRAFT_KEY))?.subject).toBe('next');
  });

  it('puts the images a body references before the body — and a later save has the last word', async () => {
    const service = start();
    const cid = parts.add(new Blob(['png'], { type: 'image/png' }));
    const withImage = content({ html: `<div>see</div><img src="cid:${cid}" alt="x">` });

    let open!: () => void;
    blobs.gate = new Promise((resolve) => (open = resolve));
    service.save(withImage, parts);
    // Held: no tab may read a cid the store does not have.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    open();
    await tick();
    expect(blobs.data.get(cid)).toBe(parts.blob(cid));
    expect(localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(withImage));

    // Stored once: the next save of the same image writes at once.
    blobs.gate = new Promise(() => {});
    const edited = { ...withImage, subject: 'edited' };
    service.save(edited, parts);
    expect(localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(edited));

    // A save still putting a new image is superseded by the one after it.
    const other = parts.add(new Blob(['gif'], { type: 'image/gif' }));
    blobs.gate = new Promise((resolve) => (open = resolve));
    service.save({ ...edited, html: `<img src="cid:${other}" alt="y">` }, parts);
    service.save(content({ subject: 'text only' }), parts);
    open();
    await tick();
    expect(parseDraft(localStorage.getItem(DRAFT_KEY))?.subject).toBe('text only');
  });

  it('writes the body at once on a save made now — the put trails, and does not write again', async () => {
    const service = start();
    const cid = parts.add(new Blob(['png'], { type: 'image/png' }));
    const withImage = content({ html: `<div>bye</div><img src="cid:${cid}" alt="x">` });

    let open!: () => void;
    blobs.gate = new Promise((resolve) => (open = resolve));
    service.save(withImage, parts, { now: true });
    // The page may be going: the text is in storage before the bytes are.
    expect(localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(withImage));
    expect(blobs.data.has(cid)).toBe(false);

    // The page survived (hidden, not gone) and the user went on typing.
    const later = content({ subject: 'later' });
    service.save(later, parts);
    expect(localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(later));

    // The trailing put lands the bytes — and does not write the old body back.
    open();
    await tick();
    expect(blobs.data.get(cid)).toBe(parts.blob(cid));
    expect(localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(later));
  });

  it('discards the draft and every image with it', async () => {
    const service = start();
    blobs.data.set('image-1.x@aee', new Blob(['png']));
    service.save(content(), parts);
    service.discard();
    await tick();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(blobs.data.size).toBe(0);
  });

  it('loads the images a body references that the registry lacks', async () => {
    const service = start();
    const bytes = new Blob(['png'], { type: 'image/png' });
    blobs.data.set('kept@aee', bytes);
    await service.loadParts(
      '<img src="cid:kept@aee" alt="a"><img src="cid:gone@aee" alt="b">',
      parts,
    );
    expect(parts.blob('kept@aee')).toBe(bytes);
    expect(parts.blob('gone@aee')).toBeUndefined();
  });

  it('sweeps the images no draft references when it starts', async () => {
    blobs.data.set('kept@aee', new Blob(['a']));
    blobs.data.set('orphan@aee', new Blob(['b']));
    localStorage.setItem(
      DRAFT_KEY,
      serializeDraft(content({ html: '<img src="cid:kept@aee" alt="a">' }))!,
    );
    start();
    await tick();
    expect([...blobs.data.keys()]).toEqual(['kept@aee']);
  });

  it('says so when storage will not keep the draft', () => {
    const service = start();
    vi.spyOn(TestBed.inject(LocalStorage), 'setItem').mockReturnValue(false);
    service.save(content(), parts);
    expect(service.failed()).toBe(true);
    expect(service.savedAt()).toBeNull();
  });
});
