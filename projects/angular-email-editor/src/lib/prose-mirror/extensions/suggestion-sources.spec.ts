import { createEditor } from '../editor';
import {
  SuggestionCommandItem,
  SuggestionPage,
  SuggestionRequest,
  SuggestionSource,
} from '../extension';
import { richTextExtensions } from './kits';
import { SuggestionMenuState, createSuggestionMenu, matchSuggestions } from './suggestion-menu';
import {
  SuggestionPageRequest,
  cachedSource,
  debouncedSource,
  listSource,
  pagedSource,
} from './suggestion-sources';

interface Row {
  key: string;
  name: string;
}

/** 7 rows, answered by offset the way a LoopBack find does. */
const rows: Row[] = Array.from({ length: 7 }, (_, i) => ({ key: `r${i}`, name: `Row ${i}` }));

const item = (row: Row): SuggestionCommandItem => ({
  id: row.key,
  title: row.name,
  command: () => true,
});

const session = {};
const ask = (query: string, cursor: string | null = null, signal = new AbortController().signal) =>
  ({ query, cursor, signal, session }) satisfies SuggestionRequest;

/** What a source answered, as a page — awaited when it is a promise. */
const answerOf = async <T extends SuggestionCommandItem>(
  answer: ReturnType<SuggestionSource<T>>,
) => {
  const settled = await answer;
  return (Array.isArray(settled) ? { items: settled } : settled) as SuggestionPage<T>;
};

describe('pagedSource', () => {
  let asked: { filter: { query: string } & SuggestionPageRequest; signal: AbortSignal }[];

  const source = (options: { debounce?: number; cache?: false | { ttl?: number } } = {}) =>
    pagedSource({
      from: {
        find: async (filter: { query: string } & SuggestionPageRequest, signal) => {
          asked.push({ filter, signal });
          const matches = rows.filter((row) => row.name.includes(filter.query));
          return matches.slice(filter.skip, filter.skip + filter.limit);
        },
      },
      with: (query, page) => ({ query: query.trim(), ...page }),
      map: item,
      pageSize: 3,
      ...options,
    });

  beforeEach(() => (asked = []));
  afterEach(() => vi.useRealTimers());

  it('asks `with` for the query and the page, and `from` with the filter', async () => {
    await source()(ask(' Row '));
    expect(asked.map(({ filter }) => filter)).toEqual([{ query: 'Row', skip: 0, limit: 3 }]);
  });

  it('hands `from` the request’s own signal when it does not cache', async () => {
    const { signal } = new AbortController();
    await source({ cache: false })(ask('', null, signal));
    expect(asked[0].signal).toBe(signal);
  });

  it('maps each row, and pages by offset until a short page', async () => {
    const paged = source();
    expect(await answerOf(paged(ask('')))).toMatchObject({ nextCursor: '3' });
    expect(await answerOf(paged(ask('', '3')))).toMatchObject({ nextCursor: '6' });
    expect(await answerOf(paged(ask('', '6')))).toEqual({
      items: [{ id: 'r6', title: 'Row 6', command: expect.any(Function) }],
      nextCursor: null,
    });
    expect(asked.map(({ filter }) => filter.skip)).toEqual([0, 3, 6]);
  });

  it('defaults to pages of 20, and answers a synchronous find synchronously', () => {
    const limits: number[] = [];
    const plain = pagedSource({
      from: {
        find: (page: SuggestionPageRequest): Row[] => {
          limits.push(page.limit);
          return [];
        },
      },
      with: (_query, page) => page,
      map: item,
    });
    expect(plain(ask(''))).toEqual({ items: [], nextCursor: null });
    expect(limits).toEqual([20]);
  });

  describe('debounce', () => {
    it('asks the first query at once, then waits 300ms for the typing to settle', async () => {
      vi.useFakeTimers();
      const paged = source({ cache: false });
      void paged(ask('R'));
      expect(asked).toHaveLength(1);

      const typing = new AbortController();
      const superseded = paged(ask('Ro', null, typing.signal));
      const settled = paged(ask('Row'));
      typing.abort(); // the menu aborts the request a keystroke supersedes
      await expect(superseded).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(299);
      expect(asked).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(asked.map(({ filter }) => filter.query)).toEqual(['R', 'Row']);
      expect((await answerOf(settled)).items).toHaveLength(3);
    });

    it('never holds a further page', () => {
      vi.useFakeTimers();
      const paged = source({ cache: false });
      void paged(ask(''));
      void paged(ask('', '3'));
      expect(asked).toHaveLength(2);
    });

    it('asks on every keystroke with 0', () => {
      vi.useFakeTimers();
      const paged = source({ cache: false, debounce: 0 });
      void paged(ask('R'));
      void paged(ask('Ro'));
      expect(asked).toHaveLength(2);
    });

    it('drops a held query its signal aborts — the backend never sees it', async () => {
      vi.useFakeTimers();
      const paged = source({ cache: false });
      void paged(ask(''));
      const typing = new AbortController();
      const held = paged(ask('R', null, typing.signal));
      typing.abort();
      await expect(held).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(1000);
      expect(asked).toHaveLength(1);
    });
  });

  describe('cache', () => {
    it('answers a query asked again at once — synchronously, without `from`', async () => {
      const paged = source();
      await paged(ask('Row'));
      const again = paged(ask('Row'));
      expect(Array.isArray(again) || !('then' in again)).toBe(true);
      expect((await answerOf(again)).items.map((i) => i.id)).toEqual(['r0', 'r1', 'r2']);
      expect(asked).toHaveLength(1);
    });

    it('asks every time with `cache: false`', async () => {
      const paged = source({ cache: false, debounce: 0 });
      await paged(ask('Row'));
      await paged(ask('Row'));
      expect(asked).toHaveLength(2);
    });

    it('asks again once a page is past its ttl', async () => {
      vi.useFakeTimers();
      const paged = source({ cache: { ttl: 1000 } });
      await paged(ask('Row'));
      await vi.advanceTimersByTimeAsync(999);
      await paged(ask('Row'));
      expect(asked).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await paged(ask('Row'));
      expect(asked).toHaveLength(2);
    });
  });
});

