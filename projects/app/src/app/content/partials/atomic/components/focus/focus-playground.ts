import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { KEEP_FOCUS_EXCEPT, KeepFocus } from '@h-k-dev/angular-email-editor/focus';

import { Playground, PlaygroundAction, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** What the value panel says of the focused element and its selection. */
interface FocusState {
  readonly focused: string;
  readonly selection: string | null;
}

/**
 * A field and two toolbars — one under `emailKeepFocus`, one without. Select
 * words in the field and press a tool in each: under the directive the
 * field keeps its focus and its selection; without it the button takes
 * both. The toolbar's own field is an exception (text entry, by default),
 * so it can still be typed in. The value panel follows focus and the
 * field's selection; the log says every move.
 */
@Component({
  selector: 'focus-playground',
  imports: [PlaygroundFrame, KeepFocus],
  templateUrl: './focus-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './focus-playground.scss'],
  providers: [Playground],
})
export class FocusPlayground {
  protected readonly playground = inject(Playground);

  readonly enabled = signal(true);
  readonly except = signal(KEEP_FOCUS_EXCEPT);

  protected readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');
  protected readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  protected readonly state = signal<FocusState>({ focused: 'nothing', selection: null });

  protected readonly knobs = [
    knob.boolean('emailKeepFocus', this.enabled),
    knob.text('emailKeepFocusExcept', this.except),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    {
      name: 'select a word in the field',
      run: () => {
        const field = this.field().nativeElement;
        field.focus();
        field.setSelectionRange(4, 9);
      },
    },
  ];

  constructor() {
    // Where focus is, and the field's selection — read off the document,
    // since what is under test is that nothing of the stage's moved it.
    const document = inject(DOCUMENT);
    const read = () => {
      const active = document.activeElement as HTMLElement | null;
      const field = this.field().nativeElement;
      this.state.set({
        focused: this.#name(active),
        selection:
          field.selectionStart === field.selectionEnd
            ? null
            : field.value.slice(field.selectionStart, field.selectionEnd),
      });
    };
    const onFocusin = (event: FocusEvent) => {
      read();
      if (this.stage().nativeElement.contains(event.target as Node)) {
        this.playground.log('focus', this.#name(event.target as HTMLElement));
      }
    };
    document.addEventListener('focusin', onFocusin);
    document.addEventListener('selectionchange', read);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('focusin', onFocusin);
      document.removeEventListener('selectionchange', read);
    });
  }

  protected pressed(tool: string): void {
    this.playground.log('click', tool);
  }

  #name(element: HTMLElement | null): string {
    if (!element || element === element.ownerDocument.body) return 'nothing';
    return element.getAttribute('aria-label') ?? element.tagName.toLowerCase();
  }
}
