// Library
import { SuggestionCommandItem, SuggestionGroup, replaceHTML } from 'angular-email-editor';

import { Examples } from '../../../services/examples';

/** The word a name becomes in an id: lowercased, spaces as hyphens. */
const slug = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, '-');

/**
 * The `/` menu's Examples group: every example document the app ships
 * (`Examples`, the assets under `public/examples`), a row each, in the
 * set's words for the eye (its detail) and for the search (its keywords).
 * A plain local list — the menu filters and ranks it like its own rows, no
 * source, no loading — read afresh whenever the menu opens, so it is full
 * once the assets have come. Picking one puts the example in the whole
 * message's place, as one change.
 */
export function examplesGroup(examples: Examples): SuggestionGroup {
  return {
    id: 'examples',
    title: 'Examples',
    placeholder: 'Search examples…',
    keywords: ['example', 'sample', 'demo', 'seed'],
    icon: 'auto_stories',
    section: 'examples',
    get children(): SuggestionCommandItem[] {
      return examples.documents().map((doc) => ({
        id: `${doc.set.key}-${slug(doc.entry.name)}`,
        title: doc.entry.name,
        keywords: [doc.set.short, doc.set.key, ...(doc.set.dialect ? [doc.set.dialect] : [])],
        detail: doc.set.short,
        icon: 'article',
        // The file's HTML is the message's original from here on.
        command: (state, dispatch, view) => {
          if (dispatch) examples.loaded.set(doc.html);
          return replaceHTML(doc.html)(state, dispatch, view);
        },
      }));
    },
  };
}