describe('cachedSource', () => {
  let calls: {
    request: SuggestionRequest;
    resolve: (rows: Row[]) => void;
    reject: (e: unknown) => void;
  }[];
  const inner: SuggestionSource<SuggestionCommandItem> = (request) =>
    new Promise((resolve, reject) =>
      calls.push({ request, resolve: (r) => resolve(r.map(item)), reject }),
    );

  beforeEach(() => (calls = []));

  it('remembers a page, never a failure', async () => {
    const cached = cachedSource(inner);
    const failed = cached(ask('a'));
    calls[0].reject(new Error('down'));
    await expect(failed).rejects.toThrow('down');

    const retried = cached(ask('a'));
    expect(calls).toHaveLength(2);
    calls[1].resolve(rows.slice(0, 1));
    await retried;
    await Promise.resolve();
    expect(cached(ask('a'))).toMatchObject({ items: [{ id: 'r0' }], nextCursor: null });
  });

  it('keeps a page per query and cursor', async () => {
    const cached = cachedSource(inner);
    void cached(ask('a'));
    void cached(ask('a', '20'));
    void cached(ask('b'));
    expect(calls.map(({ request: { query, cursor } }) => [query, cursor])).toEqual([
      ['a', null],
      ['a', '20'],
      ['b', null],
    ]);
  });

  it('shares one request between two askers of one query', async () => {
    const cached = cachedSource(inner);
    const first = cached(ask('a'));
    const second = cached(ask('a'));
    expect(calls).toHaveLength(1);
    calls[0].resolve(rows.slice(0, 2));
    expect((await answerOf(first)).items).toEqual((await answerOf(second)).items);
  });

  it('aborts a shared request only when every asker gave up — and keeps nothing of it', async () => {
    const cached = cachedSource(inner);
    const one = new AbortController();
    const two = new AbortController();
    const first = cached(ask('a', null, one.signal));
    const second = cached(ask('a', null, two.signal));
    one.abort();
    await expect(first).rejects.toBeDefined();
    expect(calls[0].request.signal.aborted).toBe(false);

    two.abort();
    await expect(second).rejects.toBeDefined();
    expect(calls[0].request.signal.aborted).toBe(true);

    calls[0].resolve(rows); // a source that answers anyway
    await Promise.resolve();
    void cached(ask('a'));
    expect(calls).toHaveLength(2);
  });

  it('lets the oldest page go once more than `max` are kept', async () => {
    const cached = cachedSource(inner, { max: 2 });
    for (const query of ['a', 'b', 'c']) {
      const answer = cached(ask(query));
      calls.at(-1)!.resolve([]);
      await answer;
      await Promise.resolve();
    }
    void cached(ask('c'));
    void cached(ask('b'));
    expect(calls).toHaveLength(3);
    void cached(ask('a'));
    expect(calls).toHaveLength(4);
  });
});

describe('debouncedSource', () => {
  afterEach(() => vi.useRealTimers());

  it('holds a query asked within the wait, and asks it once the wait is out', async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    const paced = debouncedSource(({ query }) => (asked.push(query), []), 100);
    paced(ask('a'));
    const held = paced(ask('ab'));
    expect(asked).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(100);
    expect(asked).toEqual(['a', 'ab']);
    expect(await held).toEqual([]);
  });
});

