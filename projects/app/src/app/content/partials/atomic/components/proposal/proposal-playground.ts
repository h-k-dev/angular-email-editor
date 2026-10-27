import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  createContentProposal,
  createContentStream,
  richTextExtensions,
} from '@h-k-dev/angular-email-editor';
import { EmailEditor } from '@h-k-dev/angular-email-editor/editor';
import {
  ProposalAccept,
  ProposalDiscard,
  ProposalKeys,
  injectProposal,
} from '@h-k-dev/angular-email-editor/proposal';

import { Playground, PlaygroundAction, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

const CONTENT =
  '<p>Thanks for your note about the launch. Put the caret at the end of this line, then propose.</p>';

/** What the stand-in model writes, a word at a time — as text, or as HTML
    that takes shape while it streams. */
const WRITING = {
  text: ' We can move the review to Thursday, and I will send the updated plan by Wednesday evening.',
  html: '<p>We can move the review to <strong>Thursday</strong>:</p><ul><li><p>the updated plan by Wednesday evening</p></li><li><p>the figures the day after</p></li></ul>',
};

/**
 * A proposal as an assistant panel makes one: a stand-in model writes into
 * the text — a word at a time, after a pause to think — and nothing of it
 * is the writer's until Apply (or Ctrl-Enter) takes it in, as one undo;
 * Discard takes it out as if never written. Select part of a finished
 * proposal and Revise writes only that part again. The value panel is the
 * proposal's signals.
 */
@Component({
  selector: 'proposal-playground',
  imports: [EmailEditor, PlaygroundFrame, ProposalAccept, ProposalDiscard, ProposalKeys, MatButton],
  templateUrl: './proposal-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class ProposalPlayground {
  protected readonly playground = inject(Playground);

  readonly format = signal<'text' | 'html'>('text');
  readonly think = signal(600);
  readonly pace = signal(80);

  /** The stage's editor — `[emailEditor]` on the stage, its kit and the
      text it starts with. */
  protected readonly kit = [...richTextExtensions, createContentStream(), createContentProposal()];
  protected readonly content = CONTENT;
  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly stage = viewChild(EmailEditor);
  protected readonly editor = computed(() => this.stage()?.editor());

  protected readonly proposal = injectProposal(() => this.editor());

  protected readonly state = computed(() => ({
    active: this.proposal.active(),
    streaming: this.proposal.streaming(),
    thinking: this.proposal.thinking(),
    range: this.proposal.range(),
    selectedPart: this.proposal.selectedPart(),
  }));

  protected readonly knobs = [
    knob.choice('format', this.format, ['text', 'html']),
    knob.number('thinking (ms)', this.think, { min: 0, step: 100 }),
    knob.number('per word (ms)', this.pace, { min: 0, step: 20 }),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'stop()', run: () => this.proposal.stop() },
    { name: 'editor.focus()', run: () => this.editor()?.focus() },
  ];

  protected propose(): void {
    const format = this.format();
    const run = this.proposal.propose((writer) => this.#write(writer, WRITING[format]), { format });
    this.playground.log('propose()', run ? format : 'no editor');
    void run?.done.then((done) => this.playground.log('done', done));
  }

  protected revise(): void {
    const run = this.proposal.revise((writer) => this.#write(writer, ' next week'));
    this.playground.log('revise()', run ? 'the selected part' : 'nothing selected in it');
  }

  /** The stand-in model: a pause, then a word at a time, until stopped. */
  async #write(writer: { write(piece: string): void; signal: AbortSignal }, text: string) {
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        writer.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    await wait(this.think());
    for (const piece of text.split(/(?<=\s)/)) {
      if (writer.signal.aborted) return;
      writer.write(piece);
      await wait(this.pace());
    }
  }
}
