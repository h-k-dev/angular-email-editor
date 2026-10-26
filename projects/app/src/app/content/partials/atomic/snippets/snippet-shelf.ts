import { Service, computed, debounced, inject, linkedSignal, resource, signal } from '@angular/core';

// Library
import { emailPlainText } from '@h-k-dev/angular-email-editor';

import { Filter, escapeLike } from '../../../../core/email/loopback-filter';
import { Snippet, SnippetDraft, Snippets } from '../../../../core/email/snippets';

/** One row of the list: the snippet, and its words on a line. */
export interface SnippetRow {
  readonly snippet: Snippet;
  /** What it says, as plain text on one line — tokens as written. */
  readonly preview: string;
}

/** How long the search waits for the typing to stop, ms. */
const SEARCH_REST = 200;

/** The store's filter for a search: names and words alike, by name. */
function searchFilter(query: string): Filter<Snippet> {
  const search = query.trim();
  const like = { ilike: `%${escapeLike(search)}%` };
  return {
    where: search ? { or: [{ name: like }, { html: like }] } : undefined,
    order: 'name ASC',
  };
}

/**
 * The snippets page's list — the page's own state, shared with the snippet
 * open beside it: the page (`SnippetsPage`) provides it and lists it, the
 * routed editor (`SnippetEditor`, through the outlet's injector) tells it
 * what it saved, made or deleted, so the row follows at once. A routed
 * child has no template to bind an output to — `InboxPaper`'s way.
 *
 * The list is the store's answer to the search (`query`, at rest): names
 * and words, sorted by name. Each search is a request; a newer one cancels
 * it, and the rows shown stay until its answer comes.
 */
@Service({ autoProvided: false })
export class SnippetShelf {
  readonly #store = inject(Snippets);

  /** The search, as typed. */
  readonly query = signal('');

  /** The search, settled: a clear passes at once. */
  readonly #search = debounced(this.query, (query) =>
    query.trim() ? new Promise<void>((resolve) => setTimeout(resolve, SEARCH_REST)) : undefined,
  );

  readonly #found = resource({
    params: () => searchFilter(this.#search.value()),
    loader: ({ params, abortSignal }) => this.#store.find(params, abortSignal),
  });

  /** The snippets found — the last answer while the next is on its way;
      changed in place by what the editor tells. */
  readonly #rows = linkedSignal<Snippet[] | undefined, Snippet[]>({
    source: () => (this.#found.hasValue() ? this.#found.value() : undefined),
    computation: (found, previous) => found ?? previous?.value ?? [],
  });

  /** Each snippet's words, read once per text. */
  readonly #previews = new Map<string, string>();

  readonly rows = computed<readonly SnippetRow[]>(() =>
    this.#rows().map((snippet) => ({ snippet, preview: this.#preview(snippet.html) })),
  );

  /** Whether the first answer has come — until then the list is empty for
      want of an answer, not of snippets. */
  readonly settled = computed(() => this.#found.hasValue() || this.#found.status() === 'error');

  /** A new snippet, stored, and on top of the list. */
  async create(draft: SnippetDraft): Promise<Snippet> {
    const made = await this.#store.create(draft);
    this.#rows.update((rows) => [made, ...rows]);
    return made;
  }

  /** The editor saved `snippet`: its row shows it as stored. */
  saved(snippet: Snippet): void {
    this.#rows.update((rows) => rows.map((row) => (row.id === snippet.id ? snippet : row)));
  }

  /** The snippet with this id was deleted: its row goes. */
  removed(id: string): void {
    this.#rows.update((rows) => rows.filter((row) => row.id !== id));
  }

  #preview(html: string): string {
    let preview = this.#previews.get(html);
    if (preview === undefined) {
      preview = emailPlainText(html).replace(/\s+/g, ' ').trim();
      this.#previews.set(html, preview);
    }
    return preview;
  }
}
