import { Directive, Injector, Signal, computed, inject, input } from '@angular/core';
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
    // The line the proposal ends on: from its start on that line to its end.
    const end = current.view.coordsAtPos(Math.min(at, now.doc.content.size), -1);
    const startPos = proposed ? proposed.from : at;
    const start = current.view.coordsAtPos(startPos);
    const sameLine = Math.abs(start.top - end.top) < 1;
    const left = sameLine ? Math.min(start.left, end.left) : end.left;
    return {
      left,
      top: end.top,
      width: Math.max(0, end.right - left),
      height: end.bottom - end.top,
    };
  });
  return {
    active: computed(() => range() !== null),
    streaming,
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
 * Makes the host's own button the one that accepts the proposal: a click
 * takes it into the document and hands the caret back; disabled — by the
 * host's own means, bound from `disabled()` — while nothing is proposed or
 * it is still being written.
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
  readonly proposal = input.required<EditorProposal>({ alias: 'emailProposalAccept' });

  readonly disabled = computed(() => !this.proposal().active() || this.proposal().streaming());

  run(): boolean {
    if (this.disabled()) return false;
    return this.proposal().accept();
  }
}

/**
 * Makes the host's own button the one that discards the proposal: a click
 * takes it out, wherever the writing has got to.
 *
 *     <button mat-button [emailProposalDiscard]="proposal">Discard</button>
 */
@Directive({
  selector: '[emailProposalDiscard]',
  exportAs: 'emailProposalDiscard',
  host: { '(click)': 'run()', '[attr.aria-disabled]': 'disabled() ? true : null' },
})
export class ProposalDiscard {
  readonly proposal = input.required<EditorProposal>({ alias: 'emailProposalDiscard' });

  readonly disabled = computed(() => !this.proposal().active());

  run(): boolean {
    if (this.disabled()) return false;
    return this.proposal().discard();
  }
}
