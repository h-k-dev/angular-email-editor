import {
  DOCUMENT,
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  computed,
  contentChildren,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
} from '@angular/core';
import { Directionality } from '@angular/cdk/bidi';

/** What `aria-current` may say; `true` is `'true'`, `false` says nothing. */
export type GridCurrent = 'page' | 'step' | 'location' | 'date' | 'time' | boolean;

/** Two rows in the page's order. */
function byPosition(a: GridRow, b: GridRow): number {
  return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/** What can take focus inside a widget that wraps its control (a
    mat-checkbox's input). */
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

/**
 * A control in a row's cell — a checkbox, a button — reached with the
 * arrows from its row (`GridRow`), not with Tab: the author gives it
 * `tabindex="-1"` (Material's buttons and checkbox take it as their input).
 * Focus lands on the host, or on the first focusable inside it where the
 * host only wraps its control (`<mat-checkbox>`).
 *
 * `tabOnHover`: while the pointer is on its row — the row's hover bar shown —
 * it joins the page's Tab order where it stands, and stays in it while
 * focus is on one of its row's widgets, so Tab goes on through them after
 * the pointer has left.
 */
@Directive({ selector: '[gridWidget]' })
export class GridWidget {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #row = inject(GridRow);

  /** A Tab stop while its row is under the pointer. */
  readonly tabOnHover = input(false, { transform: booleanAttribute });

  /** In the Tab order now. */
  readonly tabbable = computed(() => this.tabOnHover() && this.#row.revealed());

  constructor() {
    // Written onto the element focus lands on — inside a wrapping
    // component, there once it has rendered.
    afterRenderEffect({
      write: () => {
        if (this.tabOnHover()) this.target.tabIndex = this.tabbable() ? 0 : -1;
      },
    });
  }

  /** The element focus lands on. */
  get target(): HTMLElement {
    return this.#host.matches(FOCUSABLE)
      ? this.#host
      : (this.#host.querySelector<HTMLElement>(FOCUSABLE) ?? this.#host);
  }

  /** On screen: a hidden one (a hover-only bar on a touch screen) is
      skipped, never focused. */
  get shown(): boolean {
    return this.#host.checkVisibility?.() ?? true;
  }
}

/** A cell of a row: `gridcell`, nothing more — its controls are
    `GridWidget`s, the row is the focus. */
@Directive({ selector: '[gridCell]', host: { role: 'gridcell' } })
export class GridCell {}

/**
 * A row of a `Grid`, and the grid's focus: one row is the tab stop (the
 * active one, `tabindex="0"`), the rest `-1`. It carries its state as ARIA,
 * for the stylesheet to read too —
 *
 * - `aria-selected` — ticked (Space, in a `multi` grid): `[(selected)]`;
 * - `aria-current` — the one open, say (`[current]="'page'"`);
 *
 * and `(activate)` is Enter on the row: open it.
 */
@Directive({
  selector: '[gridRow]',
  exportAs: 'gridRow',
  host: {
    role: 'row',
    '[attr.tabindex]': 'active() ? 0 : -1',
    '[attr.aria-selected]': 'grid.multi() ? selected() : null',
    '[attr.aria-current]': 'ariaCurrent()',
    '(pointerenter)': 'hovered.set(true)',
    '(pointerleave)': 'hovered.set(false)',
    '(focusin)': 'focusIn($event)',
    '(focusout)': 'focusOut($event)',
  },
})
export class GridRow {
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly grid = inject(Grid);

  /** Ticked: Space on the row, or its checkbox. */
  readonly selected = model(false);

  /** The row that is the current one of its set — the message open. */
  readonly current = input<GridCurrent>(false);

  /** Enter on the row. */
  readonly activate = output<KeyboardEvent>();

  /** Its controls, in order: the arrows' stops after the row itself. */
  readonly widgets = contentChildren(GridWidget, { descendants: true });

  /** The grid's tab stop, where the arrows go from. */
  readonly active = computed(() => this.grid.activeRow() === this);

  /** Under the pointer. */
  protected readonly hovered = signal(false);

  /** Focus is on one of its `tabOnHover` widgets. */
  protected readonly widgetFocused = signal(false);

  /** Its `tabOnHover` widgets are Tab stops: the pointer is on it, or focus
      is on one of them. */
  readonly revealed = computed(() => this.hovered() || this.widgetFocused());

  protected focusIn(event: FocusEvent): void {
    const target = event.target;
    this.widgetFocused.set(
      this.widgets().some((widget) => widget.tabOnHover() && widget.target === target),
    );
  }

  /** Focus gone from its widgets — out of the row, or back to the row. */
  protected focusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || next === this.element || !this.element.contains(next)) {
      this.widgetFocused.set(false);
    }
  }

  protected readonly ariaCurrent = computed(() => {
    const current = this.current();
    return current === false ? null : String(current);
  });

  constructor() {
    // Into its grid once it stands in the page, where its place among the
    // others can be read; out as it goes.
    const grid = this.grid;
    afterNextRender(() => grid.register(this));
    inject(DestroyRef).onDestroy(() => grid.unregister(this));
  }
}

/**
 * A grid of rows, the rows the focus — a mail list's (Gmail's): one tab
 * stop, the rows under the arrows, each row's controls to the side of it.
 * Our own, Aria-shaped (`ngGrid`'s container + row + cell + widget): Angular
 * Aria's grid focuses cells and selects cells, never a row.
 *
 *     <div grid multi aria-label="Inbox">
 *       @for (mail of mails; track mail.id) {
 *         <div gridRow [(selected)]="mail.picked" [current]="mail.open ? 'page' : false"
 *              (activate)="open(mail)">
 *           <div gridCell><mat-checkbox gridWidget tabindex="-1" … /></div>
 *           <div gridCell>{{ mail.subject }}</div>
 *           <div gridCell><button gridWidget tabindex="-1" …>…</button></div>
 *         </div>
 *       }
 *     </div>
 *
 * Keys, on a row: ↑ ↓ the row before or after, Home / End the first or
 * last, Enter `activate`, Space `selected` (in a `multi` grid). → ← step
 * from the row through its shown widgets and back (mirrored right to left);
 * on a widget, Home / End its row's first or last, Escape back to the row.
 * Tab leaves the grid from anywhere in it — but for a `tabOnHover` widget
 * in the Tab order, where Tab goes on as the page's order has it.
 *
 * A component can be the grid itself — `hostDirectives: [Grid]`, its rows
 * in its own template — and turns `multi` on from inside
 * (`inject(Grid).multi.set(true)`), as no template binds it there.
 *
 * The tab stop is the row focus was last in; before any, the `current` row,
 * else the first. A row that goes while focus is in it (moved out from its
 * own button) hands focus to the row that takes its place.
 */
@Directive({
  selector: '[grid]',
  exportAs: 'grid',
  host: {
    role: 'grid',
    '[attr.aria-multiselectable]': 'multi() || null',
    '(keydown)': 'key($event)',
    '(focusin)': 'focusIn($event)',
    '(focusout)': 'focusOut($event)',
  },
})
export class Grid {
  readonly multiAttribute = input(false, {
    alias: 'multi',
    transform: booleanAttribute,
  });

  /** Rows can be ticked, many at once: Space, `aria-selected` — the
      attribute's, or what a component wearing the grid sets. */
  readonly multi = linkedSignal(() => this.multiAttribute());

  /** Its rows, as they came: each registers itself (`GridRow`) — a content
      query would miss the rows of a component wearing the grid, which
      stand in that component's own view. */
  readonly #rows = signal<readonly GridRow[]>([]);

  /** Its rows, in the page's order. */
  readonly rows = computed(() => [...this.#rows()].sort(byPosition));

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #document = inject(DOCUMENT);
  readonly #dir = inject(Directionality, { optional: true });

  /** The row focus was last in. */
  readonly #last = signal<GridRow | null>(null);

  /** Where focus is in the grid — its element and its row's place — while
      it is: to hand on if that row goes. */
  #focus: { readonly element: HTMLElement; readonly at: number } | null = null;

  /** The tab stop. */
  readonly activeRow = computed(() => {
    const rows = this.rows();
    const last = this.#last();
    if (last && rows.includes(last)) return last;
    return rows.find((row) => row.current() !== false) ?? rows[0] ?? null;
  });

  constructor() {
    // A row gone with focus in it: the row now in its place takes focus —
    // unless focus has gone somewhere else meanwhile.
    afterRenderEffect(() => {
      const rows = this.rows();
      const focus = this.#focus;
      if (!focus || focus.element.isConnected) return;
      this.#focus = null;
      const active = this.#document.activeElement;
      if (active && active !== this.#document.body) return;
      rows[Math.min(focus.at, rows.length - 1)]?.element.focus();
    });
  }

  register(row: GridRow): void {
    this.#rows.update((rows) => [...rows, row]);
  }

  unregister(row: GridRow): void {
    this.#rows.update((rows) => rows.filter((each) => each !== row));
  }

  protected focusIn(event: FocusEvent): void {
    const element = event.target as HTMLElement;
    const rows = this.rows();
    const at = rows.findIndex((row) => row.element.contains(element));
    if (at < 0) return;
    this.#last.set(rows[at]);
    this.#focus = { element, at };
  }

  /** Focus gone elsewhere — not a row gone from under it, which leaves
      for nowhere. */
  protected focusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && !this.#host.contains(next)) this.#focus = null;
  }

  protected key(event: KeyboardEvent): void {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement;
    const rows = this.rows();
    const at = rows.findIndex((row) => row.element.contains(target));
    if (at < 0) return;
    const row = rows[at];
    const onRow = target === row.element;
    const stops = [
      row.element,
      ...row
        .widgets()
        .filter((widget) => widget.shown)
        .map((widget) => widget.target),
    ];
    // Anywhere else in the row (its link, clicked) counts as the row.
    const here = Math.max(0, stops.indexOf(target));
    const forward = this.#dir?.value === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';

    let next: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = rows[at + 1]?.element;
        break;
      case 'ArrowUp':
        next = rows[at - 1]?.element;
        break;
      case 'Home':
        next = onRow ? rows[0]?.element : stops[1];
        break;
      case 'End':
        next = onRow ? rows.at(-1)?.element : stops.at(-1);
        break;
      case forward:
        next = stops[here + 1];
        break;
      case back:
        next = stops[here - 1];
        break;
      case 'Escape':
        if (onRow) return;
        next = row.element;
        break;
      case 'Enter':
        if (!onRow) return;
        row.activate.emit(event);
        event.preventDefault();
        return;
      case ' ':
        if (!onRow || !this.multi()) return;
        row.selected.update((selected) => !selected);
        event.preventDefault();
        return;
      case 'Tab':
        // From the row, the browser's own Tab goes on past the grid: every
        // other stop in it is -1 — but the hover bar's, while shown, which
        // the browser walks as the page's order has them.
        if (!onRow && target.tabIndex < 0) row.element.focus();
        return;
      default:
        return;
    }
    // Handled even at an end: the arrows never scroll the list instead.
    event.preventDefault();
    next?.focus();
  }
}
