// Library
import { SuggestionSource, insertMergeTag } from 'angular-email-editor';

import { escapeLike } from '../../../services/loopback-filter';
import { MergeTags } from '../../../services/merge-tags';

/** Rows a page asks for. */
export const MERGE_TAG_PAGE_SIZE = 20;

/**
 * The `{{` menu's source, backed by the variable catalogue: the path typed
 * after the braces searches label and path alike (`ilike`, either one),
 * sorted by label; each page a `skip`. Picking a row inserts its token. A
 * superseded search cancels its request.
 */
export function mergeTagSource(mergeTags: MergeTags): SuggestionSource {
  return async ({ query, cursor, signal }) => {
    const skip = cursor ? Number(cursor) : 0;
    const like = `%${escapeLike(query.trim())}%`;
    const rows = await mergeTags.find(
      {
        where: query.trim()
          ? { or: [{ path: { ilike: like } }, { label: { ilike: like } }] }
          : undefined,
        order: 'label ASC',
        skip,
        limit: MERGE_TAG_PAGE_SIZE,
      },
      { signal },
    );
    return {
      items: rows.map((row) => ({
        id: row.path,
        title: row.label,
        detail: `{{ ${row.path} }}`,
        command: insertMergeTag(row.path),
      })),
      nextCursor: rows.length === MERGE_TAG_PAGE_SIZE ? String(skip + MERGE_TAG_PAGE_SIZE) : null,
    };
  };
}
