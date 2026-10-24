import { InjectionToken, inject } from '@angular/core';

// Library
import {
  SuggestionCommandItem,
  SuggestionGroup,
  SuggestionSource,
  insertHTML,
  pagedSource,
} from '@h-k-dev/angular-email-editor';

import { Filter, escapeLike } from '../../../../../core/email/loopback-filter';
import { EmailTemplate, Templates } from '../../../../../core/email/templates';

/** Rows a page asks for — a little more than the menu shows at once, so
    the list scrolls before the next page is fetched. */
export const TEMPLATE_PAGE_SIZE = 12;

/** The Templates group's rows, by DI: the template store unless a surface
    provides another under this token. Tree-shakable, like {@link MERGE_TAG_SOURCE}. */
export const TEMPLATE_SOURCE = new InjectionToken<SuggestionSource<SuggestionCommandItem>>(
  'TEMPLATE_SOURCE',
  { providedIn: 'root', factory: () => createTemplateSource(inject(Templates)) },
);

/**
 * The template store as rows: each search string becomes a LoopBack filter
 * (`ilike` on the name, sorted by name), each page a `skip`. A row is the
 * template's id — the store's key — and picking it inserts the template. A
 * superseded search cancels its request.
 */
export function createTemplateSource(templates: Templates): SuggestionSource<SuggestionCommandItem> {
  return pagedSource({
    from: templates,
    with: (query, { skip, limit }): Filter<EmailTemplate> => {
      const search = query.trim();
      return {
        where: search ? { name: { ilike: `%${escapeLike(search)}%` } } : undefined,
        order: 'name ASC',
        skip,
        limit,
      };
    },
    map: (row) => ({
      id: row.id,
      title: row.name,
      keywords: [row.dialect],
      icon: 'article',
      command: insertHTML(row.html, { mode: 'email' }),
    }),
    pageSize: TEMPLATE_PAGE_SIZE,
  });
}

/** The `/` menu's Templates group: level 2 is the template source's rows. */
export function templateGroup(source: SuggestionSource<SuggestionCommandItem>): SuggestionGroup {
  return {
    id: 'templates',
    title: 'Templates',
    placeholder: 'Search templates…',
    keywords: ['template', 'snippet'],
    icon: 'library_books',
    section: 'templates',
    children: source,
  };
}
