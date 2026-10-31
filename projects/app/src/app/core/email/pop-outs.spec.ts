import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { BlobStore } from '../storages/blob-store';
import { ComposeWindows } from './compose-windows';
import { draftKey, parseDraft, serializeDraft } from './draft';
import { BLANK } from './envelope';
import { PopOuts } from './pop-outs';

/** The blob store, in memory. */
class MemoryBlobs {
  readonly data = new Map<string, Blob>();
  async get(key: string) {
    return this.data.get(key);
  }
  async put(entries: readonly (readonly [string, Blob])[]) {
    for (const [key, blob] of entries) this.data.set(key, blob);
    return true;
  }
  async delete(keys: readonly string[]) {
    for (const key of keys) this.data.delete(key);
    return true;
  }
  async keys() {
    return [...this.data.keys()];
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PopOuts', () => {
  let blobs: MemoryBlobs;
  let opened: ReturnType<typeof vi.fn>;
  let popOuts: PopOuts;

  beforeEach(() => {
    localStorage.clear();
    blobs = new MemoryBlobs();
    opened = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: BlobStore, useValue: blobs },
        { provide: ComposeWindows, useValue: { open: opened } },
      ],
    });
    popOuts = TestBed.inject(PopOuts);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  /** The session the last popup was opened on, from its URL. */
  const sessionOf = (open: ReturnType<typeof vi.spyOn>) =>
    String(open.mock.calls.at(-1)![0]).split('/compose/')[1];

  it('opens a popup named by its session, the URL the id alone, and keeps a new message as its draft', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    expect(popOuts.open(null)).toBe(true);
    const [url, name, features] = open.mock.calls[0];
    const session = sessionOf(open);
    expect(url).toBe(`/compose/${session}`);
    expect(session).toMatch(/^[0-9a-f-]{36}$/);
    expect(name).toBe(`compose-${session}`);
    expect(features).toContain('popup');
    // Blank, and kept anyway: the draft is the session.
    expect(parseDraft(localStorage.getItem(draftKey(session)))).toMatchObject({
      from: BLANK.from,
      to: [],
      subject: '',
    });
  });

  it('hands a message over with the inline images its body names', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const png = new Blob(['png'], { type: 'image/png' });
    popOuts.open({
      message: {
        ...BLANK,
        to: ['ada@example.com'],
        html: '<p><img src="cid:kept@aee" alt="a"></p>',
      },
      images: [
        { cid: 'kept@aee', blob: png },
        { cid: 'deleted@aee', blob: new Blob(['old']) },
      ],
    });
    await tick();
    const draft = parseDraft(localStorage.getItem(draftKey(sessionOf(open))));
    expect(draft?.to).toEqual(['ada@example.com']);
    expect([...blobs.data.keys()]).toEqual(['kept@aee']);
  });

  it('writes nothing where the browser blocks the popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(popOuts.open(null)).toBe(false);
    expect(Object.keys(localStorage).filter((key) => key.includes(':draft'))).toEqual([]);
  });

  it('tells the pop-out whether its session is there', () => {
    localStorage.setItem(draftKey('here'), serializeDraft({ ...BLANK, attachments: [] })!);
    const found: boolean[] = [];
    const releaseHere = popOuts.attach('here', (yes) => found.push(yes));
    const releaseGone = popOuts.attach('gone', (yes) => found.push(yes));
    expect(found).toEqual([true, false]);
    releaseHere();
    releaseGone();
  });

  it('with no tab to take it back, becomes the mailbox and opens the message there', async () => {
    vi.useFakeTimers();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    localStorage.setItem(
      draftKey('lonely'),
      serializeDraft({ ...BLANK, to: ['ada@example.com'], subject: 'Hi', attachments: [] })!,
    );
    const done = popOuts.popIn('lonely');
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(navigate).toHaveBeenCalledWith('/inbox');
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][0].content.message).toMatchObject({
      to: ['ada@example.com'],
      subject: 'Hi',
    });
    // Taken: the session is over.
    expect(localStorage.getItem(draftKey('lonely'))).toBeNull();
  });
});
