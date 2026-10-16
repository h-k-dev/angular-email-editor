import { SuggestionCommandItem } from '../extension';
import { SuggestionPageRequest, pagedSource } from './paged-source';

interface Row {
  key: string;
  name: string;
}

/** 7 rows, answered by offset the way a LoopBack find does — every filter
    and signal recorded. */
const rows: Row[] = Array.from({ length: 7 }, (_, i) => ({ key: `r${i}`, name: `Row ${i}` }));

describe('pagedSource', () => {
  let asked: { filter: { query: string } & SuggestionPageRequest; signal: AbortSignal }[];

  const source = () =>
    pagedSource({
      from: {
        find: async (filter: { query: string } & SuggestionPageRequest, signal) => {
          asked.push({ filter, signal });
          const matches = rows.filter((row) => row.name.includes(filter.query));
          return matches.slice(filter.skip, filter.skip + filter.limit);
        },
      },
      with: (query, page) => ({ query: query.trim(), ...page }),
      map: (row): SuggestionCommandItem => ({ id: row.key, title: row.name, command: () => true }),
      pageSize: 3,
    });

  beforeEach(() => (asked = []));

  it('asks `with` for the query and the page, and `from` with the filter and the signal', async () => {
    const signal = new AbortController().signal;
    await source()({ query: ' Row ', cursor: null, signal });
    expect(asked).toEqual([{ filter: { query: 'Row', skip: 0, limit: 3 }, signal }]);
  });

  it('maps each row, and pages by offset until a short page', async () => {
    const signal = new AbortController().signal;
    const first = await source()({ query: '', cursor: null, signal });
    expect(Array.isArray(first) ? null : first).toMatchObject({ nextCursor: '3' });
    const second = await source()({ query: '', cursor: '3', signal });
    expect(Array.isArray(second) ? null : second).toMatchObject({ nextCursor: '6' });
    const last = await source()({ query: '', cursor: '6', signal });
    expect(Array.isArray(last) ? null : last).toEqual({
      items: [{ id: 'r6', title: 'Row 6', command: expect.any(Function) }],
      nextCursor: null,
    });
    expect(asked.map(({ filter }) => filter.skip)).toEqual([0, 3, 6]);
  });

  it('defaults to pages of 20', async () => {
    const limits: number[] = [];
    const plain = pagedSource({
      from: {
        find: (page: SuggestionPageRequest): Row[] => {
          limits.push(page.limit);
          return [];
        },
      },
      with: (_query, page) => page,
      map: (row): SuggestionCommandItem => ({ id: row.key, title: row.name, command: () => true }),
    });
    expect(await plain({ query: '', cursor: null, signal: new AbortController().signal })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(limits).toEqual([20]);
  });
});
