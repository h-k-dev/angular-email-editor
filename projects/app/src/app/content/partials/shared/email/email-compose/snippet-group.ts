import { InjectionToken, inject } from '@angular/core';

// Library
import {
  SuggestionCommandItem,
  SuggestionGroup,
  SuggestionSource,
  emailPlainText,
  insertSnippet,
  pagedSource,
} from '@h-k-dev/angular-email-editor';

import { Filter, escapeLike } from '../../../../../core/email/loopback-filter';
import { Snippet, Snippets } from '../../../../../core/email/snippets';
import { TEMPLATE_PAGE_SIZE } from './template-group';

/** The Snippets group's rows, by DI: the snippet store unless a surface
    provides another under this token. Tree-shakable, like {@link TEMPLATE_SOURCE}. */
export const SNIPPET_SOURCE = new InjectionToken<SuggestionSource<SuggestionCommandItem>>(
  'SNIPPET_SOURCE',
  { providedIn: 'root', factory: () => createSnippetSource(inject(Snippets)) },
);

/** A snippet's words on one line, for its row's detail: what it says, not
    its name again. */
const preview = (html: string): string => emailPlainText(html).replace(/\s+/g, ' ').trim();

/**
 * The snippet store as rows: each search string becomes a LoopBack filter
 * (`ilike` on the name, sorted by name), each page a `skip`. A row is the
 * snippet's id — the store's key — and picking it drops the snippet in at
 * the caret, into the line being written (`insertSnippet`) — where a
 * template takes the body's place.
 */
export function createSnippetSource(snippets: Snippets): SuggestionSource<SuggestionCommandItem> {
  return pagedSource({
    from: snippets,
    with: (query, { skip, limit }): Filter<Snippet> => {
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
      detail: preview(row.html),
      icon: 'short_text',
      command: insertSnippet(row.html, { mode: 'email' }),
    }),
    pageSize: TEMPLATE_PAGE_SIZE,
  });
}

/** The `/` menu's Snippets group: level 2 is the snippet source's rows. */
export function snippetGroup(source: SuggestionSource<SuggestionCommandItem>): SuggestionGroup {
  return {
    id: 'snippets',
    title: 'Snippets',
    placeholder: 'Search snippets…',
    keywords: ['snippet', 'text', 'phrase', 'signature'],
    icon: 'short_text',
    section: 'templates',
    children: source,
  };
}
