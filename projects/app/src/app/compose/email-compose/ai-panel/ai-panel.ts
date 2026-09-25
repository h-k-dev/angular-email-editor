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

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition } from '@angular/cdk/overlay';

// Library
import { ChatInput } from 'angular-email-editor/chat-input';
import { ProposalAccept, ProposalDiscard, injectProposal } from 'angular-email-editor/proposal';

import { Ai } from '../../../../services/ai';
import { I18n } from '../../../../services/i18n';
import { FormattingCommands } from '../formatting-commands';
import { dismissOnPressOutside } from '../../dismiss-outside';
import { Popover } from '../popover/popover';
import { AiAsk } from '../ai-writer';

/** Under the proposal's last line, opening to the right of where it
    starts; above when there is no room below. */
const UNDER_THE_PROPOSAL: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
];

/**
 * The assistant's panel: the assistant writes **into the message**, where
 * its words will stand — as a *proposal*, marked, outside the history
 * (the library's content proposal) — and this panel floats under it with
 * the one thing that is not text: the way to steer and decide. A panel of
 * the composer's one popover, in its dialog layer.
 *
 * The chat input is the library's (`email-chat-input`: lines and lists,
 * Enter asks); Try again asks once more with what it says; Discard and
 * Apply are the library's triggers on Material buttons. Apply takes the
 * proposal into the message as one change — one undo. Anything else —
 * Discard, Escape, a press outside — takes it out, and the message is
 * exactly as it was, with nothing in its history.
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
})
export class AiPanel {
  readonly #commands = inject(FormattingCommands);

  readonly #popover = inject(Popover);

  readonly #ai = inject(Ai);

  readonly #injector = inject(Injector);

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

  /** Under the proposal, following it as it grows. */
  protected readonly anchor = computed(() => (this.open() ? this.proposal.box() : null));

  protected readonly chat = viewChild(ChatInput);

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  /** What the writer asked from, for as long as the panel is up. */
  #ask: AiAsk | null = null;

  constructor() {
    this.#popover.register({
      layer: 'dialog',
      open: this.open,
      anchor: this.anchor,
      content: this.panel,
      positions: () => UNDER_THE_PROPOSAL,
      onKeydown: (event) => this.onKeydown(event),
    });
    // A press outside lets the proposal go — never the click (a `/` menu
    // row) that opened the panel.
    dismissOnPressOutside(
      this.open,
      () => this.#popover.pane(),
      () => this.dismiss(),
    );
  }

  /** Opens the panel and asks the assistant at once: the answer begins to
      appear in the message, under the caret. */
  show(ask: AiAsk): void {
    if (!this.#commands.editor()) return;
    this.#ask = ask;
    this.instructions.set('');
    this.open.set(true);
    this.#write();
    // The chat input exists once the render that opens the panel has run.
    afterNextRender({ write: () => this.chat()?.focus() }, { injector: this.#injector });
  }

  /** The chat input's Enter, or Try again: asks once more, with the
      instructions, over what is there. */
  protected ask(instructions = this.instructions()): void {
    this.instructions.set(instructions);
    this.#write();
  }

  /** Apply pressed: the library took the proposal in; the panel is done. */
  protected applied(): void {
    this.open.set(false);
    this.#commands.focus();
  }

  /** Discard pressed, or Escape: the library took it out; the caret is
      back in the text. */
  protected close(): void {
    this.proposal.discard();
    this.open.set(false);
    this.#commands.focus();
  }

  /** A press outside lets it go — and is just a press. */
  protected dismiss(): void {
    this.proposal.discard();
    this.open.set(false);
  }

  /** Escape from anywhere — the input, a button, the editor beneath; an
      IME's own Escape stays the IME's. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    this.close();
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
