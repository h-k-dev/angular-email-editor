import {
  Component,
  Directive,
  ElementRef,
  inject,

  // Signals
  computed,
  contentChildren,
  forwardRef,
  input,
  model,
  output,
} from '@angular/core';

/** The three chip looks in the app — see the stylesheet for what each paints. */
export type ChipVariant = 'filled' | 'quiet' | 'outlined';

/**
 * THE chip — every chip in the app wears this, on whatever element it needs
 * to be: `<a chip routerLink>`, `<button chip role="radio">`,
 * `<div chip>` around a composite tab. A component with an ATTRIBUTE
 * selector (the `button[mat-button]` idea), so it carries its own stylesheet:
 * compiled once for the component, however many surfaces wear it — unlike a
 * shared partial `@use`d per consumer, which lands a copy in every chunk.
 *
 * Slots, in order:
 *   `[chipLead]`    a leading icon / favicon
 *   `[chipAction]`  the chip's own action when the chip is COMPOSITE — a
 *                    tab button beside a ✕ or a picker (see `ChipAction`)
 *   default          plain label text, wrapped in the ellipsising label box
 *                    (collapses when empty, so an action-only chip has no gap)
 *   `[chipTrail]`   a count, a picker caret
 *   `[chipDismiss]` OPT-IN browser-tab behaviour (see `ChipDismiss`): a ✕
 *                    floating over the chip's end, shown on hover / when
 *                    active; the label then reserves that end and FADES
 *                    instead of ellipsising, so only a name clipped at the
 *                    max size ever sits under the ✕
 *
 * Projected nodes keep the DECLARING component's scoping, so a consumer styles
 * what it puts in a slot itself; this component styles the chip box and the
 * label box only.
 *
 * SELECTION IS ARIA, never a class: the chip reads as active from the state
 * the element already announces — `aria-selected` (tab), `aria-checked`
 * (radio), `aria-pressed` (toggle), `aria-current` (router link, via
 * `routerLinkActive` + `ariaCurrentWhenActive="page"`), or, on a composite
 * chip, its inner `[role=tab][aria-selected=true]`. What a screen reader
 * hears and what the eye sees cannot drift apart.
 *
 * Every look is a CSS variable, never declared by this component, so a
 * consumer may set it on the chip itself OR on any ancestor — whatever the
 * variant:
 *
 *   box      --chip-height, --chip-padding-inline, --chip-gap, --chip-radius,
 *            --chip-border-width, --chip-max-inline-size, --chip-min-inline-size
 *   focus    --chip-focus-color, --chip-focus-width, --chip-focus-offset
 *   type     --chip-font-size, --chip-font-weight, --chip-line-height,
 *            --chip-letter-spacing
 *   resting  --chip-bg, --chip-color, --chip-border-color
 *   hover    --chip-hover-bg, --chip-hover-color, --chip-hover-border-color
 *   active   --chip-active-bg, --chip-active-color, --chip-active-border-color
 *   dismiss  --chip-dismiss-size, --chip-dismiss-gap, --chip-dismiss-fade,
 *            --chip-dismiss-icon-size, --chip-dismiss-hover-bg
 *
 * Each resolves in three tiers: the knob → the Material system token
 * (`--mat-sys-*`, the variant picks WHICH one) → a literal, the app's
 * light-theme value, so the chip still paints where no theme is loaded. The
 * knobs stay `--chip-*` on purpose: `--mat-sys-*` is Material's namespace.
 */
@Component({
  selector: '[chip]',
  templateUrl: './chip.html',
  styleUrl: './chip.scss',
  host: {
    class: 'm-chip',
    '[attr.data-variant]': 'variant()',
  },
})
export class Chip {
  variant = input<ChipVariant>('quiet');
}

/**
 * The keyboard both chip controllers share: where Arrow/Home/End moves from
 * `index` among `total` chips, wrapping at both ends — `null` for any other
 * key (or no chips), so the caller lets the event through untouched. Indexes
 * are recomputed per keystroke rather than tracked, so chips appearing or
 * leaving can never leave a stale one. What happens AT the new index is the
 * controller's own: the cloud selects it, the set only focuses it.
 */
function chipKeyStep(key: string, index: number, total: number): number | null {
  if (index === -1 || total === 0) return null;

  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % total;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + total) % total;
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
}

