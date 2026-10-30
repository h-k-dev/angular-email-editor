import { CdkMonitorFocus } from '@angular/cdk/a11y';
import { Directive } from '@angular/core';

/**
 * A text field that reads as text until it is touched — Notion's: no
 * border, no fill at rest; a faint wash under the pointer; a ring (and the
 * wash) only when focus came by keyboard, never on a click or a focus by
 * code. Its corner is the theme's medium one; an `aria-invalid` field
 * keeps its error ring whatever the focus.
 *
 *     <input quietField [formField]="form.location" placeholder="Add location" />
 *     <textarea quietField rows="2" [formField]="form.note"></textarea>
 *     <button quietField type="button">Fri, Oct 30</button>   (a picker's trigger)
 *
 * Behaviour only: it wears the class the look is drawn by
 * (styles/_quiet-field.scss, global — any field anywhere may be one), and
 * the CDK's focus monitor, which marks how focus arrived
 * (`cdk-keyboard-focused`). A host sizes it (a title's large type, a
 * note's lines) with a class of its own.
 */
@Directive({
  selector: 'input[quietField], textarea[quietField], button[quietField]',
  hostDirectives: [CdkMonitorFocus],
  host: { class: 'quiet-field' },
})
export class QuietField {}
