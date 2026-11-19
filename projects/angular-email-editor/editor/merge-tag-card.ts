import { Signal, WritableSignal, computed, linkedSignal, signal } from '@angular/core';
import type { MergeTagHover, MergeTagState } from '@h-k-dev/angular-email-editor';

/** What a row of a placeholder's card does — the name of the
    {@link MergeTagHover} way it runs. */
export type MergeTagCardAction =
  | 'parse'
  | 'write'
  | 'remove'
  | 'unparse'
  | 'edit'
  | 'reset'
  | 'restore';

/** The rows a placeholder can have, in the order they read. */
const ORDER: readonly MergeTagCardAction[] = [
  'parse',
  'write',
  'edit',
  'reset',
  'unparse',
  'restore',
  'remove',
];

export interface MergeTagCardOptions {
  /** A way ran: the card has nothing more to say — the host takes it
      away. Not told for *Write a value* and *Edit value* until the value
      is applied: those open the field first ({@link MergeTagCard.editing}). */
  done?: (action: MergeTagCardAction, tag: MergeTagHover) => void;
  /** The field opened — the host puts the focus in it, once it is drawn. */
  fieldOpened?: (tag: MergeTagHover) => void;
}

/**
 * A placeholder's card, as a host draws it: what the card is about, the
 * rows it has, its value field — and nothing of how any of it looks. The
 * host's template is its own (its menu, its icons, its words, its overlay);
 * this is everything behind it, the same for a message's composer and a
 * template's design desk, before a parse and after it.
 */
export interface MergeTagCard {
  /** The placeholder the card is about; null while there is none. */
  readonly tag: Signal<MergeTagHover | null>;
  /** What it is: a token as written, a previewed value, a filled value. */
  readonly state: Signal<MergeTagState | null>;
  /** The token as written — `{{ customer_lastName }}`; `''` with no tag. */
  readonly token: Signal<string>;
  /** Its expression, trimmed — what a host looks a **type** up by ("Date",
      "Amount"), to say before a parse and after; `''` with no tag. */
  readonly expr: Signal<string>;
  /** The value a preview draws in its place; `''` otherwise (a filled
      value is in the text itself). */
  readonly value: Signal<string>;
  /**
   * The rows it has, in the order they read — the ways the editor reports
   * for this placeholder, so nothing is decided by the host:
   *
   * - a token: `parse`, then `write` in a message, `remove`;
   * - a filled value: `edit`, `reset` while it is written over, `restore`;
   * - a previewed value: `unparse`, `remove`.
   */
  readonly rows: Signal<readonly MergeTagCardAction[]>;
  /** The value field is open, in the rows' place — after `write` or
      `edit`. Another placeholder under the card starts with its rows. */
  readonly editing: Signal<boolean>;
  /** What the field holds — two-way with the host's field. */
  readonly draft: WritableSignal<string>;
  /** Whether {@link apply} would write anything: the field holds something. */
  readonly canApply: Signal<boolean>;

  /** Says what the card is about — the extension's `onHover`, a tag read
      with `mergeTagHoverOf`, or `null` when the card went. */
  show(tag: MergeTagHover | null): void;
  /** A row picked: `write` and `edit` open the field (over the value as it
      reads, or empty for a token); every other runs its way and is done. */
  choose(action: MergeTagCardAction): void;
  /** Writes the draft in — over a filled value, or in a token's place —
      and is done. Nothing while the field is empty, or when the editor
      refuses (the placeholder is gone): the field stays. */
  apply(): void;
  /** The field's keys, for its `(keydown)`: Enter applies, Shift-Enter is
      a line break. */
  fieldKeys(event: KeyboardEvent): void;
  /** The field's `(input)`, for a host that does not bind `draft` itself. */
  fieldInput(event: Event): void;
}

/**
 * The binding behind a placeholder's card — wire the extension to it, draw
 * the card from it:
 *
 *     readonly card = mergeTagCard({ done: () => this.overlay.close() });
 *     // the kit
 *     createMergeTagHover({ onHover: (hover) => hover && this.card.show(hover) })
 *
 *     @if (card.tag(); as tag) {
 *       <span>{{ card.token() }}</span> <span>{{ typeOf(card.expr()) }}</span>
 *       @if (card.editing()) {
 *         <textarea [value]="card.draft()" (input)="card.fieldInput($event)"
 *                   (keydown)="card.fieldKeys($event)"></textarea>
 *         <button [disabled]="!card.canApply()" (click)="card.apply()">✓</button>
 *       } @else {
 *         @for (row of card.rows(); track row) {
 *           <button (click)="card.choose(row)">{{ labels[row] }}</button>
 *         }
 *       }
 *     }
 *
 * The host decides when the card shows and goes (its overlay, its hover
 * card — anchored to `tag().element`), what a row is called and looks like,
 * and what type a placeholder is. Signals only: no injection context
 * needed, nothing to destroy.
 */
export function mergeTagCard(options: MergeTagCardOptions = {}): MergeTagCard {
  const tag = signal<MergeTagHover | null>(null);
  // The piece the card stands on, memoised: the same placeholder reported
  // anew (it changed under the card) is no new one, and keeps its field.
  const piece = computed(() => tag()?.element);
  const editing = linkedSignal<HTMLElement | undefined, boolean>({
    source: piece,
    computation: () => false,
  });
  const draft = signal('');

  const finish = (action: MergeTagCardAction, of: MergeTagHover) => options.done?.(action, of);

  const apply = () => {
    const of = tag();
    const text = draft();
    if (!of || !text) return;
    const action: MergeTagCardAction = of.edit ? 'edit' : 'write';
    if (of.edit ? of.edit(text) : of.write?.(text)) finish(action, of);
  };

  return {
    tag: tag.asReadonly(),
    state: computed(() => tag()?.state ?? null),
    token: computed(() => {
      const of = tag();
      return of ? `{{ ${of.expr} }}` : '';
    }),
    expr: computed(() => tag()?.expr ?? ''),
    value: computed(() => {
      const of = tag();
      return of?.state === 'previewed' ? of.value : '';
    }),
    rows: computed(() => {
      const of = tag();
      return of ? ORDER.filter((action) => !!of[action]) : [];
    }),
    editing: editing.asReadonly(),
    draft,
    canApply: computed(() => !!tag() && !!draft()),

    show: (next) => tag.set(next),
    choose: (action) => {
      const of = tag();
      if (!of?.[action]) return;
      if (action === 'write' || action === 'edit') {
        draft.set(action === 'edit' ? of.text : '');
        editing.set(true);
        options.fieldOpened?.(of);
        return;
      }
      of[action]();
      finish(action, of);
    },
    apply,
    fieldKeys: (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      apply();
    },
    fieldInput: (event) => draft.set((event.target as HTMLTextAreaElement | HTMLInputElement).value),
  };
}
