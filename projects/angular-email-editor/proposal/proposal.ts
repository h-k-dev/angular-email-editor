import {
  DOCUMENT,
  Directive,
  Injector,
  Signal,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import {
  ContentStreamRange,
  ContentStreamRun,
  ContentStreamWriter,
  Editor,
  StreamContentOptions,
  acceptProposal,
  discardProposal,
  isStreaming,
  proposalRange,
  proposeContent,
  reviseProposal,
  stopProposal,
} from 'angular-email-editor';
import { editorState } from 'angular-email-editor/actions';
import { AnchorRect } from 'angular-email-editor/anchor';

/**
 * A proposal in an editor, as a host's panel sees it: what is proposed and
 * whether it is still coming, where it stands, and the three things to do
 * about it. The reactive face of `proposeContent` / `acceptProposal` /
 * `discardProposal` (the main entry, which needs `createContentProposal()`
 * and `createContentStream()` in the kit).
 */
export interface EditorProposal {
  /** Something is proposed — written into the text, not the writer's yet. */
  readonly active: Signal<boolean>;
  /** The proposal is still being written. */
  readonly streaming: Signal<boolean>;
  /** Asked, and nothing has come yet: the model is thinking — for a host
      to show it, since there is nothing in the text to see. */
  readonly thinking: Signal<boolean>;
  /** Where it stands, in the document. */
  readonly range: Signal<ContentStreamRange | null>;
  /** Its box in viewport coordinates — the last line's, for a panel to
      stand under; a caret's when nothing is proposed yet. Measured anew on
      every change of the editor, so it follows the writing. */
  readonly box: Signal<AnchorRect | null>;
  /** Proposes content at the selection (or at `target`), written by
      `callback` — see `streamContent` for the writer and the options. A
      proposal already there is discarded first. `null` without an editor. */
  propose(
    callback: (writer: ContentStreamWriter) => Promise<void> | void,
    options?: Omit<StreamContentOptions, 'history'> & { target?: number | ContentStreamRange },
  ): ContentStreamRun | null;
  /** Writes a part of the proposal again — `range`, inside it, or the
      editor's selection when it lies inside — the rest standing. `null`
      when there is no proposal holding it. */
  revise(
    callback: (writer: ContentStreamWriter) => Promise<void> | void,
    options?: Omit<StreamContentOptions, 'history'> & { range?: ContentStreamRange },
  ): ContentStreamRun | null;
  /** The editor's selection, when it is a range inside the proposal —
      what {@link revise} would write again; null otherwise. */
  readonly selectedPart: Signal<ContentStreamRange | null>;
  /** Stops the writing where it is; what is proposed stays proposed. */
  stop(): void;
  /** Takes the proposal into the document: one change, one undo. */
  accept(): boolean;
  /** Takes it out, as if never written. */
  discard(): boolean;
}

/**
 * The proposal of an editor, bound and live — for a host's own panel: an
 * input of its choosing to ask with, and buttons to accept or discard:
 *
 *     readonly proposal = injectProposal(() => this.editor());
 *
 *     this.proposal.propose(async ({ write, signal }) => {
 *       for await (const piece of model.write(prompt, { signal })) write(piece);
 *     }, { format: 'html' });
 *
 *     <button [emailProposalAccept]="proposal">Apply</button>
 *     <button [emailProposalDiscard]="proposal">Discard</button>
 *
 * `editor` is read reactively: the proposal follows the editor it is given.
 * Call in an injection context, or hand it an injector.
 */
export function injectProposal(
  editor: () => Editor | undefined,
  options: { injector?: Injector } = {},
): EditorProposal {
  const injector = options.injector ?? inject(Injector);
  const state = editorState(editor, { injector });
  const range = computed(() => {
    const now = state();
    return now ? proposalRange(now) : null;
  });
  const streaming = computed(() => {
    const now = state();
    return !!now && !!proposalRange(now) && isStreaming(now);
  });
  const box = computed<AnchorRect | null>(() => {
    const now = state();
    const current = editor();
    if (!now || !current || current.view.isDestroyed) return null;
    const proposed = proposalRange(now);
    const at = proposed ? proposed.to : now.selection.from;
    // The line the proposal ends on: from where the proposal starts on it —
    // or, when the proposal began on an earlier line, from the block's own
    // left edge — to its end.
    const pos = Math.min(at, now.doc.content.size);
    const end = current.view.coordsAtPos(pos, -1);
    const start = current.view.coordsAtPos(proposed ? proposed.from : pos);
    let left = Math.min(start.left, end.left);
    if (Math.abs(start.top - end.top) >= 1) {
      const $end = now.doc.resolve(pos);
      const block = $end.depth ? current.view.nodeDOM($end.before($end.depth)) : null;
      left = block instanceof HTMLElement ? block.getBoundingClientRect().left : end.left;
    }
    return {
      left,
      top: end.top,
      width: Math.max(0, end.right - left),
      height: end.bottom - end.top,
    };
  });
  const selectedPart = computed<ContentStreamRange | null>(() => {
    const now = state();
    const proposed = now && proposalRange(now);
    if (!now || !proposed) return null;
    const { from, to, empty } = now.selection;
    return !empty && from >= proposed.from && to <= proposed.to ? { from, to } : null;
  });
  return {
    active: computed(() => range() !== null),
    selectedPart,
    revise: (callback, options = {}) => {
      const current = editor();
      const { range: given, ...rest } = options;
      const part = given ?? selectedPart();
      if (!current || !part) return null;
      return reviseProposal(current.view, part, callback, rest);
    },
    streaming,
    thinking: computed(() => {
      const current = range();
      return streaming() && !!current && current.to === current.from;
    }),
    range,
    box,
    propose: (callback, options = {}) => {
      const current = editor();
      if (!current) return null;
      const { target, ...rest } = options;
      return proposeContent(current.view, target ?? current.state.selection.from, callback, rest);
    },
    stop: () => {
      const current = editor();
      if (current) stopProposal(current.view);
    },
    accept: () => {
      const current = editor();
      return !!current && acceptProposal(current.view);
    },
    discard: () => {
      const current = editor();
      return !!current && discardProposal(current.view);
    },
  };
}

/**
 * The proposal of an editor, as a directive: put it on the element that
 * holds the host's panel — the chat, the buttons — and everything inside
 * has it, by injection, with nothing to bind:
 *
 *     <div [emailProposal]="editor" #p="emailProposal">
 *       <button emailProposalAccept [disabled]="!p.active()">Apply</button>
 *       <button emailProposalDiscard>Discard</button>
 *     </div>
 *
 * The directive *is* the {@link EditorProposal}: `p.active()`,
 * `p.propose(…)`, `p.accept()` — the same face `injectProposal` gives a
 * class, for a host that lives in its template. The two are one thing
 * looked at from two sides; a trigger takes either, bound or injected.
 */
@Directive({ selector: '[emailProposal]', exportAs: 'emailProposal' })
export class Proposal implements EditorProposal {
  /** The editor the proposal is in — read reactively, so it may come
      later, or change. */
  readonly editor = input.required<Editor | undefined>({ alias: 'emailProposal' });

  readonly #proposal = injectProposal(() => this.editor());

  readonly active = this.#proposal.active;
  readonly streaming = this.#proposal.streaming;
  readonly thinking = this.#proposal.thinking;
  readonly range = this.#proposal.range;
  readonly box = this.#proposal.box;
  readonly selectedPart = this.#proposal.selectedPart;

  propose(...args: Parameters<EditorProposal['propose']>): ContentStreamRun | null {
    return this.#proposal.propose(...args);
  }

  revise(...args: Parameters<EditorProposal['revise']>): ContentStreamRun | null {
    return this.#proposal.revise(...args);
  }

  stop(): void {
    this.#proposal.stop();
  }

  accept(): boolean {
    return this.#proposal.accept();
  }

  discard(): boolean {
    return this.#proposal.discard();
  }
}

/** A trigger's own binding: an `EditorProposal`, or nothing — the bare
    attribute (`''`) counts as nothing, and the ancestor's is used. */
const bound = (value: EditorProposal | '' | undefined): EditorProposal | undefined =>
  value || undefined;

/** The proposal a trigger acts on: the one bound to it, else the one an
    `[emailProposal]` ancestor provides. Neither is a mistake, and said so. */
function resolveProposal(
  own: Signal<EditorProposal | undefined>,
  selector: string,
): Signal<EditorProposal> {
  const provided = inject(Proposal, { optional: true });
  return computed(() => {
    const proposal = own() ?? provided ?? undefined;
    if (!proposal) {
      throw new Error(
        `[${selector}] has no proposal: bind one ([${selector}]="proposal"), ` +
          `or put [emailProposal] on an ancestor.`,
      );
    }
    return proposal;
  });
}

/**
 * Makes the host's own button the one that accepts the proposal: a click
 * takes it into the document and hands the caret back; disabled — by the
 * host's own means, bound from `disabled()` — while nothing is proposed or
 * it is still being written. The proposal is bound, or, bare, the
 * `[emailProposal]` ancestor's.
 *
 *     <button mat-button [emailProposalAccept]="proposal" #apply="emailProposalAccept"
 *             [disabled]="apply.disabled()">Apply</button>
 */
@Directive({
  selector: '[emailProposalAccept]',
  exportAs: 'emailProposalAccept',
  host: { '(click)': 'run()', '[attr.aria-disabled]': 'disabled() ? true : null' },
})
export class ProposalAccept {
  readonly proposal = input(undefined, { alias: 'emailProposalAccept', transform: bound });

  readonly #proposal = resolveProposal(this.proposal, 'emailProposalAccept');

  readonly disabled = computed(() => !this.#proposal().active() || this.#proposal().streaming());

  run(): boolean {
    if (this.disabled()) return false;
    return this.#proposal().accept();
  }
}

/**
 * Makes the host's own button the one that discards the proposal: a click
 * takes it out, wherever the writing has got to. The proposal is bound,
 * or, bare, the `[emailProposal]` ancestor's.
 *
 *     <button mat-button [emailProposalDiscard]="proposal">Discard</button>
 */
@Directive({
  selector: '[emailProposalDiscard]',
  exportAs: 'emailProposalDiscard',
  host: { '(click)': 'run()', '[attr.aria-disabled]': 'disabled() ? true : null' },
})
export class ProposalDiscard {
  readonly proposal = input(undefined, { alias: 'emailProposalDiscard', transform: bound });

  readonly #proposal = resolveProposal(this.proposal, 'emailProposalDiscard');

  readonly disabled = computed(() => !this.#proposal().active());

  run(): boolean {
    if (this.disabled()) return false;
    return this.#proposal().discard();
  }
}

/**
 * The keys of a proposal, heard from anywhere on the page — the text, the
 * host's input, a button — while one stands, before anything else hears
 * them (the document, capture phase):
 *
 * - **Ctrl-Enter** (⌘-Enter on a Mac) accepts: a proposal on the table is
 *   what the key commits, and whatever the editor binds to it (a send,
 *   say) never sees it. While the proposal is still being written the key
 *   is swallowed — nothing is sent, nothing is applied; one thing at a
 *   time. `accepted` says it happened.
 * - **Escape** is the host's: `escape` carries the event, and the host
 *   decides — close a menu over the text first, or let the proposal go —
 *   because what else is open is the host's to know. Nothing is prevented
 *   or stopped for it; the host does that on the event if it acts.
 *
 * Nothing is heard while nothing is proposed, and an IME's own keys stay
 * the IME's. The proposal is bound, or, bare, the `[emailProposal]`
 * ancestor's.
 *
 *     <div [emailProposal]="editor" emailProposalKeys
 *          (accepted)="done()" (escape)="$event.preventDefault(); leave()">
 */
@Directive({ selector: '[emailProposalKeys]', exportAs: 'emailProposalKeys' })
export class ProposalKeys {
  readonly proposal = input(undefined, { alias: 'emailProposalKeys', transform: bound });

  /** Ctrl-Enter (⌘-Enter) took the proposal into the document. */
  readonly accepted = output<void>();

  /** Escape, with a proposal standing — for the host to act on. */
  readonly escape = output<KeyboardEvent>();

  readonly #proposal = resolveProposal(this.proposal, 'emailProposalKeys');

  readonly #document = inject(DOCUMENT);

  constructor() {
    effect((onCleanup) => {
      const proposal = this.#proposal();
      if (!proposal.active()) return;
      const onKeydown = (event: KeyboardEvent) => {
        if (event.isComposing) return;
        if (event.key === 'Escape') {
          this.escape.emit(event);
        } else if (event.key === 'Enter' && (isMac() ? event.metaKey : event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          if (!proposal.streaming() && proposal.accept()) this.accepted.emit();
        }
      };
      this.#document.addEventListener('keydown', onKeydown, true);
      onCleanup(() => this.#document.removeEventListener('keydown', onKeydown, true));
    });
  }
}

/** Whether the keyboard is a Mac's: ⌘ where others hold Ctrl. */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);
}
