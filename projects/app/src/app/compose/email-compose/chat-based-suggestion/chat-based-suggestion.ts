import {
  Component,
  DOCUMENT,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';

// Library
import { ChatInput } from 'angular-email-editor/chat-input';
import { ProposalAccept, ProposalDiscard, injectProposal } from 'angular-email-editor/proposal';

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
 * sends) in a pill, with a place for voice input and the send button — a
 * mouse's way to ask.
 *
 * The proposal is ordinary text in the meantime: the writer edits it in
 * place, and Apply takes it as it stands — edits and all — into the
 * message as one change, one undo. Only Escape or Discard take it out; a
 * click elsewhere, in the text above all, is editing, not leaving. Escape
 * is one thing at a time: a bubble menu or a dialog up over the text
 * closes first, and the next Escape lets the proposal go.
 *
 * All of the mechanics are the library's (`injectProposal`); this
 * component is what a host writes — a host with an input of its own
 * writes the same few lines around it.
 */
@Component({
  selector: 'div[chat-based-suggestion]',
  imports: [
    // Material
    MatIconModule,

    // Library
    ChatInput,
    ProposalAccept,
    ProposalDiscard,
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

  readonly #document = inject(DOCUMENT);

  protected readonly i18n = inject(I18n);

  /** The language the assistant writes in — the composer's, asked when the
      writing starts. */
  readonly language = input<() => 'en' | 'de' | 'ja'>(() => 'en');

  /** The proposal in the email editor: its state, and the ways out. */
  protected readonly proposal = injectProposal(() => this.#commands.editor());

  protected readonly open = signal(false);

  /** What the writer typed into the chat input — sent with the next ask. */
  protected readonly instructions = signal('');

  /** Something to send: the field is not empty. */
  protected readonly canSend = computed(() => this.instructions().trim() !== '');

  protected readonly chat = viewChild(ChatInput);

  /** What the writer asked from, for as long as the bar is up. */
  #ask: AiAsk | null = null;

  constructor() {
    // Escape, from anywhere on the page — the text, the input, a button.
    // One thing at a time: a menu up over the text (a bubble on a
    // selection in the proposal, a link editor) closes first; with none
    // up, the proposal goes. Only while the bar is up; an IME's own
    // Escape stays the IME's.
    effect((onCleanup) => {
      if (!this.open()) return;
      const onKeydown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        if (this.#popover.close()) return;
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

  /** The chat input's Enter, or the send button: asks once more, with the
      instructions, over what is there. */
  protected ask(instructions = this.instructions()): void {
    if (!instructions.trim()) return;
    this.instructions.set(instructions);
    this.#write();
    this.chat()?.clear();
    this.chat()?.focus();
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
