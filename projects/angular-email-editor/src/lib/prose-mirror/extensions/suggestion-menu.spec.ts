import { Node as ProseMirrorNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import {
  SuggestionCommandItem,
  SuggestionGroup,
  SuggestionItem,
  SuggestionPage,
  SuggestionRequest,
  extensionSuggestions,
} from '../extension';
import { emailExtensions, richTextExtensions } from './kits';
import {
  MergeTagTriggerOptions,
  caretInsideMergeTag,
  insertMergeTag,
  mergeTagTrigger,
} from './nodes/merge-tag';
import {
  SuggestionAllowProps,
  SuggestionMenuOptions,
  SuggestionMenuState,
  createSuggestionMenu,
} from './suggestion-menu';

/** The `/` menu as a composer sets it up: the kit's commands. */
const slashMenu = (options: Omit<SuggestionMenuOptions, 'trigger'>) =>
  createSuggestionMenu({ trigger: '/', items: extensionSuggestions, ...options });

/** Types `<trigger><group>`, picks the row it finds first — the group — with
    Tab, and types the rest as the level's query: `'/templates news'`. A
    group is entered by a pick only; its name is never in the text. */
function typeIntoGroup(editor: Editor, text: string): void {
  const insert = (part: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(part));
      return true;
    });
  const end = text.search(/\S\s/) + 1;
  insert(text.slice(0, end));
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
  );
  if (text.length > end + 1) insert(text.slice(end + 1));
}

describe('createSuggestionMenu — the / menu', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const keydown = (key: string) =>
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;

    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({ element: menu, onChange: (s) => (state = s) }),
      ],
    });
    // jsdom has no layout; coords only feed positioning, not open/close logic.
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    // jsdom lacks elementFromPoint, which ProseMirror's own mousedown handler hits.
    document.elementFromPoint ??= () => null;
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('opens with the kit-declared commands when / is typed', () => {
    type('/');
    expect(state?.open).toBe(true);
    expect(state?.items.map((item) => item.title)).toEqual([
      'Text',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Quote',
      'Bulleted list',
      'Numbered list',
      'Divider',
      'Heading 1 (layout)',
      'Heading 2 (layout)',
      'Heading 3 (layout)',
      'Bulleted list (layout)',
      'Numbered list (layout)',
      'Spacer',
      'Button',
      'Table',
      'Borderless table',
      'Layout table',
      'Columns',
      '3 columns',
      'Section',
      'Image',
      'Image placeholder',
      'Bold',
      'Italic',
      'Underline',
      'Strike',
      'Uppercase',
    ]);
    expect(menu.hasAttribute('style')).toBe(false);
  });

  it('says the heading each section opens with — the library’s words, or the host’s', () => {
    type('/');
    const items = state!.items;
    // A heading where the section changes, and on no other row.
    items.forEach((item, index) =>
      expect(item.heading !== null).toBe(
        !!item.section && item.section !== items[index - 1]?.section,
      ),
    );
    const headings = items.map((item) => item.heading).filter((heading) => heading !== null);
    expect(headings).toContain('Basic blocks');
    expect(headings).toContain('Styling');
    // An arrow press reports again, and hands a renderer the same rows.
    keydown('ArrowDown');
    expect(state!.activeIndex).toBe(1);
    expect(state!.items[0]).toBe(items[0]);

    // A host's wording, asked afresh: what it leaves out stays the library's,
    // and an id nobody worded shows as it is.
    editor.destroy();
    let language = 'de';
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({
          element: menu,
          onChange: (s) => (state = s),
          items: (ctx) => [
            ...extensionSuggestions(ctx),
            { id: 'mine', title: 'Mine', section: 'mine', command: () => true },
          ],
          sections: (id) => (language === 'de' && id === 'blocks' ? 'Grundbausteine' : undefined),
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    type('/');
    const heading = (section: string) =>
      state!.items.find((item) => item.section === section)!.heading;
    expect(heading('blocks')).toBe('Grundbausteine');
    expect(heading('styling')).toBe('Styling');
    expect(heading('mine')).toBe('mine');
    language = 'en';
    keydown('ArrowDown');
    expect(heading('blocks')).toBe('Basic blocks');
  });

  it('only triggers at a block start or after whitespace', () => {
    type('a/');
    expect(state?.open ?? false).toBe(false);

    type(' /');
    expect(state?.open).toBe(true);
  });

  it('filters by title and keywords as the query grows', () => {
    type('/head');
    expect(state?.items.map((item) => item.title)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 1 (layout)',
      'Heading 2 (layout)',
      'Heading 3 (layout)',
    ]);

    type('ing 2');
    expect(state?.items.map((item) => item.title)).toEqual(['Heading 2', 'Heading 2 (layout)']);

    type('zzz');
    expect(state?.open).toBe(false);
    expect(menu.hasAttribute('style')).toBe(false);
  });

  it('keeps the arrows inside a table cell — the menu wins, not the next cell', () => {
    editor.commands['insertTable'](3, 2);
    type('/');
    expect(state?.open).toBe(true);
    const from = editor.state.selection.from;

    keydown('ArrowDown');
    expect(state?.open).toBe(true);
    expect(state?.activeIndex).toBe(1);
    expect(editor.state.selection.from).toBe(from);
  });

  it('navigates with arrows and applies with Enter, removing the query text', () => {
    type('/head');
    keydown('ArrowDown');
    expect(state?.activeIndex).toBe(1);

    keydown('Enter');
    expect(editor.getHTML()).toBe('<h2 style="margin: 16px 0px 4px; font-size: 20px;"></h2>');
    expect(state?.open).toBe(false);
  });

  it('stops the arrows at both ends, without wrapping or notifying', () => {
    let changes = 0;
    editor.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({
          element: menu,
          onChange: (s) => {
            state = s;
            changes++;
          },
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });

    type('/head');
    changes = 0;
    keydown('ArrowUp');
    expect(state?.activeIndex).toBe(0);
    expect(changes).toBe(0);

    for (let i = 0; i < 5; i++) keydown('ArrowDown');
    expect(state?.activeIndex).toBe(5);
    expect(changes).toBe(5);

    // Held against the bottom: the highlight stays, nothing is emitted, and
    // the key is still taken so the caret does not move.
    const held = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(held);
    keydown('ArrowDown');
    expect(state?.activeIndex).toBe(5);
    expect(changes).toBe(5);
    expect(held.defaultPrevented).toBe(true);
  });

  it('applies items through select() for pointer use', () => {
    type('/qu');
    expect(state?.items.map((item) => item.title)).toEqual(['Quote']);

    state!.select(state!.items[0]);
    expect(editor.getHTML()).toBe(
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><p dir="auto"></p></blockquote>',
    );
    expect(state?.open).toBe(false);
  });

  it('closes on the first mousedown outside, regardless of focus', () => {
    type('/');
    expect(state?.open).toBe(true);

    // e.g. a toolbar button that preventDefaults its mousedown — no blur fires.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state?.open).toBe(false);
    expect(menu.hasAttribute('style')).toBe(false);
  });

  it('stays open when the mousedown is on the menu itself', () => {
    type('/');
    menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state?.open).toBe(true);
  });

  it('closes when clicking blank space inside the editable', () => {
    type('/');
    expect(state?.open).toBe(true);

    // Such clicks map to the nearest text position — often exactly where the
    // cursor already is — so no selection change will close the session.
    editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state?.open).toBe(false);
    expect(menu.hasAttribute('style')).toBe(false);
  });

  it('closes when an outside click blurs the editor', async () => {
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    type('/');
    expect(state?.open).toBe(true);

    // Focus moves elsewhere; the cursor (and thus the session text) is unchanged.
    editor.view.dom.dispatchEvent(new FocusEvent('blur'));
    await nextFrame();
    expect(state?.open).toBe(false);
    expect(menu.hasAttribute('style')).toBe(false);

    // Typing on after refocusing the same slash must not reopen it.
    type('he');
    expect(state?.open).toBe(false);
  });

  it('ranks a title match above keyword-only matches', () => {
    // Table's keywords include "columns" — the title must still win.
    type('/columns');
    expect(state?.items.map((item) => item.title)).toEqual(['Columns', '3 columns', 'Table']);

    editor.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({ element: menu, onChange: (s) => (state = s) }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    type('/table');
    expect(state?.items[0]?.title).toBe('Table');
  });

  it('merges a synchronous source after the static matches', () => {
    editor.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({
          element: menu,
          onChange: (s) => (state = s),
          source: ({ query }) => [
            { id: 'search', title: `Search "${query}"`, command: () => true },
          ],
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });

    type('/quo');
    expect(state?.items.map((item) => item.title)).toEqual(['Quote', 'Search "quo"']);
    expect(state?.loading).toBe(false);

    // No static match at all: the source alone keeps the menu open.
    type('zzz');
    expect(state?.open).toBe(true);
    expect(state?.items.map((item) => item.title)).toEqual(['Search "quozzz"']);
  });

  it('reports loading for an async source and merges the resolved items', async () => {
    let resolve!: (items: SuggestionItem[]) => void;
    editor.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({
          element: menu,
          onChange: (s) => (state = s),
          source: () => new Promise((r) => (resolve = r)),
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });

    type('/zzz'); // nothing static matches — the menu stays open, loading
    expect(state?.loading).toBe(true);
    expect(state?.open).toBe(true);
    expect(menu.hasAttribute('style')).toBe(false);

    resolve([{ id: 'remote', title: 'Remote template', command: () => true }]);
    await Promise.resolve();
    expect(state?.loading).toBe(false);
    expect(state?.items.map((item) => item.title)).toEqual(['Remote template']);
  });

  it('discards a stale async result — a newer query or a dismissal wins', async () => {
    const pending: Array<(items: SuggestionItem[]) => void> = [];
    editor.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({
          element: menu,
          onChange: (s) => (state = s),
          source: () => new Promise((r) => pending.push(r)),
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });

    type('/zz');
    type('z'); // supersedes the first request
    expect(pending).toHaveLength(2);

    pending[0]([{ id: 'stale', title: 'Stale', command: () => true }]);
    await Promise.resolve();
    expect(state?.items.map((item) => item.title)).toEqual([]);
    expect(state?.loading).toBe(true); // the newer request is still out

    keydown('Escape'); // dismissal invalidates the second request too
    pending[1]([{ id: 'late', title: 'Too late', command: () => true }]);
    await Promise.resolve();
    expect(state?.open).toBe(false);
    expect(state?.items).toEqual([]);
  });

  it('closes on Escape and stays closed for the same slash', () => {
    type('/');
    expect(state?.open).toBe(true);

    keydown('Escape');
    expect(state?.open).toBe(false);
    expect(menu.hasAttribute('style')).toBe(false);

    // Continuing to type after the same slash must not reopen it...
    type('he');
    expect(state?.open).toBe(false);

    // ...but a fresh slash elsewhere does.
    type(' /');
    expect(state?.open).toBe(true);
  });
});

