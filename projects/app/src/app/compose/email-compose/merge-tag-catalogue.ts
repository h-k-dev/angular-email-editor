// Library
import { MergeTagItem, MergeTagPage, MergeTagRequest } from 'angular-email-editor';

/**
 * Stands in for the variable-catalogue backend of the `{{` autocomplete: a
 * labelled core plus enough generated custom fields to need paging, filtered
 * server-side (the source owns matching) and answered a page at a time after
 * a small latency. A real host swaps this for an HTTP call with the same
 * shape — demo data, kept out of the composer for that reason.
 */
const catalogue: MergeTagItem[] = [
  { path: 'firstName', label: 'First name' },
  { path: 'lastName', label: 'Last name' },
  { path: 'email', label: 'Email address' },
  { path: 'company.name', label: 'Company' },
  { path: 'unsubscribeUrl', label: 'Unsubscribe URL' },
  ...Array.from({ length: 80 }, (_, i) => ({
    path: `custom.field${i + 1}`,
    label: `Custom field ${i + 1}`,
  })),
];

export function fetchMergeTags({ query, cursor }: MergeTagRequest): Promise<MergeTagPage> {
  return new Promise((resolve) =>
    setTimeout(() => {
      const q = query.toLowerCase();
      const matches = catalogue.filter(
        (tag) => tag.path.toLowerCase().includes(q) || tag.label?.toLowerCase().includes(q),
      );
      const start = cursor ? Number(cursor) : 0;
      const items = matches.slice(start, start + 20);
      const end = start + items.length;
      resolve({ items, nextCursor: end < matches.length ? String(end) : null });
    }, 150),
  );
}
