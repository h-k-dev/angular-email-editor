import { SuggestionItem, SuggestionPage, SuggestionSource } from '../extension';
import { matchSuggestions } from './suggestion-menu';

/**
 * Sources in one grammar — where the rows come `from`, what to ask it
 * `with`, and how to `map` a row to a suggestion:
 *
 *  - {@link pagedSource}: the backend matches; a query and a page become a
 *    filter, page by page.
 *  - {@link listSource}: the list is loaded once, and the menu's own search
 *    matches it.
 *
 * Both wait for the typing to settle before they reach the backend and
 * remember what it answered; {@link debouncedSource} and
 * {@link cachedSource} are the same two behaviours for a source written by
 * hand.
 */

/** The wait {@link pagedSource} and {@link debouncedSource} default to. */
const DEBOUNCE = 300;

function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T> | null)?.then === 'function';
}

/** `next` of a value — at once when there is one, when it lands for a
    promise: a synchronous answer stays synchronous. */
function then<A, B>(value: A | PromiseLike<A>, next: (value: A) => B): B | Promise<B> {
  return isThenable<A>(value) ? Promise.resolve(value).then(next) : next(value);
}

function pageOf<T extends SuggestionItem>(answer: T[] | SuggestionPage<T>): SuggestionPage<T> {
  return Array.isArray(answer)
    ? { items: answer, nextCursor: null }
    : { items: answer.items, nextCursor: answer.nextCursor ?? null };
}

/** How long a source remembers its answers, and how many it keeps. */
export interface SourceCacheOptions {
  /** How long an answer stays fresh, in milliseconds. @default 60_000 */
  ttl?: number;
  /** The most answers kept; the oldest go first. @default 50 */
  max?: number;
}

/** The page a {@link pagedSource} asks its `with` to encode: how many rows
    are listed already (the offset), and how many to fetch. */
export interface SuggestionPageRequest {
  skip: number;
  limit: number;
}

/** Where a source fetches from: anything with a `find` — a backend model's
    client, a service. */
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
  /** Milliseconds a new query waits for the typing to settle before `from`
      is asked — a backend should see the settled query, not every letter.
      The first query after a pause goes at once (the menu opening, a group
      entered), and a further page never waits. 0 asks on every keystroke.
      @default 300 */
  debounce?: number;
  /** Pages remembered by query and cursor, so a query asked again — the
      menu opened again, a letter typed and taken back — lands at once, with
      no request and no loading. `false` asks the backend every time. A
      `with` that reads live state (what is chosen elsewhere, a filter on the
      page) wants `false`: the cache knows only the query. The cache lives as
      long as the source does — one per injector for a source behind a
      `providedIn: 'root'` token. @default { ttl: 60_000, max: 50 } */
  cache?: SourceCacheOptions | false;
}

/**
 * A {@link SuggestionSource} for a backend that pages by offset — the
 * paging written once: a query and a page become a filter (`with`), the
 * filter becomes rows (`from`), each row a suggestion (`map`). The cursor
 * is the next page's offset; a short page ends the list. It waits for the
 * typing to settle and remembers its pages (`debounce`, `cache`).
 *
 *     createSuggestionMenu({
 *       element,
 *       onChange,
 *       triggers: [
 *         mergeTagTrigger({
 *           source: pagedSource({
 *             from: { find: (filter, signal) => api.mergeTags(filter, signal) },
 *             with: (query, { skip, limit }) => ({ where: { path: { ilike: `%${query}%` } }, skip, limit }),
 *             map: (row) => ({ id: row.path, title: row.label, command: insertMergeTag(row.path) }),
 *           }),
 *         }),
 *       ],
 *     });
 *
 * Anything else — a cursor of the backend's own, a merged answer of two
 * calls — is a {@link SuggestionSource} written by hand.
 */
export function pagedSource<TFilter, TRow, T extends SuggestionItem>(
  options: PagedSourceOptions<TFilter, TRow, T>,
): SuggestionSource<T> {
  const { from, map, pageSize = 20, debounce = DEBOUNCE, cache = {} } = options;
  const fetchPage: SuggestionSource<T> = ({ query, cursor, signal }) => {
    const skip = cursor ? Number(cursor) : 0;
    return then(from.find(options.with(query, { skip, limit: pageSize }), signal), (rows) => ({
      items: rows.map(map),
      nextCursor: rows.length < pageSize ? null : String(skip + pageSize),
    }));
  };
  const paced = debouncedSource(fetchPage, debounce);
  return cache === false ? paced : cachedSource(paced, cache);
}

export interface ListSourceOptions<TFilter, TRow, T extends SuggestionItem> {
  /** What loads the list. */
  from: SuggestionFrom<TFilter, TRow>;
  /** The filter of the one load: which rows make the list — a group's
      fields, the templates in use. It takes no query; the menu's search
      matches the list. Left out, `from` is asked with `undefined`. */
  with?: () => TFilter;
  /** A row as a suggestion. Its `id` is the row's own key. */
  map: (row: TRow) => T;
  /** The list, loaded once and shared by every session while it is fresh.
      `false` loads it afresh for each session of the menu, and searches that
      load while the session lasts. @default { ttl: 60_000 } */
  cache?: Pick<SourceCacheOptions, 'ttl'> | false;
}

