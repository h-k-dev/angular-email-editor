import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,

  // Signals
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { MergeTagHover } from '@h-k-dev/angular-email-editor';

/** What a card's row does — the name of the {@link MergeTagHover} way it runs. */
export type MergeTagCardAction =
  | 'parse'
  | 'write'
  | 'remove'
  | 'unparse'
  | 'edit'
  | 'reset'
  | 'restore';

interface Row {
  action: MergeTagCardAction;
  label: string;
  /** The value a Reset takes back, for the row's tooltip. */
  title?: string;
}

/**
 * A placeholder's card — what stands beside a `{{ token }}`, a previewed
 * value or a filled-in value while the peek key is held over it: what the
 * placeholder is, and what can be done to it. The same card in a message
 * and in a template, before a parse and after it; its rows are the ways the
 * editor reports for the placeholder ({@link MergeTagHover}, from
 * `createMergeTagHover`), so nothing is decided here:
 *
 * - **before a parse** (a token): *Parse* — this placeholder alone — then,
 *   in a message, *Write a value*, and *Remove placeholder*;
 * - **after a parse**: on a filled value *Edit value*, *Reset* (while it is
 *   written over), *Restore placeholder*; on a previewed one *Show
 *   placeholder* and *Remove placeholder*.
 *
 * Its head says the token as written, and — when the host knows — the
 * **type** of what it stands for (`type`: "Date", "Amount", "Case"), so a
 * value still says what it is after the parse; under it the value, where
 * one is drawn, or a `note` of the host's ("No value for this recipient").
 *
 * *Write a value* and *Edit value* open a field in the rows' place: Enter
 * applies, Shift-Enter is a line break, and Apply is the icon button at the
 * field's end.
 *
 *     createMergeTagHover({ onHover: (hover) => this.hover.set(hover) })
 *
 *     @if (hover(); as tag) {
 *       <div email-merge-tag-card [tag]="tag" [type]="typeOf(tag.expr)" (done)="close()"></div>
 *     }
 *
 * **Content only.** Where it floats is the host's — its overlay, its hover
 * card, anchored to `tag.element`; so are Escape and a press outside. It
 * says when it is finished (`done`: a way ran) and takes the focus when
 * asked ({@link focus}). The rows are a menu: the arrows walk them, Home
 * and End reach the ends, Enter and Space pick.
 *
 * Every word it says is an input, English by default. No Material, no icon
 * font: its few glyphs are its own.
 */
@Component({
  selector: '[email-merge-tag-card]',
  templateUrl: './merge-tag-card.html',
  styleUrl: './merge-tag-card.scss',
  host: {
    '[attr.data-state]': 'tag().state',
    '[attr.data-editing]': 'editing() || null',
  },
})
export class MergeTagCard {
  /** The placeholder the card is about, as the editor last reported it. */
  readonly tag = input.required<MergeTagHover>();

  /** What kind of placeholder it is, in the host's words — "Date",
      "Amount", "Case". Shown beside the token; left out when not given. */
  readonly type = input<string | null>();
  /** A line under the token, the host's — why the card is up, where it is
      not the pointer's doing ("No value for this recipient"). */
  readonly note = input<string | null>();

  readonly parseLabel = input('Parse');
  readonly writeLabel = input('Write a value');
  readonly removeLabel = input('Remove placeholder');
  readonly unparseLabel = input('Show placeholder');
  readonly editLabel = input('Edit value');
  readonly resetLabel = input('Reset');
  readonly restoreLabel = input('Restore placeholder');
  /** The field's accessible name. */
  readonly valueLabel = input('Value');
  /** The apply button's accessible name and tooltip. */
  readonly applyLabel = input('Apply');
  /** The rows' accessible name; the token as written when not given. */
  readonly menuLabel = input<string>();

  /** A way ran — the card has nothing more to say: the host closes it. */
  readonly done = output<MergeTagCardAction>();

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #injector = inject(Injector);

  /** The token as written. */
  protected readonly token = computed(() => `{{ ${this.tag().expr} }}`);

  /** The value to show under the token: what a preview draws. A filled
      value is in the text itself. */
  protected readonly shownValue = computed(() => {
    const tag = this.tag();
    return tag.state === 'previewed' ? tag.value : '';
  });

  /** The rows this placeholder has, in the order they read. */
  protected readonly rows = computed<Row[]>(() => {
    const tag = this.tag();
    const rows: (Row | false | undefined)[] = [
      tag.parse && { action: 'parse', label: this.parseLabel() },
      tag.write && { action: 'write', label: this.writeLabel() },
      tag.edit && { action: 'edit', label: this.editLabel() },
      tag.reset && { action: 'reset', label: this.resetLabel(), title: tag.value },
      tag.unparse && { action: 'unparse', label: this.unparseLabel() },
      tag.restore && { action: 'restore', label: this.restoreLabel() },
      tag.remove && { action: 'remove', label: this.removeLabel() },
    ];
    return rows.filter((row): row is Row => !!row);
  });

  /** The field is open — over a value, or for a token's first. Another
      placeholder under the card starts with its rows again. */
  protected readonly editing = linkedSignal<HTMLElement, boolean>({
    source: () => this.tag().element,
    computation: () => false,
  });

  /** What the field holds. */
  protected readonly draft = signal('');

  /** Puts the focus in the card: on its field while one is open, else on
      its first row — for a card opened by the keyboard's doing (a form that
      put the caret on a token), so the arrows carry on. */
  focus(): void {
    const selector = this.editing() ? 'textarea' : '[role="menuitem"]';
    const focus = () => {
      const element = this.#host.querySelector<HTMLElement>(selector);
      element?.focus();
      return !!element;
    };
    if (!focus()) afterNextRender(focus, { injector: this.#injector });
  }

  /** A row picked. */
  protected choose(action: MergeTagCardAction): void {
    const tag = this.tag();
    if (action === 'write' || action === 'edit') {
      this.draft.set(action === 'edit' ? tag.text : '');
      this.editing.set(true);
      afterNextRender(
        () => {
          const field = this.#host.querySelector('textarea');
          field?.focus();
          field?.select();
        },
        { injector: this.#injector },
      );
      return;
    }
    tag[action]?.();
    this.done.emit(action);
  }

  /** The arrows walk the rows, Home and End reach the ends; Enter and Space
      pick the one the focus is on — here, on the key going down, as a menu
      picks (and never twice: the button's own click is kept from following). */
  protected rowKeys(event: KeyboardEvent): void {
    const rows = [...this.#host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = rows.indexOf(event.target as HTMLElement);
    if (event.key === 'Enter' || event.key === ' ') {
      const action = rows[at]?.getAttribute('data-action') as MergeTagCardAction | null;
      if (!action || event.isComposing) return;
      event.preventDefault();
      this.choose(action);
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined || !rows.length) return;
    event.preventDefault();
    const next =
      step === -Infinity
        ? 0
        : step === Infinity
          ? rows.length - 1
          : (at + step + rows.length) % rows.length;
    rows[next].focus();
  }

  protected input(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  /** The field's keys: Enter writes the value in, Shift-Enter is a line
      break. */
  protected fieldKeys(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.apply();
  }

  /** Writes the draft in — over a filled value, or in a token's place. */
  protected apply(): void {
    const draft = this.draft();
    if (!draft) return;
    const tag = this.tag();
    const action: MergeTagCardAction = tag.edit ? 'edit' : 'write';
    if (tag.edit ? tag.edit(draft) : tag.write?.(draft)) this.done.emit(action);
  }
}