describe('createSuggestionMenu — groups, paging, i18n and ARIA', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor | undefined;
  let state: SuggestionMenuState | undefined;
  let inserted: string[];

  const leaf = (id: string, title: string, keywords?: string[]): SuggestionCommandItem => ({
    id,
    title,
    keywords,
    command: () => {
      inserted.push(id);
      return true;
    },
  });

  const templates: SuggestionGroup = {
    id: 'templates',
    title: 'Templates',
    keywords: ['tpl'],
    icon: 'article',
    children: [
      leaf('welcome', 'Welcome mail', ['onboarding']),
      leaf('invoice', 'Invoice reminder'),
      leaf('newsletter', 'Newsletter'),
    ],
  };

  const mount = (options: Partial<SuggestionMenuOptions> = {}) => {
    editor?.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({
          element: menu,
          items: (ctx) => [...extensionSuggestions(ctx), templates],
          onChange: (s) => (state = s),
          ...options,
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    return editor;
  };

  const type = (text: string) =>
    editor!.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  /** Deletes `count` characters before the cursor, one transaction each. */
  const backspace = (count = 1) => {
    for (let i = 0; i < count; i++) {
      editor!.exec((editorState, dispatch) => {
        const { from } = editorState.selection;
        dispatch?.(editorState.tr.delete(from - 1, from));
        return true;
      });
    }
  };

  const keydown = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    editor!.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const text = () => editor!.state.doc.textContent;
  const titles = () => state?.items.map((item) => item.title);

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;
    inserted = [];
    editor = undefined;
    document.elementFromPoint ??= () => null;
    mount();
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it('lists a group on level 1 like any item', () => {
    type('/temp');
    expect(state?.level).toBe(1);
    expect(titles()).toEqual(['Templates']);
  });

  it('opens level 2 on Enter, writing nothing — the text stays the trigger', () => {
    type('/temp');
    keydown('Enter');

    expect(text()).toBe('/');
    expect(state?.open).toBe(true);
    expect(state?.level).toBe(2);
    expect(state?.parent?.id).toBe('templates');
    expect(state?.query).toBe('');
    expect(titles()).toEqual(['Welcome mail', 'Invoice reminder', 'Newsletter']);
    expect(state?.activeIndex).toBe(0);
    expect(inserted).toEqual([]);
  });

  it('searches the children with what follows the trigger', () => {
    typeIntoGroup(editor!, '/templates news');
    expect(text()).toBe('/news');
    expect(state?.level).toBe(2);
    expect(state?.query).toBe('news');
    expect(titles()).toEqual(['Newsletter']);

    // A child's keywords count too.
    backspace(4);
    type('onboard');
    expect(titles()).toEqual(['Welcome mail']);
  });

  it('applies a child with Enter, removing the whole /<query> text', () => {
    typeIntoGroup(editor!, '/templates inv');
    expect(keydown('Enter')).toBe(true);
    expect(inserted).toEqual(['invoice']);
    expect(text()).toBe('');
    expect(state?.open).toBe(false);
  });

  it('is never entered by its name typed out: that is a level-1 query', () => {
    type('/templates ');
    expect(state?.level).toBe(1);
    expect(titles()).toEqual(['Templates']);

    type('news');
    expect(state?.open).toBe(false);
    expect(text()).toBe('/templates news');
  });

  it('goes up on the Backspace key to all of level 1 — for a group of several words too', () => {
    mount({
      items: [
        templates,
        { id: 'fields', title: 'Alle Feldtypen (Test)', children: [leaf('cf_1', 'Name')] },
      ],
    });
    for (const word of ['templates', 'alle']) {
      typeIntoGroup(editor!, `/${word} `);
      expect(state?.level).toBe(2);

      expect(keydown('Backspace')).toBe(true);
      expect(text()).toBe('/');
      expect(state).toMatchObject({ open: true, level: 1, query: '' });
      expect(titles()).toEqual(['Templates', 'Alle Feldtypen (Test)']);
      backspace();
    }
  });

  it('leaves Backspace to the editor while the level’s query has text, and on level 1', () => {
    typeIntoGroup(editor!, '/templates n');
    expect(keydown('Backspace')).toBe(false);

    editor!.setContent('<p></p>');
    type('/tem');
    expect(keydown('Backspace')).toBe(false);
  });

  it('finds a group by a keyword on level 1, and enters it on a pick', () => {
    type('/tpl');
    expect(titles()).toEqual(['Templates']);
    keydown('Tab');
    expect(state?.level).toBe(2);
    type('welc');
    expect(titles()).toEqual(['Welcome mail']);
  });

  it('stays open on level 2 with no matches, and keeps the keys for itself', () => {
    typeIntoGroup(editor!, '/templates zzz');
    expect(state?.open).toBe(true);
    expect(state?.items).toEqual([]);
    expect(menu.hasAttribute('style')).toBe(false);

    expect(keydown('Enter')).toBe(true);
    expect(text()).toBe('/zzz');
    expect(keydown('ArrowDown')).toBe(true);
  });

  it('back() returns to an empty level 1 from the pointer', () => {
    typeIntoGroup(editor!, '/templates news');
    state!.back();
    expect(text()).toBe('/');
    expect(state?.level).toBe(1);
    expect(state?.query).toBe('');
  });

  it('select() on a group opens it, as Enter does', () => {
    type('/');
    const group = state!.items.find((item) => item.id === 'templates')!;
    state!.select(group);
    expect(text()).toBe('/');
    expect(state?.level).toBe(2);
  });

  it('closes level 2 with Escape, like level 1', () => {
    typeIntoGroup(editor!, '/templates ');
    keydown('Escape');
    expect(state?.open).toBe(false);
    type('x');
    expect(state?.open).toBe(false);
  });

  it('asks a children source per search string and discards stale results', async () => {
    const pending: Array<{ query: string; resolve: (items: SuggestionCommandItem[]) => void }> = [];
    mount({
      items: [
        {
          id: 'remote',
          title: 'Remote',
          children: ({ query }) => new Promise((resolve) => pending.push({ query, resolve })),
        },
      ],
      source: () => [leaf('level-one-only', 'Level one only')],
    });

    typeIntoGroup(editor!, '/remote a');
    type('b');
    // Entering asks for the empty query; each keystroke for its own.
    expect(pending.map((p) => p.query)).toEqual(['', 'a', 'ab']);
    expect(state?.loading).toBe(true);
    expect(state?.open).toBe(true);
    // The level-1 source is not asked inside a group.
    expect(titles()).toEqual([]);

    pending[1].resolve([leaf('stale', 'Stale')]);
    await Promise.resolve();
    expect(titles()).toEqual([]);

    pending[2].resolve([leaf('fresh', 'Fresh')]);
    await Promise.resolve();
    expect(state?.loading).toBe(false);
    expect(titles()).toEqual(['Fresh']);
  });

  describe('a paged, server-backed group', () => {
    /** 25 templates, answered five at a time by skip offset, like a REST
        find with limit/skip — every request recorded, each resolved by hand. */
    const catalogue = Array.from({ length: 25 }, (_, i) => leaf(`t${i}`, `Template ${i}`));
    let requests: Array<{ request: SuggestionRequest; resolve: () => void }>;

    const pagedGroup = (): SuggestionGroup => ({
      id: 'remote',
      title: 'Remote',
      children: (request) =>
        new Promise<SuggestionPage<SuggestionCommandItem>>((resolve) => {
          const skip = request.cursor ? Number(request.cursor) : 0;
          const matches = catalogue.filter((t) => t.title.includes(request.query));
          const items = matches.slice(skip, skip + 5);
          const next = skip + 5 < matches.length ? String(skip + 5) : null;
          requests.push({ request, resolve: () => resolve({ items, nextCursor: next }) });
        }),
    });

    const settle = async () => {
      requests.at(-1)!.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };

    beforeEach(() => {
      requests = [];
      mount({ items: [pagedGroup()] });
    });

    it('reports hasMore and appends the next page on loadMore()', async () => {
      typeIntoGroup(editor!, '/remote ');
      expect(requests.map(({ request: { query, cursor } }) => ({ query, cursor }))).toEqual([
        { query: '', cursor: null },
      ]);
      await settle();
      expect(state?.items).toHaveLength(5);
      expect(state?.hasMore).toBe(true);

      state!.loadMore();
      expect(state?.loadingMore).toBe(true);
      expect(requests.at(-1)!.request).toMatchObject({ query: '', cursor: '5' });
      await settle();
      expect(state?.loadingMore).toBe(false);
      expect(titles()?.slice(4, 7)).toEqual(['Template 4', 'Template 5', 'Template 6']);
      expect(state?.items).toHaveLength(10);
    });

    it('lists a row once when the next page repeats it — rows that moved between requests', async () => {
      typeIntoGroup(editor!, '/remote ');
      await settle();
      // A row comes in at the top on the server: skip 5 now starts a row early.
      catalogue.unshift(leaf('new', 'Template new'));
      try {
        state!.loadMore();
        await settle();
      } finally {
        catalogue.shift();
      }
      const ids = state!.items.map((item) => item.id);
      expect(ids).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
    });

    it('loadMore() is a no-op while loading, at the end, or twice in a row', async () => {
      typeIntoGroup(editor!, '/remote ');
      state!.loadMore(); // first page still out
      expect(requests).toHaveLength(1);
      await settle();

      state!.loadMore();
      state!.loadMore();
      expect(requests).toHaveLength(2);
      await settle();

      for (let page = 0; page < 3; page++) {
        state!.loadMore();
        await settle();
      }
      expect(state?.items).toHaveLength(25);
      expect(state?.hasMore).toBe(false);
      state!.loadMore();
      expect(requests).toHaveLength(5);
    });

    it('ArrowDown on the last row fetches once however long it is held, then steps on', async () => {
      let changes = 0;
      mount({ items: [pagedGroup()], onChange: (s) => ((state = s), changes++) });
      requests = [];
      typeIntoGroup(editor!, '/remote ');
      await settle();
      for (let i = 0; i < 4; i++) keydown('ArrowDown');
      expect(state?.activeIndex).toBe(4);
      changes = 0;

      expect(keydown('ArrowDown')).toBe(true);
      expect(keydown('ArrowDown')).toBe(true);
      expect(keydown('ArrowDown')).toBe(true);
      expect(requests).toHaveLength(2);
      expect(changes).toBe(1); // loadingMore on; the held repeats say nothing
      expect(state?.activeIndex).toBe(4);

      await settle();
      expect(state?.activeIndex).toBe(5);
      expect(editor!.view.dom.getAttribute('aria-activedescendant')).toBe(state!.optionId(5));
    });

    it('discards a page that lands after the query changed', async () => {
      typeIntoGroup(editor!, '/remote ');
      await settle();
      state!.loadMore();
      const stale = requests.at(-1)!;

      type('Template 2');
      stale.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(state?.loadingMore).toBe(false);
      expect(state?.loading).toBe(true);

      await settle();
      expect(titles()).toEqual([
        'Template 2',
        'Template 20',
        'Template 21',
        'Template 22',
        'Template 23',
      ]);
      expect(state?.hasMore).toBe(true);
    });

    it('asks at once on every keystroke, aborting the request before', () => {
      typeIntoGroup(editor!, '/remote ');
      type('T');
      type('e');
      expect(requests.map((r) => r.request.query)).toEqual(['', 'T', 'Te']);
      expect(requests.map((r) => r.request.signal.aborted)).toEqual([true, true, false]);
      expect(state?.loading).toBe(true);
      expect(state?.open).toBe(true);
    });

    it('tells the source one session per session and level', () => {
      typeIntoGroup(editor!, '/remote ');
      type('T');
      const [opened, typed] = requests.map((r) => r.request.session);
      expect(typed).toBe(opened);

      keydown('Escape');
      typeIntoGroup(editor!, ' /remote ');
      expect(requests.at(-1)!.request.session).not.toBe(opened);
    });
  });

  describe('i18n', () => {
    beforeEach(() => {
      mount({
        i18n: {
          templates: { title: 'Vorlagen' },
          welcome: { title: 'Willkommensmail', keywords: ['begrüßung'] },
          table: { title: 'Tabelle', keywords: ['raster'] },
        },
      });
    });

    it('shows and ranks the translated title', () => {
      type('/tab');
      expect(titles()?.[0]).toBe('Tabelle');
    });

    it('keeps the English title searchable, plus the extra keywords', () => {
      type('/raster');
      expect(titles()).toEqual(['Tabelle']);

      backspace(6);
      type('table');
      expect(titles()).toContain('Tabelle');
    });

    it('enters by the translated title, and finds the group by the English one', () => {
      type('/vorl');
      keydown('Enter');
      expect(text()).toBe('/');
      expect(state?.level).toBe(2);
      expect(state?.parent?.title).toBe('Vorlagen');

      type('begrüß');
      expect(titles()).toEqual(['Willkommensmail']);

      editor!.setText('');
      typeIntoGroup(editor!, '/templates welcome');
      expect(state?.level).toBe(2);
      expect(titles()).toEqual(['Willkommensmail']);
    });
  });

  it('reads a map’s own entries only: an id such as `constructor` finds nothing inherited', () => {
    mount({
      items: [{ ...leaf('constructor', 'Build'), section: 'toString' }],
      i18n: {},
      sections: {},
    });
    type('/');
    expect(state?.items).toEqual([
      expect.objectContaining({ id: 'constructor', title: 'Build', heading: 'toString' }),
    ]);
  });

  describe('the editor as the combobox', () => {
    const dom = () => editor!.view.dom;

    it('points at the listbox and the active option while open', () => {
      mount({ id: 'slash' });
      expect(dom().hasAttribute('aria-controls')).toBe(false);

      type('/head');
      expect(state?.listboxId).toBe('slash');
      expect(state?.optionId(0)).toBe('slash-option-0');
      expect(dom().getAttribute('aria-controls')).toBe('slash');
      expect(dom().getAttribute('aria-autocomplete')).toBe('list');
      expect(dom().getAttribute('aria-activedescendant')).toBe('slash-option-0');

      keydown('ArrowDown');
      expect(dom().getAttribute('aria-activedescendant')).toBe('slash-option-1');
    });

    it('drops the active descendant when there is nothing to point at', () => {
      typeIntoGroup(editor!, '/templates zzz');
      expect(dom().hasAttribute('aria-controls')).toBe(true);
      expect(dom().hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('clears everything on close and on destroy', () => {
      type('/');
      keydown('Escape');
      expect(dom().hasAttribute('aria-controls')).toBe(false);
      expect(dom().hasAttribute('aria-activedescendant')).toBe(false);

      type(' /');
      const element = dom();
      expect(element.hasAttribute('aria-controls')).toBe(true);
      editor!.destroy();
      editor = undefined;
      expect(element.hasAttribute('aria-controls')).toBe(false);
    });

    it('gives every menu its own listbox id by default', () => {
      type('/');
      const first = state!.listboxId;
      mount();
      type('/');
      expect(state!.listboxId).not.toBe(first);
    });
  });
});

/** A merge-tag row the way a host maps its catalogue: path as the detail,
    the token inserted by the command. */
const tag = (path: string): SuggestionCommandItem => ({
  id: path,
  title: path,
  detail: `{{ ${path} }}`,
  command: insertMergeTag(path),
});

/** The `{{` picker as a composer sets it up: a path query, any prefix. */
const mergeTagMenu = (options: Omit<SuggestionMenuOptions, 'trigger'>) =>
  createSuggestionMenu({
    trigger: '{{',
    startOfWord: false,
    query: /^ ?[\w.]*$/,
    ...options,
  });

describe('createSuggestionMenu — the {{ menu', () => {
  /** A paged in-memory catalogue: 45 fields, 20 per page, cursor = start index. */
  const FIELDS = Array.from({ length: 45 }, (_, i) => `custom.field${i + 1}`);
  const pagedSource = ({ query, cursor }: SuggestionRequest): SuggestionPage => {
    const matches = FIELDS.filter((path) => path.includes(query));
    const start = cursor ? Number(cursor) : 0;
    const items = matches.slice(start, start + 20).map(tag);
    const end = start + items.length;
    return { items, nextCursor: end < matches.length ? String(end) : null };
  };

  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor | undefined;
  let state: SuggestionMenuState | undefined;

  const mount = (options: Partial<SuggestionMenuOptions> = {}) => {
    editor?.destroy();
    state = undefined;
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        mergeTagMenu({
          element: menu,
          source: pagedSource,
          onChange: (s) => (state = s),
          ...options,
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  };

  const type = (text: string) =>
    editor!.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const keydown = (key: string) =>
    editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    editor = undefined;
    document.elementFromPoint ??= () => null;
    mount();
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it('opens on {{ right after any character, with the first page and more to come', () => {
    type('Hi{{');
    expect(state?.open).toBe(true);
    expect(state?.trigger).toBe('{{');
    expect(state?.items).toHaveLength(20);
    expect(state?.hasMore).toBe(true);
  });

  it('does not open on the Handlebars triple-stash', () => {
    type('{{{');
    expect(state?.open ?? false).toBe(false);
  });

  it('takes one space after the braces, and only path characters after that', () => {
    type('{{ field1');
    expect(state?.query).toBe('field1');
    expect(state?.items).toHaveLength(11);

    type(' x'); // a space inside a path is no path
    expect(state?.open).toBe(false);
  });

  it('Enter replaces {{query with the token, which becomes a pill', () => {
    type('Hi {{field20');
    expect(state?.items.map((item) => item.id)).toEqual(['custom.field20']);
    keydown('Enter');
    expect(editor!.getHTML()).toBe('<div>Hi {{ custom.field20 }}</div>');
    expect(state?.open).toBe(false);
  });

  it('pages on ArrowDown at the end, and stops at the ends otherwise', () => {
    type('{{');
    keydown('ArrowUp');
    expect(state?.activeIndex).toBe(0); // no wrap to the bottom
    for (let i = 0; i < 19; i++) keydown('ArrowDown');
    expect(state?.activeIndex).toBe(19);

    keydown('ArrowDown'); // a synchronous page lands at once
    expect(state?.items).toHaveLength(40);
    expect(state?.activeIndex).toBe(20);
  });

  it('closes on Escape and stays closed for the same {{', () => {
    type('{{');
    keydown('Escape');
    expect(state?.open).toBe(false);
    type('fi');
    expect(state?.open).toBe(false);
  });

  describe('a caret inside a token already written', () => {
    const caretInto = (needle: string, offset: number) => {
      const { doc } = editor!.state;
      const pos = 1 + doc.textContent.indexOf(needle) + offset;
      editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.create(doc, pos)));
    };

    const written = () => {
      mount({ allow: ({ state: editorState }) => !caretInsideMergeTag(editorState) });
      editor!.setContent('<p>Hi {{ firstName }} there</p>');
    };

    it('stays shut: those braces open the token, not a query — and Enter leaves it whole', () => {
      written();
      caretInto('firstName', 2);
      expect(state?.open ?? false).toBe(false);
      expect(editor!.view.dom.hasAttribute('aria-controls')).toBe(false);

      keydown('Enter');
      expect(editor!.state.doc.textContent).toBe('Hi {{ firstName }} there');
    });

    it('still opens for a token being typed, right beside the written one', () => {
      written();
      caretInto(' there', 6);
      type(' {{cust');
      expect(state).toMatchObject({ open: true, query: 'cust' });
    });

    it('is asked about the session: the state, its range, its query', () => {
      const allow = vi.fn((_props: SuggestionAllowProps) => true);
      mount({ allow });
      type('Hi {{cu');
      expect(allow).toHaveBeenLastCalledWith(
        expect.objectContaining({ range: { from: 4, to: 8 }, query: 'cu' }),
      );
      expect(allow.mock.lastCall![0].state).toBe(editor!.state);

      allow.mockReturnValue(false);
      type('s');
      expect(state?.open).toBe(false);
    });
  });

  it('keeps its session while an input method composes over a selection', () => {
    type('{{cu');
    expect(state?.open).toBe(true);
    const { doc } = editor!.state;
    Object.defineProperty(editor!.view, 'composing', { configurable: true, get: () => true });
    // The composed letters stand selected, as some input methods leave them.
    editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.create(doc, 3, 5)));
    expect(state?.open).toBe(true);

    Object.defineProperty(editor!.view, 'composing', { configurable: true, get: () => false });
    editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.create(doc, 3, 4)));
    expect(state?.open).toBe(false);
  });
});