/**
 * A {@link SuggestionSource} over a list loaded in one request and searched
 * the way the menu searches its own items ({@link matchSuggestions}): every
 * word of the query, in a title or a keyword, best match first. For a
 * catalogue small enough to fetch whole — a field group's fields — where a
 * backend that searches would be a request per keystroke for nothing:
 *
 *     children: listSource({
 *       from: customFields,
 *       with: () => ({ where: { groupId: group.id } }),
 *       map: (field) => ({ id: field.key, title: field.label, command: insertMergeTag(field.key) }),
 *     })
 *
 * The list is never waited for: once loaded, every keystroke answers at
 * once.
 */
export function listSource<TFilter, TRow, T extends SuggestionItem>(
  options: ListSourceOptions<TFilter, TRow, T>,
): SuggestionSource<T> {
  const { from, map, cache = {} } = options;
  const load: SuggestionSource<T> = ({ signal }) =>
    then(from.find(options.with?.() as TFilter, signal), (rows) => rows.map(map));
  const shared = cache === false ? null : cachedSource(load, { ttl: cache.ttl, max: 1 });
  const sessions = new WeakMap<object, SuggestionSource<T>>();
  const loader = (session: object): SuggestionSource<T> => {
    if (shared) return shared;
    let own = sessions.get(session);
    if (!own) sessions.set(session, (own = cachedSource(load, { ttl: Infinity, max: 1 })));
    return own;
  };
  return (request) =>
    then(loader(request.session)({ ...request, query: '', cursor: null }), (answer) =>
      matchSuggestions(pageOf(answer).items, request.query),
    );
}

/**
 * A source that waits for the typing to settle: a query asked within `wait`
 * of the one before is held for `wait`, and dropped — never asked — when a
 * newer query aborts it first. The first query after a pause is asked at
 * once (the menu opening, a group entered), and so is every further page.
 * What {@link pagedSource} does by itself; for a source written by hand.
 */
export function debouncedSource<T extends SuggestionItem>(
  source: SuggestionSource<T>,
  wait = DEBOUNCE,
): SuggestionSource<T> {
  if (wait <= 0) return source;
  let last = -Infinity;
  return (request) => {
    if (request.cursor !== null) return source(request);
    const now = Date.now();
    const rested = now - last >= wait;
    last = now;
    if (rested) return source(request);
    const { signal } = request;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const cancel = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        try {
          resolve(source(request));
        } catch (reason) {
          reject(reason);
        }
      }, wait);
      signal.addEventListener('abort', cancel, { once: true });
    });
  };
}

/**
 * A source that remembers its answers by query and cursor: a fresh one is
 * answered at once — synchronously, so the menu shows it with the keystroke,
 * no loading — and the source is not asked. Only answers are remembered,
 * never a failure; one request per query and cursor is out at a time, and
 * a second ask for it shares the first; a request every asker gave up on is
 * aborted and leaves nothing behind. The cache lives as long as the wrapper:
 * where it is created decides whom it serves. What {@link pagedSource} does
 * by itself; for a source written by hand.
 */
export function cachedSource<T extends SuggestionItem>(
  source: SuggestionSource<T>,
  options: SourceCacheOptions = {},
): SuggestionSource<T> {
  const { ttl = 60_000, max = 50 } = options;
  const kept = new Map<string, { page: SuggestionPage<T>; at: number }>();
  const flights = new Map<string, Flight<T>>();

  const keep = (key: string, page: SuggestionPage<T>) => {
    kept.delete(key);
    kept.set(key, { page, at: Date.now() });
    while (kept.size > max) kept.delete(kept.keys().next().value!);
  };

  return (request) => {
    const key = JSON.stringify([request.query, request.cursor]);
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.page;
    kept.delete(key);

    let flight = flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      const answer = source({ ...request, signal: controller.signal });
      if (!isThenable(answer)) {
        const page = pageOf(answer);
        keep(key, page);
        return page;
      }
      const started: Flight<T> = {
        controller,
        waiting: 0,
        page: Promise.resolve(answer).then(pageOf),
      };
      const land = () => {
        if (flights.get(key) === started) flights.delete(key);
      };
      started.page.then((page) => {
        land();
        if (!controller.signal.aborted) keep(key, page);
      }, land);
      flights.set(key, (flight = started));
    }
    const joined = flight;
    return join(joined, request.signal, () => {
      if (flights.get(key) === joined) flights.delete(key);
    });
  };
}

/** A request out for one key, and how many askers still wait on it. */
interface Flight<T extends SuggestionItem> {
  controller: AbortController;
  waiting: number;
  page: Promise<SuggestionPage<T>>;
}

/** Waits on a shared request for one asker. An asker who gives up leaves
    at once; the last to leave aborts the request. */
function join<T extends SuggestionItem>(
  flight: Flight<T>,
  signal: AbortSignal,
  abandon: () => void,
): Promise<SuggestionPage<T>> {
  flight.waiting++;
  return new Promise((resolve, reject) => {
    let waiting = true;
    const stop = () => {
      waiting = false;
      signal.removeEventListener('abort', leave);
      flight.waiting--;
    };
    const leave = () => {
      if (!waiting) return;
      stop();
      if (flight.waiting === 0) {
        flight.controller.abort(signal.reason);
        abandon();
      }
      reject(signal.reason);
    };
    if (signal.aborted) return leave();
    signal.addEventListener('abort', leave, { once: true });
    flight.page.then(
      (page) => {
        if (waiting) (stop(), resolve(page));
      },
      (reason) => {
        if (waiting) (stop(), reject(reason));
      },
    );
  });
}
