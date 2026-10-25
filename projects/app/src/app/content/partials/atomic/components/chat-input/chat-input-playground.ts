import { Component, inject, signal, viewChild } from '@angular/core';
import { ChatInput } from '@h-k-dev/angular-email-editor/chat-input';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/**
 * The chat input alone, two-way bound: type past five lines to see it stop
 * growing and scroll, drag the stage narrower to see it wrap. Enter sends
 * (`sent`), Shift+Enter breaks the line, Escape says so (`escaped`).
 */
@Component({
  selector: 'chat-input-playground',
  imports: [PlaygroundFrame, PlaygroundSubject, ChatInput],
  templateUrl: './chat-input-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class ChatInputPlayground {
  protected readonly playground = inject(Playground);

  readonly value = signal('');
  readonly placeholder = signal('Tell the assistant what to change…');
  readonly label = signal('Message');
  readonly disabled = signal(false);
  readonly readonly = signal(false);

  protected readonly input = viewChild.required(ChatInput);

  protected readonly knobs = [
    knob.text('placeholder', this.placeholder),
    knob.text('label', this.label),
    knob.boolean('disabled', this.disabled),
    knob.boolean('readonly', this.readonly),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'focus()', run: () => this.input().focus() },
    { name: 'clear()', run: () => this.input().clear() },
    {
      name: 'set five lines',
      run: () => this.value.set(['One', 'two', 'three', 'four', 'five', 'six'].join('\n')),
    },
  ];
}
