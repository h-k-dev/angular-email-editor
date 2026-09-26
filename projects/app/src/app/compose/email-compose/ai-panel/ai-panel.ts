import {
  Component,
  DOCUMENT,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// Library
import { ChatInput } from 'angular-email-editor/chat-input';
import { ProposalAccept, ProposalDiscard, injectProposal } from 'angular-email-editor/proposal';

import { Ai } from '../../../../services/ai';
import { I18n } from '../../../../services/i18n';
import { FormattingCommands } from '../formatting-commands';
import { AiAsk } from '../ai-writer';

/**
 * The assistant's bar: the assistant writes **into the message**, where
 * its words will stand — as a *proposal*, marked, outside the history
 * (the library's content proposal) — and this bar, docked above the
 * formatting toolbar, holds the one thing that is not text: the way to
 * steer and decide. Docked, not floating: a proposal grows, wraps and
 * scrolls, and a panel chasing its last line moved too much.
 *
 * The chat input is the library's (`email-chat-input`: lines and lists,
 * Enter asks); Try again asks once more with what it says; Discard and
 * Apply are the library's triggers on Material buttons. The proposal is
 * ordinary text in the meantime: the writer edits it in place, and Apply
 * takes it as it stands — edits and all — into the message as one change,
 * one undo. Only Escape (from anywhere) or Discard take it out; a click
 * elsewhere, in the text above all, is editing, not leaving.
 *
 * All of the mechanics are the library's (`injectProposal`); this
 * component is what a host writes — a host with an input of its own
 * writes the same few lines around it.
 */
@Component({
  selector: 'div[ai-panel]',
  imports: [
    // Material
    MatButtonModule,
    MatIconModule,

    // Library
    ChatInput,
    ProposalAccept,
    ProposalDiscard,
  ],
  templateUrl: './ai-panel.html',
  styleUrl: './ai-panel.scss',
  host: { '[hidden]': '!open()' },
})
export class AiPanel {
  readonly #commands = inject(FormattingCommands);

  readonly #ai = inject(Ai);

  readonly #injector = inject(Injector);

  readonly #document = inject(DOCUMENT);

  protected readonly i18n = inject(I18n);

  /** The language the assistant writes in — the composer's, asked when the
      writing starts. */
  readonly language = input<() => 'en' | 'de' | 'ja'>(() => 'en');

  /** The proposal in the email editor: its state, and the three things
      to do about it. */
  protected readonly proposal = injectProposal(() => this.#commands.editor());

  protected readonly open = signal(false);

  /** What the writer typed into the chat input — sent with the next ask. */
  protected readonly instructions = signal('');

  protected readonly chat = viewChild(ChatInput);

  /** What the writer asked from, for as long as the bar is up. */
  #ask: AiAsk | null = null;

  constructor() {
    // Escape, from anywhere on the page — the text, the input, a button —
    // lets the proposal go. Only while the bar is up; an IME's own Escape
    // stays the IME's.
    effect((onCleanup) => {
      if (!this.open()) return;
      const onKeydown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        this.close();
      };
      this.#document.addEventListener('keydown', onKeydown);
      onCleanup(() => this.#document.removeEventListener('keydown', onKeydown));
    });
  }

  /** Opens the bar and asks the assistant at once: the answer begins to
      appear in the message, under the caret. */
  show(ask: AiAsk): void {
    if (!this.#commands.editor()) return;
    this.#ask = ask;
    this.instructions.set('');
    this.open.set(true);
    this.#write();
    // The chat input exists once the render that shows the bar has run.
    afterNextRender({ write: () => this.chat()?.focus() }, { injector: this.#injector });
  }

  /** The chat input's Enter, or Try again: asks once more, with the
      instructions, over what is there. */
  protected ask(instructions = this.instructions()): void {
    this.instructions.set(instructions);
    this.#write();
  }

  /** Apply pressed: the library took the proposal in — as it stands, the
      writer's edits with it; the bar is done. */
  protected applied(): void {
    this.open.set(false);
    this.#commands.focus();
  }

  /** Discard pressed, or Escape: the library takes it out; the caret is
      back in the text. */
  protected close(): void {
    this.proposal.discard();
    this.open.set(false);
    this.#commands.focus();
  }

  /** Asks the assistant and proposes the answer at the caret — over an
      earlier proposal, which goes. */
  #write(): void {
    const ask = this.#ask;
    if (!ask) return;
    const request = {
      before: ask.before,
      language: this.language()(),
      instructions: this.instructions(),
    };
    this.proposal
      .propose(
        async ({ write, signal }) => {
          for await (const piece of this.#ai.write(request, { signal })) write(piece);
        },
        { format: 'html' },
      )
      ?.done.catch((reason) => console.error(reason));
  }
}
