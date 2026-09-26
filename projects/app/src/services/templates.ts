import { Service, inject } from '@angular/core';

import { ExampleSet, Examples } from './examples';
import { Filter, FindOptions, applyFilter, respond } from './loopback-filter';

/** A stored email template, as the backend's `Template` model returns it. */
export interface EmailTemplate {
  id: string;
  name: string;
  /** The templating dialect its tokens are written in. */
  dialect: 'angularjs' | 'handlebars';
  /** The body, as canonical email HTML with the tokens verbatim. */
  html: string;
}

/**
 * The template store. Stands in for `GET /api/templates?filter=…` on a
 * LoopBack 3 backend: `find(filter)` is the one call, answered by the shared
 * filter mock (`where` with `like` / `ilike` / `inq` / `and` / `or`,
 * `order`, `skip`, `limit`) after a small latency, and cancelled by an
 * `AbortSignal`. A real host swaps the body for
 *
 *     firstValueFrom(this.#http.get<EmailTemplate[]>('/api/templates', {
 *       params: { filter: JSON.stringify(filter) },
 *     }))
 *
 * Demo data: every example set written in a dialect (`Examples`), loaded
 * on the first find.
 */
@Service()
export class Templates {
  readonly #examples = inject(Examples);

  #rows: Promise<EmailTemplate[]> | null = null;

  async find(
    filter: Filter<EmailTemplate> = {},
    options: FindOptions = {},
  ): Promise<EmailTemplate[]> {
    return respond(applyFilter(await this.#all(), filter), options);
  }

  #all(): Promise<EmailTemplate[]> {
    return (this.#rows ??= this.#load());
  }

  async #load(): Promise<EmailTemplate[]> {
    const sets = (await this.#examples.sets()).filter((set) => set.dialect);
    const rows = await Promise.all(sets.map((set) => this.#rowsOf(set)));
    return rows.flat();
  }

  async #rowsOf(set: ExampleSet): Promise<EmailTemplate[]> {
    return Promise.all(
      set.examples.map(async (example) => ({
        id: `${set.key}-${example.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-')}`,
        name: example.name,
        dialect: set.dialect!,
        html: await this.#examples.document(set, example),
      })),
    );
  }
}
