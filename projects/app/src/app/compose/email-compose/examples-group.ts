// Library
import {
  SuggestionCommandItem,
  SuggestionGroup,
  replaceHTML,
  withQuotedHistory,
} from 'angular-email-editor';

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
          const { html, quoted } = doc;
          if (dispatch) examples.loaded.set(quoted ? withQuotedHistory(html, quoted) : html);
          // Parsed as the editor parses (`email`): an example — a compiled
          // MJML template included — comes in exactly as written.
          const load = replaceHTML(html, { mode: 'email' });
          // A document example replaces the body and leaves any quoted
          // history as it is. A reply example is a new conversation: its
          // history comes with it, in the same step (`replyQuote` is
          // canonical already).
          if (!quoted || !dispatch) return load(state, dispatch, view);
          return load(state, (tr) => dispatch(tr.setDocAttribute('quoted', quoted)), view);
        },
      }));
    },
  };
}
