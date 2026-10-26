import { InjectionToken, inject } from '@angular/core';

// Library
import {
  SuggestionCommandItem,
  SuggestionGroup,
  SuggestionPage,
  SuggestionSource,
  pagedSource,
  replaceHTML,
} from '@h-k-dev/angular-email-editor';

import { Filter, escapeLike } from '../../../../../core/email/loopback-filter';
import {
  EmailTemplate,
  TemplateEnvelope,
  Templates,
} from '../../../../../core/email/templates';

/** Rows a page asks for — a little more than the menu shows at once, so
    the list scrolls before the next page is fetched. */
export const TEMPLATE_PAGE_SIZE = 12;

/** A row of the Templates group: the command that puts the template in the
    body's place, and the message round it as the template keeps it — none
    on a template no one has designed. */
export interface TemplateItem extends SuggestionCommandItem {
  envelope?: TemplateEnvelope;
}

/** The Templates group's rows, by DI: the template store unless a surface
    provides another under this token. Tree-shakable, like {@link MERGE_TAG_SOURCE}. */
export const TEMPLATE_SOURCE = new InjectionToken<SuggestionSource<TemplateItem>>(
  'TEMPLATE_SOURCE',
  { providedIn: 'root', factory: () => createTemplateSource(inject(Templates)) },
);

/**
 * The template store as rows: each search string becomes a LoopBack filter
 * (`ilike` on the name, sorted by name), each page a `skip`. A row is the
 * template's id — the store's key — and picking it puts the template in the
 * whole body's place: everything written goes, its page layout with it, as
 * one undoable step (a snippet, by contrast, joins the line at the caret).
 * The quoted history of a reply stays. The row carries the template's
 * envelope, for the composer's host to take its rows from (`templateGroup`).
 * A superseded search cancels its request.
 */
export function createTemplateSource(templates: Templates): SuggestionSource<TemplateItem> {
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
      command: replaceHTML(row.html, { mode: 'email' }),
      envelope: row.envelope,
    }),
    pageSize: TEMPLATE_PAGE_SIZE,
  });
}

/**
 * The `/` menu's Templates group: level 2 is the template source's rows.
 * `picked` hears of each template put in the body — after its command has
 * run, with its row — for what the editor cannot reach: the message round
 * the body (its From, Subject and preview text). The source's answers are
 * passed through as they come, a synchronous one (a cache hit) still
 * synchronous.
 */
export function templateGroup(
  source: SuggestionSource<TemplateItem>,
  picked?: (item: TemplateItem) => void,
): SuggestionGroup {
  return {
    id: 'templates',
    title: 'Templates',
    placeholder: 'Search templates…',
    keywords: ['template'],
    icon: 'library_books',
    section: 'templates',
    children: picked ? telling(source, picked) : source,
  };
}

/** `source`, its rows' commands telling `picked` once they have run. */
function telling(
  source: SuggestionSource<TemplateItem>,
  picked: (item: TemplateItem) => void,
): SuggestionSource<TemplateItem> {
  const wrap = (item: TemplateItem): TemplateItem => ({
    ...item,
    command: (state, dispatch, view) => {
      const ran = item.command(state, dispatch, view);
      if (ran && dispatch) picked(item);
      return ran;
    },
  });
  const answer = (rows: TemplateItem[] | SuggestionPage<TemplateItem>) =>
    Array.isArray(rows) ? rows.map(wrap) : { ...rows, items: rows.items.map(wrap) };
  return (request) => {
    const rows = source(request);
    return rows instanceof Promise ? rows.then(answer) : answer(rows);
  };
}
