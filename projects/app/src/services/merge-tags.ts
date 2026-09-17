import { Service } from '@angular/core';

import { Filter, FindOptions, applyFilter, respond } from './loopback-filter';

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

  find(filter: Filter<MergeTag> = {}, options: FindOptions = {}): Promise<MergeTag[]> {
    return respond(applyFilter(this.#rows, filter), options);
  }
}
