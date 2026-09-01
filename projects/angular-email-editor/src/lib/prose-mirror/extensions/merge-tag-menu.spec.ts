import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import {
  MergeTagItem,
  MergeTagMenuState,
  MergeTagPage,
  MergeTagRequest,
  createMergeTagMenu,
} from './merge-tag-menu';

/** A paged in-memory source: 45 fields, 20 per page, cursor = start index. */
const FIELDS: MergeTagItem[] = Array.from({ length: 45 }, (_, i) => ({
  path: `custom.field${i + 1}`,
  label: `Field ${i + 1}`,
}));

function pagedSource(request: MergeTagRequest): MergeTagPage {
  const matches = FIELDS.filter((f) => f.path.includes(request.query));
  const start = request.cursor ? Number(request.cursor) : 0;
  const items = matches.slice(start, start + 20);
  const end = start + items.length;
  return { items, nextCursor: end < matches.length ? String(end) : null };
}

describe('createMergeTagMenu', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: MergeTagMenuState | undefined;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const keydown = (key: string) =>
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  const settle = () => Promise.resolve().then(() => Promise.resolve());

  const mount = (
    getTags: (request: MergeTagRequest) => MergeTagPage | Promise<MergeTagPage>,
    debounce = 0,
  ) => {
    editor?.destroy();
    state = undefined;
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createMergeTagMenu({ element: menu, getTags, debounce, onChange: (s) => (state = s) }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    document.elementFromPoint ??= () => null;
  };

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    mount(pagedSource);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('opens on {{ with the first page and reports more to come', async () => {
    type('Hi {{');
    await settle();
    expect(state?.open).toBe(true);
    expect(state?.items).toHaveLength(20);
    expect(state?.hasMore).toBe(true);
    expect(menu.style.visibility).toBe('visible');
  });

  it('does not open on the Handlebars triple-stash', async () => {
    type('{{{');
    await settle();
    expect(state?.open ?? false).toBe(false);
  });

  it('re-queries as the path is typed, resetting the pages', async () => {
    type('{{');
    await settle();
    type('field1');
    await settle();
    // field1, field10..field19 — 11 matches, one page, no cursor left.
    expect(state?.items.map((item) => item.path)).toContain('custom.field1');
    expect(state?.items).toHaveLength(11);
    expect(state?.hasMore).toBe(false);
  });

  it('loadMore appends the next page until the cursor runs out', async () => {
    type('{{');
    await settle();
    expect(state?.items).toHaveLength(20);

    state!.loadMore();
    await settle();
    expect(state?.items).toHaveLength(40);
    expect(state?.hasMore).toBe(true);

    state!.loadMore();
    await settle();
    expect(state?.items).toHaveLength(45);
    expect(state?.hasMore).toBe(false);

    state!.loadMore(); // no cursor left — a safe no-op
    await settle();
    expect(state?.items).toHaveLength(45);
  });

  it('ArrowDown at the list end fetches the next page instead of wrapping', async () => {
    type('{{');
    await settle();
    for (let i = 0; i < 19; i++) keydown('ArrowDown');
    expect(state?.activeIndex).toBe(19);

    keydown('ArrowDown'); // at the end, more pages exist
    await settle();
    expect(state?.activeIndex).toBe(19); // stays put…
    expect(state?.items).toHaveLength(40); // …while the list grows below

    keydown('ArrowDown');
    expect(state?.activeIndex).toBe(20);
  });

  it('select replaces the {{query text with a pill', async () => {
    type('Hi {{field3');
    await settle();
    const item = state!.items.find((entry) => entry.path === 'custom.field3')!;
    state!.select(item);
    expect(editor.getHTML()).toBe('<div>Hi {{custom.field3}}</div>');
    expect(state?.open).toBe(false);
  });

  it('Enter applies the highlighted item', async () => {
    type('{{field20');
    await settle();
    expect(state?.items.map((item) => item.path)).toEqual(['custom.field20']);
    keydown('Enter');
    expect(editor.getHTML()).toBe('<div>{{custom.field20}}</div>');
  });

  it('discards a stale page — a newer query or a dismissal wins', async () => {
    const pending: Array<(page: MergeTagPage) => void> = [];
    mount(() => new Promise((resolve) => pending.push(resolve)));

    type('{{a');
    type('b'); // supersedes the first request
    expect(pending).toHaveLength(2);

    pending[0]({ items: [{ path: 'stale' }] });
    await settle();
    expect(state?.items).toEqual([]);
    expect(state?.loading).toBe(true); // the newer request is still out

    keydown('Escape'); // dismissal invalidates the second request too
    pending[1]({ items: [{ path: 'too.late' }] });
    await settle();
    expect(state?.open).toBe(false);
    expect(state?.items).toEqual([]);
  });

  it('a debounced source is asked once for the settled query', async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    mount((request) => {
      asked.push(request.query);
      return pagedSource(request);
    }, 150);

    type('{{f');
    type('i');
    type('eld1');
    expect(state?.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(asked).toEqual(['field1']);
    expect(state?.items).toHaveLength(11);
    vi.useRealTimers();
  });

  it('closes on Escape and stays closed for the same {{', async () => {
    type('{{');
    await settle();
    expect(state?.open).toBe(true);

    keydown('Escape');
    expect(state?.open).toBe(false);
    expect(menu.style.visibility).toBe('hidden');

    type('fi');
    await settle();
    expect(state?.open).toBe(false);

    type(' {{');
    await settle();
    expect(state?.open).toBe(true);
  });
});