describe('listSource', () => {
  let loads: number;
  const fields: Row[] = [
    { key: 'due', name: 'Kündigungsdatum' },
    { key: 'date', name: 'Datum' },
    { key: 'city', name: 'Stadt' },
  ];
  const from = {
    find: async (filter: { group: string } | undefined) => {
      loads++;
      return filter?.group === 'none' ? [] : fields;
    },
  };

  beforeEach(() => (loads = 0));
  afterEach(() => vi.useRealTimers());

  it('loads once and searches the list as the menu does — every word, best first', async () => {
    const source = listSource({ from, with: () => ({ group: 'contract' }), map: item });
    expect((await answerOf(source(ask('datum')))).items.map((i) => i.id)).toEqual(['date', 'due']);
    expect((await answerOf(source(ask('datum kündigung')))).items.map((i) => i.id)).toEqual([
      'due',
    ]);
    expect(loads).toBe(1);
  });

  it('answers synchronously once loaded', async () => {
    const source = listSource({ from, map: item });
    await source(ask(''));
    expect(source(ask('stadt'))).toMatchObject([{ id: 'city' }]);
  });

  it('loads afresh after its ttl', async () => {
    vi.useFakeTimers();
    const source = listSource({ from, map: item, cache: { ttl: 1000 } });
    await source(ask(''));
    await vi.advanceTimersByTimeAsync(1000);
    await source(ask(''));
    expect(loads).toBe(2);
  });

  it('with `cache: false`, loads once per session and searches that load', async () => {
    const source = listSource({ from, map: item, cache: false });
    const first = {};
    await source({ ...ask(''), session: first });
    await source({ ...ask('stadt'), session: first });
    expect(loads).toBe(1);
    await source({ ...ask(''), session: {} });
    expect(loads).toBe(2);
  });

  describe('typing on while the list loads', () => {
    let aborted: number;
    /** A load of 200 ms that counts its calls and its aborts. */
    const slow = {
      find: (_filter: unknown, signal: AbortSignal) => {
        loads++;
        return new Promise<Row[]>((resolve, reject) => {
          const timer = setTimeout(() => resolve(fields), 200);
          signal.addEventListener('abort', () => {
            aborted++;
            clearTimeout(timer);
            reject(signal.reason);
          });
        });
      },
    };

    /** As the menu asks: each keystroke aborts the request before it. */
    const typeOn = async (source: SuggestionSource<SuggestionCommandItem>) => {
      const session = {};
      let controller = new AbortController();
      let answer = source({ ...ask(''), signal: controller.signal, session });
      for (const query of ['d', 'da', 'dat', 'datu']) {
        await vi.advanceTimersByTimeAsync(50);
        controller.abort();
        controller = new AbortController();
        answer = source({ ...ask(query), signal: controller.signal, session });
      }
      await vi.advanceTimersByTimeAsync(200);
      return { answer: await answerOf(answer), next: source({ ...ask('kün'), session }) };
    };

    beforeEach(() => {
      aborted = 0;
      vi.useFakeTimers();
    });

    it.each([{}, { cache: false as const }])(
      'asks `from` once, and answers the next keystroke at once (%j)',
      async (options) => {
        const { answer, next } = await typeOn(listSource({ from: slow, map: item, ...options }));
        expect({ loads, aborted }).toEqual({ loads: 1, aborted: 0 });
        expect(answer.items.map((i) => i.title)).toEqual(['Datum', 'Kündigungsdatum']);
        expect(next).toMatchObject([{ title: 'Kündigungsdatum' }]);
      },
    );
  });
});

describe('matchSuggestions', () => {
  /** One table run through both: the exported matcher, and what level 1 of a
      menu lists for the same items and query. */
  const items: SuggestionCommandItem[] = [
    { id: 'due', title: 'Kündigungsdatum', keywords: ['termination'], command: () => true },
    { id: 'date', title: 'Datum', command: () => true },
    { id: 'start', title: 'Start date', keywords: ['datum'], command: () => true },
    { id: 'notice', title: 'Notice period', keywords: ['kündigung', 'frist'], command: () => true },
  ];
  const cases = ['', 'datum', 'dat', 'kündigung', 'datum kündigung', 'frist notice', 'nothing'];

  const listed = (query: string): string[] => {
    let state: SuggestionMenuState | undefined;
    const host = document.createElement('div');
    const menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    const editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSuggestionMenu({ trigger: '/', element: menu, items, onChange: (s) => (state = s) }),
      ],
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    editor.exec((s, dispatch) => (dispatch?.(s.tr.insertText(`/${query}`)), true));
    const ids = state?.open ? state.items.map((entry) => entry.id) : [];
    editor.destroy();
    host.remove();
    return ids;
  };

  it.each(cases)('lists what level 1 lists for %j', (query) => {
    expect(matchSuggestions(items, query).map((entry) => entry.id)).toEqual(listed(query));
  });

  it('ranks exact title, title prefix, title contains, then keyword only', () => {
    expect(matchSuggestions(items, 'datum').map((entry) => entry.id)).toEqual([
      'date',
      'due',
      'start',
    ]);
  });
});