describe('mergeTagTrigger', () => {
  let host: HTMLElement;
  let editor: Editor | undefined;
  let state: SuggestionMenuState | undefined;

  const mount = (options: MergeTagTriggerOptions = {}) => {
    editor?.destroy();
    state = undefined;
    const menu = document.createElement('div');
    host.replaceChildren(menu);
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createSuggestionMenu({
          element: menu,
          onChange: (s) => (state = s),
          triggers: [mergeTagTrigger({ items: [tag('firstName'), tag('first name')], ...options })],
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  };

  const type = (text: string) =>
    editor!.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const caretInto = (needle: string, offset: number) => {
    const { doc } = editor!.state;
    const pos = 1 + doc.textContent.indexOf(needle) + offset;
    editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.create(doc, pos)));
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = undefined;
    document.elementFromPoint ??= () => null;
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it('opens on {{ right after a word, and stays shut on {{{', () => {
    mount();
    type('Hi{{');
    expect(state).toMatchObject({ open: true, trigger: '{{' });

    editor!.setContent('<p></p>');
    type('{{{');
    expect(state?.open ?? false).toBe(false);
  });

  it('never opens for a caret inside a token — with or without a host allow', () => {
    const allow = vi.fn(() => true);
    for (const options of [{}, { allow }]) {
      mount(options);
      editor!.setContent('<p>Hi {{ firstName }} there</p>');
      caretInto('firstName', 2);
      expect(state?.open ?? false).toBe(false);
    }
    expect(allow).not.toHaveBeenCalled();
  });

  it('keeps shut outside a token when the host says no', () => {
    mount({ allow: () => false });
    type('{{fi');
    expect(state?.open ?? false).toBe(false);
  });

  it('takes a path by default, and a query of the host’s instead', () => {
    mount();
    type('{{ first name');
    expect(state?.open ?? false).toBe(false);

    mount({ query: /^ ?[^{}]*$/u });
    type('{{ first name');
    expect(state).toMatchObject({ open: true, query: 'first name' });
  });

  describe('a group the menu holds', () => {
    let picked: string[];
    const field = (id: string, title: string): SuggestionCommandItem => ({
      id,
      title,
      command: (editorState, dispatch) => {
        picked.push(id);
        return insertMergeTag(id)(editorState, dispatch);
      },
    });
    const fields: SuggestionGroup = {
      id: 'cf-group-7',
      title: 'Alle Feldtypen (Test)',
      placeholder: 'Search fields…',
      children: [field('cf_1', 'Aktenzeichen'), field('cf_2', 'Gegner')],
    };

    const keydown = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      editor!.view.dom.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const text = () => editor!.state.doc.textContent;
    const titles = () => state?.items.map((item) => item.title);
    const decoration = () => host.querySelector('.aee-suggestion');

    beforeEach(() => {
      picked = [];
      mount({ items: [tag('auto_currentDateDE'), fields] });
    });

    it('is entered by a pick without a word written — the text stays the braces', () => {
      type('Hi {{alle');
      expect(titles()).toEqual(['Alle Feldtypen (Test)']);

      expect(keydown('Enter')).toBe(true);
      expect(text()).toBe('Hi {{');
      expect(state).toMatchObject({ open: true, level: 2, query: '' });
      expect(state?.parent?.id).toBe('cf-group-7');
      expect(titles()).toEqual(['Aktenzeichen', 'Gegner']);
    });

    it('searches the fields with what follows the braces, and a pick writes the token', () => {
      type('{{');
      state!.select(state!.items.find((item) => item.id === 'cf-group-7')!);
      type('geg');
      expect(text()).toBe('{{geg');
      expect(state).toMatchObject({ level: 2, query: 'geg' });
      expect(titles()).toEqual(['Gegner']);

      keydown('Enter');
      expect(picked).toEqual(['cf_2']);
      expect(text()).toBe('{{ cf_2 }}');
      expect(state?.open).toBe(false);
    });

    it('goes up on Backspace over an empty search — the braces stay, level 1 lists everything', () => {
      type('{{');
      keydown('ArrowDown');
      keydown('Enter');
      expect(state?.level).toBe(2);

      expect(keydown('Backspace')).toBe(true);
      expect(text()).toBe('{{');
      expect(state).toMatchObject({ open: true, level: 1, query: '' });
      expect(titles()).toEqual(['auto_currentDateDE', 'Alle Feldtypen (Test)']);

      // On level 1 Backspace is the editor's again.
      expect(keydown('Backspace')).toBe(false);
    });

    it('back() returns to level 1 and drops the search typed inside', () => {
      type('{{');
      keydown('ArrowDown');
      keydown('Enter');
      type('akt');
      state!.back();
      expect(text()).toBe('{{');
      expect(state).toMatchObject({ level: 1, query: '' });
    });

    it('lasts only as long as its session: a new {{ starts on level 1', () => {
      type('{{');
      keydown('ArrowDown');
      keydown('Enter');
      keydown('Escape');
      expect(state?.open).toBe(false);
      expect(text()).toBe('{{');

      type(' {{');
      expect(state).toMatchObject({ open: true, level: 1 });
    });

    it('moves with the trigger as text arrives before it', () => {
      type('{{');
      keydown('ArrowDown');
      keydown('Enter');
      editor!.view.dispatch(editor!.state.tr.insertText('Dear ', 1));
      expect(text()).toBe('Dear {{');
      expect(state).toMatchObject({ open: true, level: 2 });
    });

    it('marks the level in the text: level 2, the group’s name and its placeholder', () => {
      type('{{');
      keydown('ArrowDown');
      keydown('Enter');
      expect(decoration()?.getAttribute('data-level')).toBe('2');
      expect(host.querySelector('.aee-suggestion-level')?.textContent).toBe(
        'Alle Feldtypen (Test) ',
      );
      expect(host.querySelector('.aee-suggestion-hint')?.getAttribute('data-placeholder')).toBe(
        'Search fields…',
      );
      // For the eye only: the braces are all the text there is.
      expect(text()).toBe('{{');
    });

    it('is never entered by a word typed after the braces', () => {
      mount({ items: [fields], query: /^ ?[^{}]*$/u });
      type('{{alle-feldtypen-(test) geg');
      expect(state?.level).toBe(1);
    });
  });
});

describe('createSuggestionMenu — several menus on one editor', () => {
  let host: HTMLElement;
  let slashElement: HTMLElement;
  let tagElement: HTMLElement;
  let editor: Editor;
  let slash: SuggestionMenuState | undefined;
  let tags: SuggestionMenuState | undefined;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const keydown = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const templates: SuggestionGroup = {
    id: 'templates',
    title: 'Templates',
    children: [{ id: 'welcome', title: 'Welcome', command: () => true }],
  };

  beforeEach(() => {
    host = document.createElement('div');
    slashElement = document.createElement('div');
    tagElement = document.createElement('div');
    host.append(slashElement, tagElement);
    document.body.appendChild(host);
    slash = tags = undefined;
    document.elementFromPoint ??= () => null;
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        slashMenu({
          element: slashElement,
          id: 'slash',
          items: (ctx) => [...extensionSuggestions(ctx), templates],
          onChange: (s) => (slash = s),
        }),
        mergeTagMenu({
          element: tagElement,
          id: 'tags',
          items: ['first', 'last'].map(tag),
          onChange: (s) => (tags = s),
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('never opens two at once: the trigger nearest the caret wins', () => {
    typeIntoGroup(editor, '/templates zz');
    expect(slash?.open).toBe(true);
    expect(slash?.level).toBe(2);

    type('{{');
    expect(tags?.open).toBe(true);
    expect(slash?.open).toBe(false);
    expect(slashElement.hasAttribute('style')).toBe(false);
    expect(editor.view.dom.getAttribute('aria-controls')).toBe('tags');
  });

  it('hands the keys to the open one only', () => {
    typeIntoGroup(editor, '/templates zz{{');
    expect(keydown('ArrowDown')).toBe(true);
    expect(tags?.activeIndex).toBe(1);

    keydown('Enter');
    expect(editor.state.doc.textContent).toBe('/zz{{ last }}');
  });

  it('gives the outer menu back once the inner session is gone', () => {
    type('/head{{');
    expect(slash?.open ?? false).toBe(false);
    expect(tags?.open).toBe(true);

    // Delete the braces: no `{{` session any more, the `/` one is back.
    editor.exec((state, dispatch) => {
      const { from } = state.selection;
      dispatch?.(state.tr.delete(from - 2, from));
      return true;
    });
    expect(tags?.open).toBe(false);
    expect(slash?.open).toBe(true);
    expect(editor.view.dom.getAttribute('aria-controls')).toBe('slash');
  });
});

describe('createSuggestionMenu — cancellation and errors', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;
  let requests: Array<{
    request: SuggestionRequest;
    resolve: (items: SuggestionItem[]) => void;
    reject: (reason: unknown) => void;
  }>;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const settle = () => Promise.resolve().then(() => Promise.resolve());

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    requests = [];
    document.elementFromPoint ??= () => null;
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          trigger: '@',
          element: menu,
          source: (request) =>
            new Promise((resolve, reject) => requests.push({ request, resolve, reject })),
          onChange: (s) => (state = s),
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('aborts the request a newer query supersedes, and on dismissal', () => {
    type('@a');
    type('b');
    expect(requests[0].request.signal.aborted).toBe(true);
    expect(requests[1].request.signal.aborted).toBe(false);

    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(requests[1].request.signal.aborted).toBe(true);
  });

  it('aborts what is out when the editor is destroyed', () => {
    type('@a');
    const { signal } = requests[0].request;
    editor.destroy();
    expect(signal.aborted).toBe(true);
    editor = createEditor({ parent: host, extensions: richTextExtensions });
  });

  it('reports a failed answer as error, stays open to say so, and clears it on the next query', async () => {
    type('@a');
    const failure = new Error('503');
    requests[0].reject(failure);
    await settle();
    expect(state?.error).toBe(failure);
    expect(state?.loading).toBe(false);
    expect(state?.open).toBe(true);

    type('b');
    expect(state?.error).toBeNull();
    requests[1].resolve([{ id: 'ada', title: 'Ada', command: () => true }]);
    await settle();
    expect(state?.items.map((item) => item.title)).toEqual(['Ada']);
  });

  it('ignores a failure of a request already aborted', async () => {
    type('@a');
    type('b');
    requests[0].reject(new DOMException('Aborted', 'AbortError'));
    await settle();
    expect(state?.error).toBeNull();
    expect(state?.loading).toBe(true);
  });

  it('rejects an empty trigger', () => {
    expect(() =>
      createEditor({
        parent: host,
        extensions: [...richTextExtensions, createSuggestionMenu({ trigger: '', element: menu })],
      }),
    ).toThrow(/trigger/);
  });
});

describe('createSuggestionMenu — DOM economy', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;
  let changes: number;
  let requests: Array<{
    request: SuggestionRequest;
    resolve: (items: SuggestionItem[]) => void;
  }>;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const keydown = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const person = (name: string): SuggestionCommandItem => ({
    id: name,
    title: name,
    command: (s, dispatch) => {
      dispatch?.(s.tr.insertText(name));
      return true;
    },
  });

  const settle = () => Promise.resolve().then(() => Promise.resolve());

  const mount = (options: Partial<SuggestionMenuOptions> = {}) => {
    editor?.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          trigger: '@',
          element: menu,
          source: (request) => new Promise((resolve) => requests.push({ request, resolve })),
          onChange: (s) => {
            state = s;
            changes++;
          },
          ...options,
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 10,
      right: 11,
      top: 20,
      bottom: 36,
    });
  };

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;
    changes = 0;
    requests = [];
    document.elementFromPoint ??= () => null;
    mount();
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('keeps the previous rows on screen, stale, until the new answer replaces them', async () => {
    type('@a');
    requests[0].resolve([person('Ada'), person('Alan')]);
    await settle();
    const rows = state!.items;

    type('l');
    expect(state?.loading).toBe(true);
    expect(state?.stale).toBe(true);
    expect(state?.items).toEqual(rows); // same rows, nothing torn down

    requests[1].resolve([person('Alan')]);
    await settle();
    expect(state?.stale).toBe(false);
    expect(state?.items.map((item) => item.title)).toEqual(['Alan']);
    expect(state?.items[0]).not.toBe(rows[1]); // the answer's own objects
  });

  it('lets Enter wait on a stale row instead of applying the last query’s pick', async () => {
    type('@a');
    requests[0].resolve([person('Ada')]);
    await settle();

    type('l');
    expect(keydown('Enter')).toBe(true);
    expect(editor.state.doc.textContent).toBe('@al');

    requests[1].resolve([person('Alan')]);
    await settle();
    keydown('Enter');
    expect(editor.state.doc.textContent).toBe('Alan');
  });

  it('starts a new session empty, never with another session’s rows', async () => {
    type('@a');
    requests[0].resolve([person('Ada')]);
    await settle();
    keydown('Escape');

    type(' @');
    expect(state?.stale).toBe(false);
    expect(state?.items).toEqual([]);
  });

  it('lands a synchronous answer with the keystroke — no wait, no loading', () => {
    mount({ source: ({ query }) => [person(`Ada ${query}`)] });
    type('@a');
    expect(state?.loading).toBe(false);
    expect(state?.items.map((item) => item.title)).toEqual(['Ada a']);
  });

  it('writes an editor attribute only when its value changes', async () => {
    type('@');
    requests[0].resolve([person('Ada'), person('Alan'), person('Ann')]);
    await settle();

    const observer = new MutationObserver(() => {});
    observer.observe(editor.view.dom, { attributes: true });
    keydown('ArrowDown');
    const records = observer.takeRecords();
    observer.disconnect();
    // ProseMirror may touch its own class; the menu writes aria-* only.
    const ours = records
      .map((record) => record.attributeName)
      .filter((name) => name?.startsWith('aria-'));
    expect(ours).toEqual(['aria-activedescendant']);
  });

  it('never writes to the menu element — placing it is the renderer’s', async () => {
    type('@');
    requests[0].resolve([person('Ada')]);
    await settle();
    keydown('ArrowDown');
    keydown('Escape');
    expect(menu.hasAttribute('style')).toBe(false);
  });

  it('hands the renderer the session range and the trigger’s box, measured on call', async () => {
    type('Hi @a');
    expect(state?.range).toEqual({ from: 4, to: 6 });
    expect(editor.view.coordsAtPos).not.toHaveBeenCalled();
    expect(state?.clientRect()).toEqual({ left: 10, right: 11, top: 20, bottom: 36 });
    expect(editor.view.coordsAtPos).toHaveBeenCalledWith(4);
  });

  it('emits nothing for a transaction that leaves the session as it was', async () => {
    type('@a');
    requests[0].resolve([person('Ada')]);
    await settle();
    changes = 0;

    editor.view.dispatch(editor.state.tr.setMeta('unrelated', true));
    expect(changes).toBe(0);
  });
});

describe('createSuggestionMenu — listeners, look-behind and the pointer', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;
  let changes: number;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  /** Rows as a renderer would put them in: options carrying the state's ids. */
  const renderRows = () => {
    menu.replaceChildren(
      ...(state?.items ?? []).map((item, index) => {
        const row = document.createElement('div');
        row.setAttribute('role', 'option');
        row.id = state!.optionId(index);
        const label = document.createElement('span');
        label.textContent = item.title;
        row.appendChild(label);
        return row;
      }),
    );
  };

  const moveOver = (target: Element, x: number, y: number) =>
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;
    changes = 0;
    document.elementFromPoint ??= () => null;
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        slashMenu({
          element: menu,
          id: 'slash',
          onChange: (s) => {
            state = s;
            changes++;
          },
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
    vi.restoreAllMocks();
  });

  it('listens for the outside press only while it is open', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const presses = (spy: typeof add | typeof remove) =>
      spy.mock.calls.filter(([name]) => name === 'mousedown').length;

    type('hello');
    expect(presses(add)).toBe(0);

    type(' /');
    expect(presses(add)).toBe(1);
    type('head');
    expect(presses(add)).toBe(1);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state?.open).toBe(false);
    expect(presses(remove)).toBe(1);
  });

  it('lets go of the outside press when the editor is destroyed while open', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    type('/');
    editor.destroy();
    expect(remove.mock.calls.some(([name]) => name === 'mousedown')).toBe(true);
  });

  it('does not look again for a transaction that moved neither text nor caret', () => {
    type('/head');
    const textBetween = vi.spyOn(editor.state.selection.$from.parent, 'textBetween');
    const before = changes;
    editor.view.dispatch(editor.state.tr.setMeta('unrelated', true));
    expect(textBetween).not.toHaveBeenCalled();
    expect(changes).toBe(before);
  });

  it('finds a session at the end of a long paragraph, reading only its tail', () => {
    type('word '.repeat(400));
    type('/head');
    expect(state?.open).toBe(true);
    expect(state?.query).toBe('head');
    const { from, to } = state!.range!;
    expect(editor.state.doc.textBetween(from, to)).toBe('/head');

    const textBetween = vi.spyOn(ProseMirrorNode.prototype, 'textBetween');
    type('i');
    expect(state?.query).toBe('headi');
    expect(editor.state.doc.textBetween(state!.range!.from, state!.range!.to)).toBe('/headi');
    // Never from the paragraph's start: only the tail a session can reach.
    const starts = textBetween.mock.calls.map(([start]) => start as number);
    expect(starts.length).toBeGreaterThan(0);
    expect(Math.min(...starts)).toBeGreaterThan(1500);
    textBetween.mockRestore();

    keydown(editor, 'Enter');
    expect(editor.state.doc.textContent).not.toContain('/headi');
    expect(editor.state.doc.textContent.startsWith('word word')).toBe(true);
  });

  it('still turns down a query longer than the longest one', () => {
    type('/' + 'a'.repeat(101));
    expect(state?.open ?? false).toBe(false);
  });

  describe('the pointer', () => {
    beforeEach(() => {
      type('/head');
      renderRows();
    });

    it('moves the one highlight to the row it moves over — from anywhere inside it', () => {
      const rows = menu.querySelectorAll('[role=option]');
      moveOver(rows[0], 5, 5);
      moveOver(rows[2].querySelector('span')!, 5, 60);
      expect(state?.activeIndex).toBe(2);
      expect(editor.view.dom.getAttribute('aria-activedescendant')).toBe('slash-option-2');
    });

    it('says nothing while it stays on the highlighted row', () => {
      const rows = menu.querySelectorAll('[role=option]');
      moveOver(rows[0], 5, 5);
      moveOver(rows[1], 5, 40);
      const before = changes;
      moveOver(rows[1], 6, 41);
      moveOver(rows[1], 7, 42);
      expect(changes).toBe(before);
    });

    it('ignores a move from where it already rests: the list came to it, not it to the list', () => {
      const rows = menu.querySelectorAll('[role=option]');
      // The first move only says where the pointer is.
      moveOver(rows[2], 5, 60);
      expect(state?.activeIndex).toBe(0);
      // The same spot again — a scroll or an opening menu under a still pointer.
      moveOver(rows[1], 5, 60);
      expect(state?.activeIndex).toBe(0);
    });

    it('lets the keyboard carry on from where the pointer left it', () => {
      const rows = menu.querySelectorAll('[role=option]');
      moveOver(rows[0], 5, 5);
      moveOver(rows[1], 5, 40);
      keydown(editor, 'ArrowDown');
      expect(state?.activeIndex).toBe(2);
    });
  });
});

