import {
  Component,
  Injector,
  TemplateRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// Material
import { MatIconModule } from '@angular/material/icon';

// Library
import { ContentStreamWriter } from 'angular-email-editor';
import { ChatInput } from 'angular-email-editor/chat-input';
import {
  ProposalAccept,
  ProposalDiscard,
  ProposalKeys,
  injectProposal,
} from 'angular-email-editor/proposal';

import { Ai } from '../../../../services/ai';
import { I18n } from '../../../../services/i18n';
import { FormattingCommands } from '../formatting-commands';
import { Popover } from '../popover/popover';
import { AiAsk } from '../ai-writer';

/**
 * The chat-based suggestion: the assistant writes **into the message**,
 * where its words will stand — as a *proposal*, marked, outside the
 * history (the library's content proposal) — and this bar, docked above
 * the formatting toolbar, is the chat that steers and decides. Docked,
 * not floating: a proposal grows, wraps and scrolls, and a panel chasing
 * its last line moved too much.
 *
 * Two lines. Above, on nothing — the bar has no surface, so what stands
 * on it floats over the text: on the left, three dots that dance while
 * the model thinks (asked, and nothing has come yet); on the right,
 * Discard and Apply, as words — no state layer, a touch target's height.
 * Below, the field: the library's chat input (lines and lists, Enter
 * sends), outlined, open at the bottom onto the toolbar it sits on. One
 * button goes with it — voice input while the field is empty, send once
 * there is text, stop while the assistant writes — at the field's end
 * when the toolbar is off, at the *toolbar's* end when it is on (a phone
 * always): the composer hands the button over (`action`,
 * `actionInToolbar`), so it reads as the bar's own.
 *
 * The proposal is ordinary text in the meantime: the writer edits it in
 * place, and Apply takes it as it stands — edits and all — into the
 * message as one change, one undo. Only Escape or Discard take it out; a
 * click elsewhere, in the text above all, is editing, not leaving. Escape
 * is one thing at a time: a bubble menu or a dialog up over the text
 * closes first, and the next Escape lets the proposal go.
 *
 * All of the mechanics are the library's: `injectProposal` for the
 * proposal's state and ways out, `[emailProposalKeys]` for Ctrl-Enter
 * and Escape, the triggers for the two words, the chat input for the
 * field. This component is what a host writes around them — a host with
 * an input of its own writes the same few lines around its own.
 */
@Component({
  selector: 'div[chat-based-suggestion]',
  imports: [
    NgTemplateOutlet,

    // Material
    MatIconModule,

    // Library
    ChatInput,
    ProposalAccept,
    ProposalDiscard,
    ProposalKeys,
  ],
  templateUrl: './chat-based-suggestion.html',
  styleUrl: './chat-based-suggestion.scss',
  host: { '[hidden]': '!open()' },
})
export class ChatBasedSuggestion {
  readonly #commands = inject(FormattingCommands);

  readonly #popover = inject(Popover);

  readonly #ai = inject(Ai);

  readonly #injector = inject(Injector);

  protected readonly i18n = inject(I18n);

  /** The language the assistant writes in — the composer's, asked when the
      writing starts. */
  readonly language = input<() => 'en' | 'de' | 'ja'>(() => 'en');

  /** The proposal in the email editor: its state, and the ways out. */
  protected readonly proposal = injectProposal(() => this.#commands.editor());

  /** Whether the strip is up — the composer reads it to hand the button
      to the toolbar. */
  readonly open = signal(false);

  /** Whether the toolbar under the strip is shown: then the button is
      the bar's, pinned at its end, and the strip holds the field alone. */
  readonly actionInToolbar = input(false);

  /** The one button — voice input while the field is empty, send once
      there is text, stop while the assistant writes — as a template, for
      the strip or for the toolbar's end. */
  readonly action = viewChild<TemplateRef<unknown>>('action');

  /** What the writer typed into the chat input — sent with the next ask. */
  protected readonly instructions = signal('');

  /** Something to send: the field is not empty. */
  protected readonly canSend = computed(() => this.instructions().trim() !== '');

  /** The assistant is at work — thinking, or writing — and the send button
      is a stop button: one message at a time. */
  protected readonly busy = this.proposal.streaming;

  protected readonly chat = viewChild(ChatInput);

  /** What the writer asked from, for as long as the bar is up. */
  #ask: AiAsk | null = null;

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

  /** The chat input's Enter, or the send button: asks once more, with the
      instructions — over what is there, or, with a part of the proposal
      selected in the text, over that part alone. Not while the assistant
      is still at work: one message at a time. */
  protected ask(instructions = this.instructions()): void {
    if (!instructions.trim() || this.busy()) return;
    this.instructions.set(instructions);
    this.#write();
    this.chat()?.clear();
    this.chat()?.focus();
  }

  /** The stop button: the writing stops where it is; what has come stays
      proposed, to apply, discard, or ask over. */
  protected stop(): void {
    this.proposal.stop();
    this.chat()?.focus();
  }

  /** Apply pressed: the library took the proposal in — as it stands, the
      writer's edits with it; the bar is done. */
  protected applied(): void {
    this.open.set(false);
    this.#commands.focus();
  }

  /** Escape, from anywhere on the page while the proposal stands (the
      library's keys directive hears it) — one thing at a time: a menu up
      over the text (a bubble on a selection in the proposal, a link
      editor) closes first; with none up, the proposal goes. */
  protected escape(event: KeyboardEvent): void {
    event.preventDefault();
    if (this.#popover.close()) return;
    this.close();
  }

  /** Discard pressed, or Escape: the library takes it out; the caret is
      back in the text. */
  protected close(): void {
    this.proposal.discard();
    this.open.set(false);
    this.#commands.focus();
  }

  /** Asks the assistant and proposes the answer at the caret — over an
      earlier proposal, which goes; or, with a part of it selected, writes
      that part again, the rest standing. */
  #write(): void {
    const ask = this.#ask;
    const editor = this.#commands.editor();
    if (!ask || !editor) return;
    const part = this.proposal.selectedPart();
    const request = {
      before: ask.before,
      language: this.language()(),
      instructions: this.instructions(),
      ...(part && { selection: editor.state.doc.textBetween(part.from, part.to, '\n', ' ') }),
    };
    const callback = async ({ write, signal }: ContentStreamWriter) => {
      for await (const piece of this.#ai.write(request, { signal })) write(piece);
    };
    const run = part
      ? this.proposal.revise(callback, { format: 'html', range: part })
      : this.proposal.propose(callback, { format: 'html' });
    run?.done.catch((reason) => console.error(reason));
  }
}
