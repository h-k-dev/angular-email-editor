import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { richTextExtensions } from '@h-k-dev/angular-email-editor';
import { EmailEditor } from '@h-k-dev/angular-email-editor/editor';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

const CONTENT =
  '<p>Press “a value from outside in 3 s”, then come back and keep typing here:</p>' +
  '<p>it waits until you leave the text, the way a draft saved in another tab would.</p>';

/** What “another tab” writes. */
const OUTSIDE = '<p>Written from <strong>outside</strong> — taken in as the text was left.</p>';

/**
 * The editor directive as a host uses it: `[emailEditor]` on the stage's
 * own element, its value two-way. The value panel is the value beside the
 * baseline, and whether they differ — what a Save button would read. A
 * value from outside waits while the text is typed in; Revert is
 * `replace(baseline)`, an undo step.
 */
@Component({
  selector: 'editor-playground',
  imports: [EmailEditor, PlaygroundFrame, PlaygroundSubject],
  templateUrl: './editor-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class EditorPlayground {
  protected readonly playground = inject(Playground);

  readonly disabled = signal(false);
  readonly readonly = signal(false);
  readonly paused = signal(false);

  protected readonly kit = richTextExtensions;
  protected readonly value = signal(CONTENT);

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly stage = viewChild(EmailEditor);

  protected readonly state = computed(() => {
    const baseline = this.stage()?.baseline() ?? null;
    return {
      value: this.value(),
      baseline,
      unsaved: baseline !== null && this.value() !== baseline,
    };
  });

  protected readonly knobs = [
    knob.boolean('disabled', this.disabled),
    knob.boolean('readonly', this.readonly),
    knob.boolean('emailEditorPaused', this.paused),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    {
      // Later, so the caret can be back in the text when it lands: the
      // button itself takes focus from the text.
      name: 'a value from outside in 3 s',
      run: () =>
        setTimeout(() => {
          this.value.set(OUTSIDE);
          this.playground.log('value.set', 'from outside');
        }, 3000),
    },
    {
      name: 'replace(baseline())',
      run: () => {
        const baseline = this.stage()?.baseline();
        if (baseline != null) this.stage()?.replace(baseline);
      },
    },
    { name: 'focus()', run: () => this.stage()?.focus() },
  ];
}
