import { Component, ViewEncapsulation, input } from '@angular/core';

import { DocProse } from '../doc-page/doc-prose';

/**
 * A walk-through, hairline's: numbered steps, each a bold lead and a line
 * of prose, then what it shows — usually a `doc-code`.
 *
 *     <ol docSteps>
 *       <li docStep id="mount" lead="createEditor" [code]="true" text="Mounts the view.">
 *         <doc-code [code]="example" />
 *       </li>
 *     </ol>
 *
 * The numbers are the list's own (a CSS counter): a step moved is a step
 * renumbered.
 */
@Component({
  selector: 'ol[docSteps]',
  template: '<ng-content />',
  styleUrl: './doc-steps.scss',
  // The steps are the page's elements, projected: the rules reach them by
  // class, scoped to `.doc-steps`.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'doc-steps' },
})
export class DocSteps {}

/** One step of `docSteps`: its lead (in code type when it names an export),
    one line of prose — both with `backticks` for code — and what it shows. */
@Component({
  selector: 'li[docStep]',
  imports: [DocProse],
  template: `<p class="doc-step__line">
      @if (code()) {
        <code class="doc-step__lead">{{ lead() }}</code>
      } @else {
        <b class="doc-step__lead"><span [docProse]="lead()"></span>.</b>
      }
      @if (text()) {
        <span [docProse]="text()"></span>
      }
    </p>
    <ng-content />`,
  host: { class: 'doc-step' },
})
export class DocStep {
  readonly lead = input.required<string>();
  readonly text = input('');
  /** The lead names an export: set in code type, no full stop. */
  readonly code = input(false);
}
