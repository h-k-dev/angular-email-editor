import { Component, computed, input } from '@angular/core';

import { prose } from './doc';

/**
 * A reference page's prose, its `backticked` words set as code:
 *
 *     <p [docProse]="entry.summary"></p>
 *
 * The page's data stays plain strings; the parts are worked out once per
 * string.
 */
@Component({
  selector: '[docProse]',
  template: `@for (part of parts(); track $index) {
    @if (part.code) {
      <code>{{ part.text }}</code>
    } @else {
      <ng-container>{{ part.text }}</ng-container>
    }
  }`,
})
export class DocProse {
  readonly docProse = input.required<string>();

  protected readonly parts = computed(() => prose(this.docProse()));
}
