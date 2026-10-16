import { SuggestionItem, SuggestionSource } from '../extension';

/** The page a {@link pagedSource} asks its `with` to encode: how many rows
    are listed already (the offset), and how many to fetch. */
export interface SuggestionPageRequest {
  skip: number;
  limit: number;
}

/** Where a {@link pagedSource} fetches from: anything with a `find` — a
    backend model's client, a service. */
export interface SuggestionFrom<TFilter, TRow> {
  /** The rows for a filter. Hand the signal on to `fetch` / `HttpClient`:
      it aborts once the answer is no longer wanted. */
  find(filter: TFilter, signal: AbortSignal): readonly TRow[] | Promise<readonly TRow[]>;
}

export interface PagedSourceOptions<TFilter, TRow, T extends SuggestionItem> {
  /** What fetches the rows. */
  from: SuggestionFrom<TFilter, TRow>;
  /** The filter for a query and a page, in the transport's own shape: a
      LoopBack `{ where, order, skip, limit }`, a search index's
      `{ q, offset, limit }`. The query is as typed — trim it here if the
      backend should not see the spaces. */
  with: (query: string, page: SuggestionPageRequest) => TFilter;
  /** A row as a suggestion. Its `id` is the row's own key — the id the
      backend has, never one made from the words shown: the menu tracks a row
      by it and lists an id once, so a page that repeats a row (rows that
      moved between requests) adds nothing. */
  map: (row: TRow) => T;
  /** Rows a page asks for. A page with fewer is the last one.
      @default 20 */
  pageSize?: number;
}

/**
 * A {@link SuggestionSource} for a backend that pages by offset — the
 * paging written once: a query and a page become a filter (`with`), the
 * filter becomes rows (`from`), each row a suggestion (`map`). The cursor
 * is the next page's offset; a short page ends the list.
 *
 *     createSuggestionMenu({
 *       trigger: '{{',
 *       source: pagedSource({
 *         from: { find: (filter, signal) => api.mergeTags(filter, signal) },
 *         with: (query, { skip, limit }) => ({ where: { path: { ilike: `%${query}%` } }, skip, limit }),
 *         map: (row) => ({ id: row.path, title: row.label, command: insertMergeTag(row.path) }),
 *       }),
 *       …
 *     });
 *
 * Anything else — a cursor of the backend's own, a merged answer of two
 * calls — is a {@link SuggestionSource} written by hand.
 */
export function pagedSource<TFilter, TRow, T extends SuggestionItem>(
  options: PagedSourceOptions<TFilter, TRow, T>,
): SuggestionSource<T> {
  const { from, map, pageSize = 20 } = options;
  return async ({ query, cursor, signal }) => {
    const skip = cursor ? Number(cursor) : 0;
    const rows = await from.find(options.with(query, { skip, limit: pageSize }), signal);
    return {
      items: rows.map(map),
      nextCursor: rows.length < pageSize ? null : String(skip + pageSize),
    };
  };
}
