import {
  Component,
  Directive,
  ElementRef,
  HostAttributeToken,
  InjectionToken,
  Signal,
  booleanAttribute,
  computed,
  forwardRef,
  inject,
  input,
} from '@angular/core';

/** What an item needs of the group it stands in — `hk-tgb` provides it, so
    an item finds its group without importing it. */
export interface ToggleButtonGroupHost<T = unknown> {
  readonly value: Signal<T>;
  readonly disabled: Signal<boolean>;
  readonly tabStop: Signal<ToggleButtonGroupItem<T> | undefined>;
  select(value: T): void;
}

export const TOGGLE_BUTTON_GROUP = new InjectionToken<ToggleButtonGroupHost>('ToggleButtonGroup');

/**
 * What every choice of an `hk-tgb` is, whichever shape it wears — the
 * group finds its items by this class. Use one of the shapes:
 * `hkTgbIcon` (round) or `hkTgbText` (a pill).
 *
 * An item makes its element — a `<button>`, an `<a>`, anything — a `radio`
 * that carries a `value` and is `aria-checked` while the group holds it.
 * The element and its content stay the host's: a font icon, a `mat-icon`,
 * an SVG, a word. A click picks it, and Space and Enter do too (the
 * group's keys), so a `<div>` works as well as a button. A `<button>`
 * without a `type` gets `type="button"`, so an item in a form never
 * submits it. `aria-disabled` takes it out of the choices and the arrow
 * keys' way — it stays in the track, so the others keep their places —
 * and stops a disabled link from being followed.
 */
@Directive({
  host: {
    role: 'radio',
    '[attr.type]': 'type',
    '[attr.aria-checked]': 'checked()',
    '[attr.aria-disabled]': 'blocked() || null',
    '[tabIndex]': 'group.tabStop() === this ? 0 : -1',
    '(click)': 'onClick($event)',
  },
})
export abstract class ToggleButtonGroupItem<T = unknown> {
  /** What the group's value is while this item is picked. */
  readonly value = input.required<T>();

  /** This one can't be picked. */
  readonly disabled = input(false, { alias: 'aria-disabled', transform: booleanAttribute });

  protected readonly group = inject(TOGGLE_BUTTON_GROUP) as ToggleButtonGroupHost<T>;

  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** `button` for a `<button>` the host gave no type; the host's own type
      otherwise, and none on any other element. */
  protected readonly type =
    this.element.tagName === 'BUTTON'
      ? (inject(new HostAttributeToken('type'), { optional: true }) ?? 'button')
      : null;

  /** The group holds this item's value. */
  readonly checked = computed(() => this.group.value() === this.value());

  /** Out of the choices: its own `aria-disabled`, or the group's. */
  readonly blocked = computed(() => this.disabled() || this.group.disabled());

  focus(options?: FocusOptions): void {
    this.element.focus(options);
  }

  protected onClick(event: MouseEvent): void {
    if (this.blocked()) {
      event.preventDefault();
      return;
    }
    this.group.select(this.value());
  }
}

/**
 * A round choice holding an icon: a circle as wide as the track is tall
 * (`--hk-tgb-size`). The icon sits in a box of the item's own
 * (`[data-slot=icon]`, `--hk-tgb-icon-size`), whose font size and colour it
 * takes: a `mat-icon` marked `inline`, a font icon's `<i>`, or an SVG sized
 * `1em` fits with no rule of the host's. It has no words, so name it:
 * `aria-label` (and a `title` for a tooltip).
 *
 * ```html
 * <button hkTgbIcon value="light" aria-label="Light"><mat-icon inline>light_mode</mat-icon></button>
 * ```
 *
 * A component on the host's element, not a directive: it brings its own
 * encapsulated look (`:host`), which nothing outside could give an element
 * the host wrote.
 */
@Component({
  selector: '[hkTgbIcon]',
  exportAs: 'hkTgbIcon',
  templateUrl: './toggle-button-group-icon.html',
  styleUrls: ['./toggle-button-group-item.scss', './toggle-button-group-icon.scss'],
  providers: [
    { provide: ToggleButtonGroupItem, useExisting: forwardRef(() => ToggleButtonGroupIcon) },
  ],
})
export class ToggleButtonGroupIcon<T = unknown> extends ToggleButtonGroupItem<T> {}

/**
 * A pill-shaped choice holding words — as wide as its text, padded by
 * `--hk-tgb-padding`.
 *
 * ```html
 * <button hkTgbText value="auto">Auto</button>
 * ```
 */
@Component({
  selector: '[hkTgbText]',
  exportAs: 'hkTgbText',
  templateUrl: './toggle-button-group-text.html',
  styleUrls: ['./toggle-button-group-item.scss', './toggle-button-group-text.scss'],
  providers: [
    { provide: ToggleButtonGroupItem, useExisting: forwardRef(() => ToggleButtonGroupText) },
  ],
})
export class ToggleButtonGroupText<T = unknown> extends ToggleButtonGroupItem<T> {}