function keydown(editor: Editor, key: string): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('createSuggestionMenu — several triggers, one menu', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;
  let states: SuggestionMenuState[];

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const snippet = (title: string): SuggestionCommandItem => ({
    id: title,
    title,
    command: (s, dispatch) => {
      dispatch?.(s.tr.insertText(title));
      return true;
    },
  });

  const slash = { trigger: '/', id: 'slash', label: 'Insert block', items: extensionSuggestions };
  const braces = {
    trigger: '{{',
    id: 'tokens',
    label: 'Tokens',
    startOfWord: false,
    query: /^ ?[\w.]*$/,
    items: [snippet('first_name'), snippet('last_name')],
  };
  const pipes = { trigger: '||', id: 'snippets', label: 'Snippets', items: [snippet('Signature')] };

  const mount = (triggers: SuggestionMenuOptions['triggers']) => {
    editor?.destroy();
    state = undefined;
    states = [];
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          element: menu,
          triggers,
          onChange: (s) => {
            state = s;
            states.push(s);
          },
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  };

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    document.elementFromPoint ??= () => null;
    mount([slash, braces, pipes]);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('reports whichever trigger is open: its list, its name, its listbox', () => {
    type('/head');
    expect(state).toMatchObject({ open: true, trigger: '/', label: 'Insert block', query: 'head' });
    expect(state?.listboxId).toBe('slash');
    expect(editor.view.dom.getAttribute('aria-controls')).toBe('slash');

    keydown(editor, 'Escape');
    expect(state).toMatchObject({ open: false, trigger: '/' });

    type(' {{first');
    expect(state).toMatchObject({ open: true, trigger: '{{', label: 'Tokens', query: 'first' });
    expect(state?.items.map((item) => item.title)).toEqual(['first_name']);
    expect(editor.view.dom.getAttribute('aria-controls')).toBe('tokens');
  });

  it('takes any string for a trigger', () => {
    type('||sig');
    expect(state).toMatchObject({ open: true, trigger: '||', label: 'Snippets', query: 'sig' });
    keydown(editor, 'Enter');
    expect(editor.state.doc.textContent).toBe('Signature');
    expect(state?.open).toBe(false);
  });

  it.each([
    ['in the order given', [slash, braces]],
    ['in the other order', [braces, slash]],
  ])(
    'hands over from one trigger to the next without a closed state in between winning — %s',
    (_name, triggers) => {
      mount(triggers);
      type('/head');
      expect(state?.trigger).toBe('/');

      // The nearer trigger takes over: `/` closes and `{{` opens in one
      // transaction, whichever reports first.
      type(' {{');
      expect(state).toMatchObject({ open: true, trigger: '{{' });
      expect(editor.view.dom.getAttribute('aria-controls')).toBe('tokens');

      // …and while `{{` shows, nothing `/` has to say reaches the host.
      const before = states.length;
      type('f');
      expect(states.slice(before).every((s) => s.trigger === '{{')).toBe(true);
    },
  );

  it('dismisses with one press outside, whichever trigger is open', () => {
    type('{{');
    expect(state?.open).toBe(true);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state).toMatchObject({ open: false, trigger: '{{' });
  });

  it('takes the inline trigger and further ones together', () => {
    editor.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          ...slash,
          element: menu,
          triggers: [pipes],
          onChange: (s) => (state = s),
        }),
      ],
    });
    type('/');
    expect(state?.trigger).toBe('/');
    keydown(editor, 'Escape');
    type(' ||');
    expect(state).toMatchObject({ open: true, trigger: '||' });
  });

  it('turns down a menu without a trigger, or with the same one twice', () => {
    expect(() => createSuggestionMenu({ element: menu })).toThrow(/trigger/);
    expect(() => createSuggestionMenu({ element: menu, triggers: [] })).toThrow(/trigger/);
    expect(() => createSuggestionMenu({ element: menu, triggers: [slash, slash] })).toThrow(
      /different/,
    );
  });
});

