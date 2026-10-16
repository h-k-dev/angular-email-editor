import { InjectionToken, inject } from '@angular/core';

// Library
import { SuggestionSource, insertMergeTag, pagedSource } from '@h-k-dev/angular-email-editor';

import { Filter, escapeLike } from '../../../services/loopback-filter';
import { MergeTag, MergeTags } from '../../../services/merge-tags';

/** Rows a page asks for. */
export const MERGE_TAG_PAGE_SIZE = 20;

/** The `{{` menu's source, by DI: the variable catalogue unless a surface
    provides another under this token. Tree-shakable — the default lands in
    the chunk that first injects it, never in the shell's initial one, and
    a compose window (made from the root injector) gets it as a page does. */
export const MERGE_TAG_SOURCE = new InjectionToken<SuggestionSource>('MERGE_TAG_SOURCE', {
  providedIn: 'root',
  factory: () => createMergeTagSource(inject(MergeTags)),
});

/**
 * The `{{` menu's source, backed by the variable catalogue: the path typed
 * after the braces searches label and path alike (`ilike`, either one),
 * sorted by label; each page a `skip`. A row is its path — the catalogue's
 * key — and picking it inserts its token. A superseded search cancels its
 * request.
 */
export function createMergeTagSource(mergeTags: MergeTags): SuggestionSource {
  return pagedSource({
    from: mergeTags,
    with: (query, { skip, limit }): Filter<MergeTag> => {
      const search = query.trim();
      const like = `%${escapeLike(search)}%`;
      return {
        where: search ? { or: [{ path: { ilike: like } }, { label: { ilike: like } }] } : undefined,
        order: 'label ASC',
        skip,
        limit,
      };
    },
    map: (row) => ({
      id: row.path,
      title: row.label,
      detail: `{{ ${row.path} }}`,
      command: insertMergeTag(row.path),
    }),
    pageSize: MERGE_TAG_PAGE_SIZE,
  });
}