/**
 * The CONTROLLER of a single-select chip row — the YouTube chip-cloud
 * pattern, minus any markup or paint. The row is `m-overflow-row` (scroll,
 * paddles), each chip is `m-chip` (look, selected state off `aria-checked`);
 * this pair owns only the value and the keyboard:
 *
 * ```html
 * <m-overflow-row chipCloud [(value)]="scope" rowRole="radiogroup" [rowLabel]="…">
 *   @for (option of options(); track option.value) {
 *     <button chip type="button" [chipCloudOption]="option.value">{{ option.label }}</button>
 *   }
 * </m-overflow-row>
 * ```
 *
 * The group ROLE is the row's, not this directive's: `m-overflow-row` puts it
 * on its inner flex row (`rowRole`), so the radios are that group's direct
 * children. On a plain container, put `role="radiogroup"` there yourself.
 *
 * Semantics are a RADIOGROUP, not a tablist: the chips narrow what a list
 * shows, they do not switch tabpanels, and exactly one is always on. Roving
 * tabindex — Tab enters the group on the selected chip, arrows move AND select
 * (selection follows focus, per the APG radio pattern), so there is exactly one
 * tab stop however many chips exist.
 *
 * The single tab stop is the POINT, not an oversight: a cloud is allowed to
 * hold thirty chips, and thirty tab stops between the field and the results
 * would be a worse keyboard experience than one stop and an arrow key. It is
 * also what the role promises — both the APG pattern and native same-name
 * radios rove — so radios that Tab walked would announce "radio, 2 of 3" while
 * behaving like nothing of the sort.
 *
 * Only fits a one-of-many SCOPE. A row of router links keeps the router as its
 * controller (`aria-current`), and a tab row keeps `ngTabList` — both already
 * own selection and keyboard, and a second controller would fight them.
 *
 * LTR only, like `m-overflow-row`: ArrowRight is the NEXT chip.
 */
@Directive({
  selector: '[chipCloud]',
  exportAs: 'chipCloud',
})
export class ChipCloud {
  /**
   * The selected option's value. Two-way; exactly one chip is checked.
   *
   * Optional-with-default, not `model.required`: the options' host bindings
   * read it in the same pass that sets it, before a required input has landed
   * (NG0950). An empty value just means "none named" — the first chip then
   * takes the tab stop.
   */
  value = model<string>('');

  /** Every option, in DOM order — the order the arrows walk. */
  readonly options = contentChildren(
    forwardRef(() => ChipCloudOption),
    { descendants: true },
  );

  /**
   * The one chip Tab lands on: the selected one, or the first as a fallback so
   * the group never becomes unreachable when `value` names no option.
   */
  readonly tabbableValue = computed(() => {
    const values = this.options().map((option) => option.value());
    return values.includes(this.value()) ? this.value() : (values[0] ?? null);
  });

  /** Selects the option, focuses it and scrolls it into the row. */
  activate(option: ChipCloudOption): void {
    this.value.set(option.value());
    option.focus();
  }

  /** Arrows/Home/End from the focused option: move AND select, wrapping. */
  handleKeydown(event: KeyboardEvent, from: ChipCloudOption): void {
    const options = this.options();
    const next = chipKeyStep(event.key, options.indexOf(from), options.length);
    if (next === null) return;

    event.preventDefault();
    this.activate(options[next]);
  }
}

/**
 * One radio of an `chipCloud`, on the chip element itself
 * (`<button chip [chipCloudOption]="value">`). Stamps the radio role, the
 * checked state the chip paints from, and the roving tab stop.
 */
@Directive({
  selector: '[chipCloudOption]',
  host: {
    role: 'radio',
    '[attr.aria-checked]': 'checked()',
    '[tabIndex]': 'tabbable() ? 0 : -1',
    '(click)': 'cloud.activate(this)',
    '(keydown)': 'cloud.handleKeydown($event, this)',
  },
})
export class ChipCloudOption {
  protected readonly cloud = inject(ChipCloud);
  #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * The value this chip selects. Not `input.required`: the group reads EVERY
   * option's value (the roving tab stop) while later siblings are still being
   * bound, which a required input answers with NG0950.
   */
  value = input<string>('', { alias: 'chipCloudOption' });

  protected readonly checked = computed(() => this.cloud.value() === this.value());
  protected readonly tabbable = computed(() => this.cloud.tabbableValue() === this.value());