describe('createSuggestionMenu — the session in the text and in the state', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const marked = () => editor.view.dom.querySelector<HTMLElement>('.aee-suggestion');
  const label = () => editor.view.dom.querySelector<HTMLElement>('.aee-suggestion-level');
  const hint = () => editor.view.dom.querySelector<HTMLElement>('.aee-suggestion-hint');

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;
    document.elementFromPoint ??= () => null;
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          element: menu,
          onChange: (s) => (state = s),
          triggers: [
            {
              trigger: '/',
              placeholder: 'Type to filter…',
              i18n: { plain: { placeholder: 'Find a plain one…' } },
              items: (ctx) => [
                ...extensionSuggestions(ctx),
                {
                  id: 'templates',
                  title: 'Templates',
                  placeholder: 'Search templates…',
                  children: [{ id: 'welcome', title: 'Welcome mail', command: () => true }],
                },
                {
                  id: 'plain',
                  title: 'Plain',
                  children: [{ id: 'note', title: 'Note', command: () => true }],
                },
                {
                  id: 'bare',
                  title: 'Bare',
                  children: [{ id: 'memo', title: 'Memo', command: () => true }],
                },
              ],
            },
            { trigger: '||', items: [{ id: 'sig', title: 'Signature', command: () => true }] },
          ],
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  describe('the decoration', () => {
    it('wraps the trigger and the query, saying whose session it is', () => {
      type('Hi /head');
      expect(marked()?.textContent).toBe('/head');
      expect(marked()?.getAttribute('data-trigger')).toBe('/');
      expect(marked()?.classList.contains('aee-suggestion-empty')).toBe(false);
      expect(marked()?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('carries the placeholder while the query is empty, and only then', () => {
      type('/');
      expect(marked()?.classList.contains('aee-suggestion-empty')).toBe(true);
      expect(marked()?.getAttribute('data-placeholder')).toBe('Type to filter…');

      type('h');
      expect(marked()?.classList.contains('aee-suggestion-empty')).toBe(false);
      expect(marked()?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('draws a group’s name after the trigger, and its placeholder after the caret', () => {
      type('/templates');
      expect(marked()?.getAttribute('data-level')).toBe('1');
      expect(label()).toBeNull();

      keydown(editor, 'Tab');
      expect(state?.level).toBe(2);
      expect(editor.state.doc.textContent).toBe('/');
      expect(marked()?.getAttribute('data-level')).toBe('2');
      expect(marked()?.classList.contains('aee-suggestion-empty')).toBe(true);
      // The hint is the widget's: on the session's span it would paint
      // before the group's name.
      expect(marked()?.hasAttribute('data-placeholder')).toBe(false);
      expect(label()?.textContent).toBe('Templates ');
      expect(label()?.getAttribute('contenteditable')).toBe('false');
      expect(hint()?.classList.contains('aee-suggestion-empty')).toBe(true);
      expect(hint()?.getAttribute('data-placeholder')).toBe('Search templates…');
      // Trigger, name, hint — the caret between the last two.
      expect(marked()!.compareDocumentPosition(label()!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(label()!.compareDocumentPosition(hint()!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(editor.state.selection.from).toBe(2);

      type('wel');
      expect(editor.state.doc.textContent).toBe('/wel');
      expect(marked()?.classList.contains('aee-suggestion-empty')).toBe(false);
      expect(label()?.textContent).toBe('Templates ');
      expect(hint()).toBeNull();
    });

    it('writes none of it: the HTML is the text, and the name goes with the level', () => {
      type('/templ');
      keydown(editor, 'Enter');
      type('wel');
      expect(editor.getHTML()).not.toContain('Templates');
      expect(editor.getHTML()).not.toContain('Search templates');

      keydown(editor, 'Escape');
      expect(label()).toBeNull();
      expect(editor.state.doc.textContent).toBe('/wel');
    });

    it('takes the name back with Backspace: level 1 and the trigger’s own placeholder', () => {
      typeIntoGroup(editor, '/templates ');
      keydown(editor, 'Backspace');
      expect(state?.level).toBe(1);
      expect(label()).toBeNull();
      expect(hint()).toBeNull();
      expect(marked()?.getAttribute('data-placeholder')).toBe('Type to filter…');
    });

    it('takes a group’s placeholder from i18n, and has none for a group given none', () => {
      typeIntoGroup(editor, '/plain ');
      expect(hint()?.getAttribute('data-placeholder')).toBe('Find a plain one…');

      keydown(editor, 'Escape');
      typeIntoGroup(editor, ' /bare ');
      expect(marked()?.getAttribute('data-level')).toBe('2');
      expect(marked()?.classList.contains('aee-suggestion-empty')).toBe(true);
      // Not the trigger's: "Type to filter…" would be wrong inside a group.
      expect(marked()?.hasAttribute('data-placeholder')).toBe(false);
      expect(hint()).toBeNull();
    });

    it('has no placeholder for a trigger that was given none', () => {
      type('||');
      expect(marked()?.getAttribute('data-trigger')).toBe('||');
      expect(marked()?.classList.contains('aee-suggestion-empty')).toBe(true);
      expect(marked()?.hasAttribute('data-placeholder')).toBe(false);
    });

    it('goes when the session does: dismissed, applied, or left', () => {
      type('/quo');
      expect(marked()?.textContent).toBe('/quo');
      keydown(editor, 'Enter');
      expect(marked()).toBeNull();

      type('/head');
      keydown(editor, 'Escape');
      expect(marked()).toBeNull();
    });

    it('is no part of the document', () => {
      type('/head');
      expect(marked()).not.toBeNull();
      expect(editor.getHTML()).not.toContain('aee-suggestion');
      expect(editor.state.doc.textContent).toBe('/head');
    });
  });

  describe('a dismissal', () => {
    it('stays with its trigger when text arrives before it without moving the caret', () => {
      type('Hello /he');
      keydown(editor, 'Escape');
      expect(state?.open).toBe(false);

      // A sync, a collaborator: written before the trigger, the caret stays
      // where it was — after the query.
      editor.view.dispatch(editor.state.tr.insertText('Well. ', 1));
      expect(editor.state.doc.textContent).toBe('Well. Hello /he');
      expect(state?.open).toBe(false);
      expect(marked()).toBeNull();

      type('ad');
      expect(state?.open).toBe(false);
    });

    it('lasts only until the caret has been somewhere else', () => {
      type('Hello /he');
      keydown(editor, 'Escape');
      const end = editor.state.selection.from;
      const at = (pos: number) =>
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
        );
      at(2);
      at(end);
      expect(state?.open).toBe(true);
      expect(marked()?.textContent).toBe('/he');
    });

    it('is the renderer’s to ask for, as Escape would', () => {
      type('/head');
      state!.dismiss();
      expect(state?.open).toBe(false);
      expect(marked()).toBeNull();
      type('ing');
      expect(state?.open).toBe(false);

      // Closed: nothing to dismiss, nothing dispatched.
      const dispatch = vi.spyOn(editor.view, 'dispatch');
      state!.dismiss();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});

describe('createSuggestionMenu — what cannot run is not offered', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const mount = (items: SuggestionMenuOptions['items']) => {
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createSuggestionMenu({ trigger: '/', element: menu, items, onChange: (s) => (state = s) }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  };

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;
    document.elementFromPoint ??= () => null;
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('leaves out an action that says it cannot run — a caret has no selection to clear', () => {
    mount(extensionSuggestions);
    type('/clear');
    expect(state?.items.map((item) => item.id) ?? []).not.toContain('clear-formatting');
  });

  it('offers what the kit declares for a toolbar just as well: /align', () => {
    mount(extensionSuggestions);
    type('/align');
    expect(state?.items.map((item) => item.id)).toEqual([
      'align-left',
      'align-center',
      'align-right',
    ]);
  });

  it('never asks a plain command whether it would run: a host’s may act when called', () => {
    const command = vi.fn(() => true);
    mount([{ id: 'dialog', title: 'Open dialog', command }]);
    type('/open');
    expect(state?.items.map((item) => item.id)).toEqual(['dialog']);
    expect(command).not.toHaveBeenCalled();
  });

  it('asks again as the state moves: offered once it can run', () => {
    let allowed = false;
    mount([{ id: 'gated', title: 'Gated', command: () => true, isEnabled: () => allowed }]);
    type('/gat');
    expect(state?.open ?? false).toBe(false);
    allowed = true;
    type('e');
    expect(state?.items.map((item) => item.id)).toEqual(['gated']);
  });
});

describe('createSuggestionMenu — a translation looked up when the menu opens', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;
  let language: 'en' | 'de';

  const german: Record<string, { title: string; keywords?: string[]; placeholder?: string }> = {
    bold: { title: 'Fett', keywords: ['hervorheben'] },
    templates: { title: 'Vorlagen', placeholder: 'Vorlagen durchsuchen…' },
  };

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const reopen = (text: string) => {
    keydown(editor, 'Escape');
    type(' ' + text);
  };

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;
    language = 'en';
    document.elementFromPoint ??= () => null;
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          trigger: '/',
          element: menu,
          items: (ctx) => [
            ...extensionSuggestions(ctx),
            {
              id: 'templates',
              title: 'Templates',
              placeholder: 'Search templates…',
              children: [{ id: 'welcome', title: 'Welcome mail', command: () => true }],
            },
          ],
          // A translation service's lookup, in one line.
          i18n: (id) => (language === 'de' ? german[id] : undefined),
          onChange: (s) => (state = s),
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('hears a language switch the next time it opens — nothing is re-created', () => {
    type('/bol');
    expect(state?.items.map((item) => item.title)).toEqual(['Bold']);

    language = 'de';
    reopen('/fet');
    expect(state?.items.map((item) => item.title)).toEqual(['Fett']);

    language = 'en';
    reopen('/fet');
    expect(state?.open ?? false).toBe(false);
  });

  it('hears it after a session that found nothing, too — that one never closed', () => {
    type('/zzzz');
    expect(state?.open ?? false).toBe(false);
    language = 'de';
    // No Escape in between: the next trigger simply starts a new session.
    type(' /fet');
    expect(state?.items.map((item) => item.title)).toEqual(['Fett']);
  });

  it('searches both languages at once: the original words always match', () => {
    language = 'de';
    type('/bold');
    expect(state?.items.map((item) => item.title)).toEqual(['Fett']);
    reopen('/hervor');
    expect(state?.items.map((item) => item.title)).toEqual(['Fett']);
  });

  it('finds a group by its translated name as well, with its translated name and placeholder', () => {
    language = 'de';
    typeIntoGroup(editor, '/vorlagen ');
    expect(state).toMatchObject({ level: 2, parent: { title: 'Vorlagen' } });
    const dom = editor.view.dom;
    expect(dom.querySelector('.aee-suggestion-level')?.textContent).toBe('Vorlagen ');
    expect(dom.querySelector('.aee-suggestion-hint')?.getAttribute('data-placeholder')).toBe(
      'Vorlagen durchsuchen…',
    );

    keydown(editor, 'Escape');
    typeIntoGroup(editor, ' /templates ');
    expect(state?.level).toBe(2);
  });

  it('asks a trigger’s own label and placeholder afresh too, when they are functions', () => {
    editor.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          trigger: '/',
          element: menu,
          items: extensionSuggestions,
          label: () => (language === 'de' ? 'Block einfügen' : 'Insert block'),
          placeholder: () => (language === 'de' ? 'Tippen zum Filtern…' : 'Type to filter…'),
          onChange: (s) => (state = s),
        }),
      ],
    });
    const marked = () => editor.view.dom.querySelector('.aee-suggestion');
    type('/');
    expect(state?.label).toBe('Insert block');
    expect(marked()?.getAttribute('data-placeholder')).toBe('Type to filter…');

    language = 'de';
    reopen('/');
    expect(state?.label).toBe('Block einfügen');
    expect(marked()?.getAttribute('data-placeholder')).toBe('Tippen zum Filtern…');
  });

  it('does not look anything up while the menu is only being typed in', () => {
    const lookup = vi.fn(() => undefined);
    editor.destroy();
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          trigger: '/',
          element: menu,
          items: extensionSuggestions,
          i18n: lookup,
          onChange: (s) => (state = s),
        }),
      ],
    });
    lookup.mockClear();
    type('/');
    const perOpen = lookup.mock.calls.length;
    expect(perOpen).toBeGreaterThan(0);
    type('bo');
    type('ld');
    expect(lookup.mock.calls.length).toBe(perOpen);
  });
});

describe('createSuggestionMenu — scripts that write no spaces', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SuggestionMenuState | undefined;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;
    document.elementFromPoint ??= () => null;
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({
          trigger: '/',
          element: menu,
          items: (ctx) => [
            ...extensionSuggestions(ctx),
            {
              id: 'templates',
              title: 'Templates',
              children: [{ id: 'welcome', title: 'Welcome mail', command: () => true }],
            },
          ],
          i18n: {
            bold: { title: '太字', keywords: ['ふとじ'] },
            templates: { title: 'テンプレート' },
          },
          onChange: (s) => (state = s),
        }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('opens right after a Japanese character: there, every character starts a word', () => {
    type('こんにちは/');
    expect(state?.open).toBe(true);
  });

  it('still leaves a / inside Latin text alone', () => {
    type('and/');
    expect(state?.open ?? false).toBe(false);
  });

  it('finds a row by its reading, before the input method has converted it', () => {
    type('/ふと');
    expect(state?.items.map((item) => item.title)).toEqual(['太字']);
  });

  it('finds a group by a name written without spaces, and enters it on a pick', () => {
    type('/テンプレート');
    keydown(editor, 'Tab');
    expect(state).toMatchObject({ level: 2, parent: { title: 'テンプレート' } });
    type('wel');
    expect(state?.items.map((item) => item.title)).toEqual(['Welcome mail']);
  });
});
