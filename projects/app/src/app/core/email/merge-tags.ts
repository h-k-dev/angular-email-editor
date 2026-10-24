import { Service } from '@angular/core';

import { Filter, applyFilter, respond } from './loopback-filter';

/** A personalization variable, as the backend's `MergeTag` model returns it. */
export interface MergeTag {
  /** The dotted path the token serializes as — `firstName`, `company.name`. */
  path: string;
  /** Human name for the menu row. */
  label: string;
}

/**
 * The variable catalogue of the `{{` menu. Stands in for
 * `GET /api/merge-tags?filter=…` on a LoopBack 3 backend, like
 * {@link Templates}: `find(filter)` answered by the shared filter mock after
 * a small latency, cancelled by an `AbortSignal`. A labelled core plus
 * enough custom fields to need paging.
 */
@Service()
export class MergeTags {
  readonly #rows: MergeTag[] = [
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

  find(filter: Filter<MergeTag> = {}, signal?: AbortSignal): Promise<MergeTag[]> {
    return respond(applyFilter(this.#rows, filter), signal);
  }

  /** The one contact the demo fills placeholders in for, by path. A Map,
      not an object: the key is whatever the author typed between the braces,
      and `{{ constructor }}` must find nothing, not what every object
      inherits. */
  readonly #sample: ReadonlyMap<string, string> = new Map([
    ['firstName', 'Ada'],
    ['lastName', 'Lovelace'],
    ['email', 'ada@example.com'],
    ['company.name', 'Analytical Engines Ltd'],
    ['unsubscribeUrl', 'https://example.com/unsubscribe'],
  ]);

  /**
   * Values for placeholder expressions, in order. Stands in for
   * `POST /api/TextParser/parseStrings` — iusta's evaluator, which compiles
   * each `{{…}}` as an AngularJS expression against the case. This one
   * knows the catalogue's paths only, filled from one sample contact; any
   * other expression comes back empty, the way a real evaluator answers a
   * field without a value.
   */
  resolve(expressions: readonly string[], signal?: AbortSignal): Promise<string[]> {
    return respond(
      expressions.map((expression) => this.#sample.get(expression) ?? ''),
      signal,
    );
  }
}
