import { Service } from '@angular/core';

import { evaluateExpression } from './expression-evaluator';
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
    // The custom fields the AngularJS example's trade-mark table reads
    // (examples/angularjs/platzhalter-im-ueberblick.html): its mark and
    // infringement are choices,
    // stored as the keys its ternaries test.
    ['custom.field1', 'swoosh'],
    ['custom.field2', 'UK00000123456'],
    ['custom.field3', 'marktplatz'],
    ['custom.field4', '20.10.2026'],
    ['custom.field5', '12'],
    ['custom.field6', 'https://example.com/listing/4711'],
    ['custom.field7', 'BP-2026-0042'],
  ]);

  /**
   * Values for placeholder expressions, in order. Stands in for
   * `POST /api/TextParser/parseStrings` — iusta's evaluator, which compiles
   * each `{{…}}` as an AngularJS expression against the case. This one
   * evaluates them too ({@link evaluateExpression}) against one sample
   * contact: a field it has no value for, a helper call or a filter comes
   * back empty, the way a real evaluator answers a field without a value.
   */
  resolve(expressions: readonly string[], signal?: AbortSignal): Promise<string[]> {
    return respond(
      expressions.map((expression) =>
        evaluateExpression(expression, (path) => this.#sample.get(path)),
      ),
      signal,
    );
  }
}
