// Library
import { SuggestionGroup, insertHTML } from 'angular-email-editor';

import { escapeLike } from '../../../services/loopback-filter';
import { Templates } from '../../../services/templates';

/** Rows a page asks for — a little more than the menu shows at once, so
    the list scrolls before the next page is fetched. */
export const TEMPLATE_PAGE_SIZE = 12;

/**
 * The `/` menu's Templates group, backed by the template store: each search
 * string becomes a LoopBack filter (`ilike` on the name, sorted by name),
 * each page a `skip` — the cursor is the offset of the next page. A page
 * shorter than the page size is the last one. A superseded search cancels
 * its request.
 */
export function templateGroup(templates: Templates): SuggestionGroup {
  return {
    id: 'templates',
    title: 'Templates',
    placeholder: 'Search templates…',
    keywords: ['template', 'snippet'],
    icon: 'library_books',
    children: async ({ query, cursor, signal }) => {
      const skip = cursor ? Number(cursor) : 0;
      const search = query.trim();
      const rows = await templates.find(
        {
          where: search ? { name: { ilike: `%${escapeLike(search)}%` } } : undefined,
          order: 'name ASC',
          skip,
          limit: TEMPLATE_PAGE_SIZE,
        },
        { signal },
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          title: row.name,
          keywords: [row.dialect],
          icon: 'article',
          command: insertHTML(row.html),
        })),
        nextCursor: rows.length === TEMPLATE_PAGE_SIZE ? String(skip + TEMPLATE_PAGE_SIZE) : null,
      };
    },
  };
}
