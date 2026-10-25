import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { richTextExtensions } from '@h-k-dev/angular-email-editor';
import { ActionTrigger, injectActions } from '@h-k-dev/angular-email-editor/actions';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';

import {
  Playground,
  PlaygroundAction,
  PlaygroundSubject,
  knob,
  playgroundEditor,
} from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** The kit's marks and blocks, a line of each. */
const CONTENT =
  '<p>Select some of this text, then press a button: <strong>bold</strong>, <em>italic</em> and <u>underline</u> light up where the caret stands.</p>' +
  '<ul><li><p>A list item</p></li></ul><p>A second paragraph.</p>';

/**
 * A toolbar made of nothing but `[emailAction]` triggers over every action
 * the kit declares (`injectActions(...).all()`), in kit order — each lit
 * while its mark is on at the selection, disabled where it cannot run. A
 * host action stands at the end ("Link", which opens the host's own UI);
 * an override replaces the kit's table insert. The value panel lists what
 * is on and what is off, live.
 */
@Component({
  selector: 'actions-playground',
  imports: [PlaygroundFrame, PlaygroundSubject, ActionTrigger, KeepFocus, MatIcon],
  templateUrl: './actions-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './actions-playground.scss'],
  providers: [Playground],
})
export class ActionsPlayground {
  protected readonly playground = inject(Playground);

  readonly returnFocus = signal(true);
  readonly aria = signal(true);
  readonly keepFocus = signal(true);

  protected readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  protected readonly editor = playgroundEditor(this.host, {
    extensions: richTextExtensions,
    content: CONTENT,
  });

  protected readonly actions = injectActions(() => this.editor(), {
    host: [
      {
        id: 'link',
        run: () => this.playground.log('host action', 'link — the host opens its dialog'),
      },
    ],
    override: {
      table: { run: () => this.playground.log('override', 'table — the host’s size picker') },
    },
  });

  /** What is on and what cannot run, as the triggers say it. */
  protected readonly state = computed(() => {
    const all = this.actions.all();
    return {
      actions: all.length,
      pressed: all.filter((action) => action.pressed()).map((action) => action.id),
      disabled: all.filter((action) => action.disabled()).map((action) => action.id),
    };
  });

  protected readonly knobs = [
    knob.boolean('emailActionFocus', this.returnFocus),
    knob.boolean('emailActionAria', this.aria),
    knob.boolean('emailKeepFocus (toolbar)', this.keepFocus),
  ];

  protected readonly playgroundActions: readonly PlaygroundAction[] = [
    {
      name: "get('bold').run()",
      run: () => this.playground.log('run', this.actions.get('bold')?.run()),
    },
    { name: 'editor.focus()', run: () => this.editor()?.focus() },
  ];

  protected ran(id: string, trigger: ActionTrigger): void {
    this.playground.log('click', { id, pressed: trigger.pressed(), disabled: trigger.disabled() });
  }
}
