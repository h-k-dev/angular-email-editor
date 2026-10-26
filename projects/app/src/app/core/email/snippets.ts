import { Service, inject } from '@angular/core';

import { ExampleAssets } from './examples';
import { Filter, applyFilter, respond } from './loopback-filter';

/**
 * A stored snippet, as the backend's `Snippet` model returns it: a piece of
 * text kept to drop into any message at the caret — words and their
 * formatting, lists and merge tags, never a heading, a table or a block a
 * message is laid out with (the editor's `snippetExtensions`).
 */
export interface Snippet {
  id: string;
  name: string;
  /** The text, as canonical email HTML with the tokens verbatim. */
  html: string;
}

/** A snippet as written, before the store has given it an id. */
export type SnippetDraft = Omit<Snippet, 'id'>;

/** The snippet catalogue, as `examples/snippets/index.json` holds it. */
interface SnippetCatalogue {
  snippets: { name: string; file: string }[];
}

/** A catalogue file's id: its name, without the folder and extension —
    `snippets/sign-off.html` is `sign-off`, one route segment. */
const snippetId = (file: string): string => file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');

/**
 * The snippet store. Stands in for `/api/snippets` on a LoopBack 3 backend,
 * as {@link Templates} does for its own: `find(filter)` answered by the
 * shared filter mock, `findById`, `create`, `save` and `remove` — each
 * after the same small latency, and cancelled by an `AbortSignal`. A real
 * host swaps the bodies for
 *
 *     firstValueFrom(this.#http.get<Snippet[]>('/api/snippets', {
 *       params: { filter: JSON.stringify(filter) },
 *     }))
 *     firstValueFrom(this.#http.get<Snippet>(`/api/snippets/${id}`))
 *     firstValueFrom(this.#http.post<Snippet>('/api/snippets', draft))
 *     firstValueFrom(this.#http.patch<Snippet>(`/api/snippets/${id}`, snippet))
 *     firstValueFrom(this.#http.delete<void>(`/api/snippets/${id}`))
 *
 * Demo data: the example catalogue's snippets (`examples/snippets`),
 * loaded on the first call; what is written lives until a reload.
 */
@Service()
export class Snippets {
  readonly #assets = inject(ExampleAssets);

  #rows: Promise<Snippet[]> | null = null;

  /** New ids: a counter — they live as long as the page does. */
  #next = 1;

  async find(filter: Filter<Snippet> = {}, signal?: AbortSignal): Promise<Snippet[]> {
    return respond(applyFilter(await this.#all(), filter), signal).then((rows) =>
      rows.map((row) => structuredClone(row)),
    );
  }

  /** The snippet with this id, or null where there is none (a 404). */
  async findById(id: string, signal?: AbortSignal): Promise<Snippet | null> {
    const [row] = await this.find({ where: { id }, limit: 1 }, signal);
    return row ?? null;
  }

  /** Stores a new snippet and answers it with its id. */
  async create(draft: SnippetDraft, signal?: AbortSignal): Promise<Snippet> {
    const rows = await this.#all();
    let id: string;
    do id = `snippet-${this.#next++}`;
    while (rows.some((row) => row.id === id));
    const [stored] = await respond([{ ...structuredClone(draft), id }], signal);
    rows.push(structuredClone(stored));
    return stored;
  }

  /** Stores `snippet` over the one with its id and answers it as stored. */
  async save(snippet: Snippet, signal?: AbortSignal): Promise<Snippet> {
    const rows = await this.#all();
    const at = rows.findIndex((row) => row.id === snippet.id);
    if (at < 0) throw new Error(`No snippet ${snippet.id}`);
    const [stored] = await respond([structuredClone(snippet)], signal);
    rows[at] = structuredClone(stored);
    return stored;
  }

  /** Deletes the snippet with this id; one already gone is no error. */
  async remove(id: string, signal?: AbortSignal): Promise<void> {
    const rows = await this.#all();
    await respond([], signal);
    const at = rows.findIndex((row) => row.id === id);
    if (at >= 0) rows.splice(at, 1);
  }

  #all(): Promise<Snippet[]> {
    return (this.#rows ??= this.#load());
  }

  async #load(): Promise<Snippet[]> {
    const catalogue = JSON.parse(
      await this.#assets.file('snippets/index.json'),
    ) as SnippetCatalogue;
    return Promise.all(
      catalogue.snippets.map(async ({ name, file }) => ({
        id: snippetId(file),
        name,
        html: (await this.#assets.file(file)).trim(),
      })),
    );
  }
}
