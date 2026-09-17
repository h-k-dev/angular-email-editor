/**
 * The LoopBack 3 query filter the demo's mock services answer — the subset
 * they need, applied the way a SQL connector would. One engine, so every
 * mock `find` behaves like the same backend.
 */

/** A LoopBack 3 `where` operator on one property. */
export type WhereCondition<V> =
  V | { like: string } | { nlike: string } | { ilike: string } | { inq: V[] };

/** A LoopBack 3 `where` clause: property conditions, joined by `and`/`or`. */
export type Where<T> = { [K in keyof T]?: WhereCondition<T[K]> } & {
  and?: Where<T>[];
  or?: Where<T>[];
};

/** The filter a `find` takes: `?filter={"where":…,"order":…,"skip":…,"limit":…}`. */
export interface Filter<T> {
  where?: Where<T>;
  /** `'name ASC'`, or several, first wins. */
  order?: string | string[];
  limit?: number;
  skip?: number;
}

/** What a request may carry besides its filter. */
export interface FindOptions {
  /** Cancels the request: the promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Milliseconds a mock find takes — enough to see "Searching…" and
    "Loading more…". */
export const LATENCY = 350;

/** `%` and `_` typed by a user are literal characters, not wildcards. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The rows a server would answer for `filter`, in order, as copies. */
export function applyFilter<T>(rows: readonly T[], filter: Filter<T> = {}): T[] {
  const { where, order, skip = 0, limit } = filter;
  const matches = rows.filter((row) => !where || matchesWhere(row, where));
  const sorted = order ? [...matches].sort(compareBy(order)) : matches;
  return structuredClone(sorted.slice(skip, limit === undefined ? undefined : skip + limit));
}

/** Answers `rows` after the latency, like a request would — or rejects with
    an `AbortError` the moment `signal` aborts, the timer cleared. */
export function respond<T>(rows: T[], { signal }: FindOptions = {}): Promise<T[]> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve(rows);
    }, LATENCY);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** SQL LIKE as the connectors read it: `%` any run, `_` one character, and
    a backslash making the next character literal (PostgreSQL's default). */
function likePattern(pattern: string, flags: string): RegExp {
  const literal = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\' && i + 1 < pattern.length) source += literal(pattern[++i]);
    else if (char === '%') source += '.*';
    else if (char === '_') source += '.';
    else source += literal(char);
  }
  return new RegExp(`^${source}$`, flags);
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object') return value === condition;
  const text = String(value ?? '');
  if ('like' in condition) return likePattern(String(condition.like), 's').test(text);
  if ('nlike' in condition) return !likePattern(String(condition.nlike), 's').test(text);
  if ('ilike' in condition) return likePattern(String(condition.ilike), 'is').test(text);
  if ('inq' in condition && Array.isArray(condition.inq)) return condition.inq.includes(value);
  return false;
}

function matchesWhere<T>(row: T, where: Where<T>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === 'and') return (condition as Where<T>[]).every((w) => matchesWhere(row, w));
    if (key === 'or') return (condition as Where<T>[]).some((w) => matchesWhere(row, w));
    return matchesCondition(row[key as keyof T], condition);
  });
}

/** German collation, numbers by value — "Field 2" before "Field 10", as a
    database with a natural-sort collation answers. */
function compareBy<T>(order: string | string[]) {
  const keys = (Array.isArray(order) ? order : [order]).map((entry) => {
    const [property, direction = 'ASC'] = entry.trim().split(/\s+/);
    return { property: property as keyof T, sign: direction.toUpperCase() === 'DESC' ? -1 : 1 };
  });
  return (a: T, b: T): number => {
    for (const { property, sign } of keys) {
      const result = String(a[property]).localeCompare(String(b[property]), 'de', {
        sensitivity: 'base',
        numeric: true,
      });
      if (result) return result * sign;
    }
    return 0;
  };
}