  focus(): void {
    const chip = this.#host.nativeElement;
    chip.focus();
    // 'nearest' plus `m-overflow-row`'s `scroll-padding-inline` lands the chip
    // clear of both the paddle and the fade beside it, instead of tucked under
    // one of them.
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/**
 * The CONTROLLER of a wrapping set of MULTI-select filter chips — the
 * many-of-many sibling to `chipCloud`. Each chip toggles its own value;
 * Ctrl/⌘-click narrows the whole set to just that one, the exclusive
 * counterpart to the additive plain click. No markup or paint: the consumer
 * lays the set out, each chip is `m-chip` (filled — `aria-pressed` IS its
 * selected look).
 *
 * ```html
 * <div chipSet role="group" [attr.aria-label]="…" [selected]="values"
 *      (toggled)="toggle($event)" (soloed)="selectOnly($event)">
 *   @for (option of options; track option.value) {
 *     <button chip variant="filled" type="button" [chipSetOption]="option.value">…</button>
 *   }
 * </div>
 * ```
 *
 * **Why not `mat-chip-listbox`.** Three walls, all structural rather than
 * styling taste:
 * 1. `MatChipOption.ngOnInit()` hard-assigns `role = 'presentation'` to the
 *    host and puts `role="option"` on its inner primary action.
 * 2. `_hasLeadingGraphic()` returns true whenever the parent listbox is
 *    `multiple`, so the selection checkmark cannot be turned off through the
 *    API — the previous filter panel hid it with `::ng-deep !important`, and
 *    then had to patch the padding it left behind the same way.
 * 3. The selected fill is an MDC token wired to the theme's primary; recolouring
 *    it needed two more `::ng-deep !important` rules.
 * Five overrides fighting the component is the signal to own the primitive.
 *
 * **Semantics** are a group of TOGGLE BUTTONS (`role="group"` on the
 * container + per-chip `aria-pressed`), not a listbox: multiple chips are on at
 * once.
 *
 * **Keyboard**: every chip is a tab stop (user decision — Tab walks the whole
 * set; the earlier one-stop roving model stranded Tab on the last clicked
 * chip). Arrows walk the chips too, as a fast lane, and Home/End jump to the
 * ends — the same step as the cloud, but moving FOCUS only, never the value.
 *
 * **Exclusive pick is Ctrl/⌘-click ONLY** (user decision, 2026-08-30). There
 * used to be a trailing "only" button per chip; it is gone. The consequence:
 * the exclusive action has NO keyboard path — see the global-search filter's
 * NOTES.md.
 *
 * **State stays with the host**: `selected` in, intents out. The filter's
 * selection lives in a service and comes back as derived rows, so a `model`
 * here would duplicate it and open a divergence window — the same split as
 * `m-result-list` (`activeIndex` in, intents out).
 */
@Directive({
  selector: '[chipSet]',
  exportAs: 'chipSet',
})
export class ChipSet {
  /** Values currently on. The HOST owns this state — see `toggled`/`soloed`. */
  selected = input<readonly string[]>([]);

  /** Chip activated — the host flips that one value. */
  toggled = output<string>();

  /** Ctrl/⌘-click — the host narrows the set to exactly this value. */
  soloed = output<string>();

  /** Every option, in DOM order — the order the arrows walk. */
  readonly options = contentChildren(
    forwardRef(() => ChipSetOption),
    { descendants: true },
  );

  /**
   * Ctrl/⌘-click solos, plain click toggles — one handler, two intents. On
   * macOS only ⌘ reaches here: the OS turns Ctrl+click into a secondary click.
   */
  handleClick(event: MouseEvent, option: ChipSetOption): void {
    if (event.ctrlKey || event.metaKey) this.soloed.emit(option.value());
    else this.toggled.emit(option.value());
  }

  /** Arrows/Home/End from the focused option: move FOCUS only, wrapping. */
  handleKeydown(event: KeyboardEvent, from: ChipSetOption): void {
    const options = this.options();
    const next = chipKeyStep(event.key, options.indexOf(from), options.length);
    if (next === null) return;

    event.preventDefault();
    options[next].focus();
  }
}

/**
 * One toggle of an `chipSet`, on the chip element itself
 * (`<button chip variant="filled" [chipSetOption]="value">`). Stamps the
 * pressed state the chip paints from; the chip stays a native tab stop.
 */
@Directive({
  selector: '[chipSetOption]',
  host: {
    '[attr.aria-pressed]': 'pressed()',
    '(click)': 'set.handleClick($event, this)',
    '(keydown)': 'set.handleKeydown($event, this)',
  },
})
export class ChipSetOption {
  protected readonly set = inject(ChipSet);
  #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The value this chip toggles. Not `input.required` — see `ChipCloudOption.value`. */
  value = input<string>('', { alias: 'chipSetOption' });

  protected readonly pressed = computed(() => this.set.selected().includes(this.value()));

  focus(): void {
    this.#host.nativeElement.focus();
  }
}
