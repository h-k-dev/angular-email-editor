import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  forwardRef,
  inject,
  input,
  model,
  output,
  untracked,
} from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { TOGGLE_BUTTON_GROUP, ToggleButtonGroupItem } from './toggle-button-group-item';

/** The picked item's box, in the group's own coordinates. */
interface ThumbBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A toggle button group: one of a few choices on a track, the picked one
 * under a thumb that slides — and changes shape — to whichever is picked
 * next. The pricing page's Monthly | Yearly; a theme's ☀ | ☾ | Auto.
 *
 * ```html
 * <hk-tgb aria-label="Appearance" [(value)]="appearance">
 *   <button hkTgbIcon value="light" aria-label="Light"><i class="icon-sun"></i></button>
 *   <a hkTgbIcon value="dark" aria-label="Dark" href="?theme=dark"><mat-icon inline>dark_mode</mat-icon></a>
 *   <button hkTgbText value="auto">Auto</button>
 * </hk-tgb>
 * ```
 *
 * **The group is the control; the items are the host's own elements.** Any
 * element becomes a choice by wearing one of two attributes — `hkTgbIcon`,
 * a circle around an icon, or `hkTgbText`, a pill around words — and
 * registers by being content, so the host writes the items as it would
 * plain buttons or links. A pick is all a click does: a group inside a
 * menu leaves the menu open.
 *
 * **A signal-forms control, optionally.** It implements `FormValueControl`:
 * bind a field with `[formField]="settings.theme"` and the directive drives
 * `value` both ways, pushes `disabled`, `readonly`, `required`, `invalid`
 * and `touched` in, and hears `touch` when focus leaves the group. Without
 * a form, `[(value)]` alone is the whole contract. The value is whatever
 * the items carry — strings, an enum, objects — matched by identity; a
 * value no item carries picks none.
 *
 * **Radio semantics.** The group is a `radiogroup`, each item a `radio`
 * with `aria-checked`, and one tab stop: the picked item (the first
 * enabled one while none is). The arrow keys of the group's `orientation`
 * move the pick — Left and Right across, mirrored right to left; Up and
 * Down down a vertical group — Home and End go to the ends, Space and
 * Enter pick in place. The arrows across the other way are left alone for
 * whatever the group sits in: a vertical menu moves on with them. A key
 * the group acted on is spent: it does not travel on to a menu or toolbar
 * around it, whose Space or Enter would act a second time.
 *
 * **The thumb follows the picked item's box.** Items differ in size — a
 * circle, a pill as wide as its words — so the group reads the picked
 * item's box once per pick, and again only when an item resizes (a font
 * arriving, a language switched); the thumb slides there by CSS, its size
 * and corner easing from one shape to the other, and stands still for
 * reduced motion. It takes its first place without sliding.
 *
 * **Each part styles itself, encapsulated.** The group draws the track
 * and the thumb; each item is a component on the host's element and brings
 * its shape with it, so nothing reaches past an encapsulation boundary.
 * Every look is a `--hk-tgb-*` token, defaulting to Material's system
 * tokens, then a light-dark() pair.
 *
 * **State on the host:** `aria-disabled`, `aria-readonly`,
 * `aria-required`, `aria-invalid` (invalid *and* touched, so nothing
 * shouts early), `data-orientation`, and `data-empty` while nothing is
 * picked. No Material, no icon font, no headless library.
 */
@Component({
  selector: 'hk-tgb',
  templateUrl: './toggle-button-group.html',
  styleUrl: './toggle-button-group.scss',
  providers: [{ provide: TOGGLE_BUTTON_GROUP, useExisting: forwardRef(() => ToggleButtonGroup) }],
  host: {
    role: 'radiogroup',
    '[attr.aria-orientation]': 'orientation()',
    '[attr.data-orientation]': 'orientation()',
    '[attr.aria-disabled]': 'disabled() || null',
    '[attr.aria-readonly]': 'readonly() || null',
    '[attr.aria-required]': 'required() || null',
    '[attr.aria-invalid]': '(invalid() && touched()) || null',
    '[attr.data-empty]': '!picked() || null',
    '(keydown)': 'onKeydown($event)',
    '(focusout)': 'onFocusout($event)',
  },
})
export class ToggleButtonGroup<T = unknown> implements FormValueControl<T> {
  /** The picked item's value. Two-way; the form's value. */
  readonly value = model.required<T>();

  /** Which way the items line up, and so which arrow keys are the
      group's. */
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');

  // ── the form contract: pushed in by the field directive ───────────────

  readonly disabled = input(false, { transform: booleanAttribute });
  /** The pick holds: the items can be reached and read, not changed. */
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly required = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly touched = input(false, { transform: booleanAttribute });

  /** Focus left the group. The directive marks the field touched on it. */
  readonly touch = output<void>();

  /** The items, in the order they stand. */
  protected readonly items = contentChildren<ToggleButtonGroupItem<T>>(ToggleButtonGroupItem, {
    descendants: true,
  });

  /** The item the group's value picks, if any. */
  protected readonly picked = computed(() => this.items().find((item) => item.checked()));

  /** The one item Tab lands on: the picked one, else the first that can be
      picked — none while every one is disabled. */
  readonly tabStop = computed(() => {
    const enabled = this.items().filter((item) => !item.blocked());
    return enabled.find((item) => item.checked()) ?? enabled[0];
  });

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    this.#watchSizes();
    afterRenderEffect({
      earlyRead: () => this.#measure(this.picked()),
      write: (box) => this.#place(box()),
    });
  }

  /** Picks a value — an item's click, a key. A no-op while disabled or
      read-only. */
  select(value: T): void {
    if (this.disabled() || this.readonly()) return;
    this.value.set(value);
  }

  /** Puts focus on the group's tab stop. */
  focus(options?: FocusOptions): void {
    this.tabStop()?.focus(options);
  }

  /** The picked item's box, if any — read in layout. None while the group
      is out of sight (`display: none`, a closed dialog): its box is no
      place, and the thumb keeps the last one until it shows. */
  #measure(picked: ToggleButtonGroupItem<T> | undefined): ThumbBox | null {
    const element = picked?.element;
    return element?.offsetWidth
      ? {
          x: element.offsetLeft,
          y: element.offsetTop,
          width: element.offsetWidth,
          height: element.offsetHeight,
        }
      : null;
  }

  /** Stands the thumb on the picked box. The first place is taken without
      sliding: `data-placed` turns the motion on only after it. Nothing
      picked keeps the last place, so the thumb fades out where it stood. */
  #place(box: ThumbBox | null): void {
    if (!box) return;
    const style = this.#host.style;
    style.setProperty('--hk-tgb-thumb-x', `${box.x}px`);
    style.setProperty('--hk-tgb-thumb-y', `${box.y}px`);
    style.setProperty('--hk-tgb-thumb-width', `${box.width}px`);
    style.setProperty('--hk-tgb-thumb-height', `${box.height}px`);
    if (!this.#host.hasAttribute('data-placed') && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.#host.setAttribute('data-placed', ''));
    }
  }

  /** Watches the group and its items for size changes — the only thing
      besides a pick that moves the picked box — and places the thumb then
      and there: a resize is no render (a group shown out of
      `display: none`, a font loading), so nothing else would read the box
      again. The observer reports after layout: the read forces none. */
  #watchSizes(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() =>
      this.#place(this.#measure(untracked(this.picked))),
    );
    inject(DestroyRef).onDestroy(() => observer.disconnect());
    effect((onCleanup) => {
      observer.observe(this.#host);
      const items = this.items().map((item) => item.element);
      for (const element of items) observer.observe(element);
      onCleanup(() => {
        observer.unobserve(this.#host);
        for (const element of items) observer.unobserve(element);
      });
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const items = this.items().filter((item) => !item.blocked());
    const current = items.findIndex((item) => item.element === event.target);
    if (current < 0) return;

    const target = this.#target(event, current, items.length);
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const item = items[target];
    item.focus();
    this.select(item.value());
  }

  /** The index a key moves to, or `undefined` for a key that is not the
      group's. Space and Enter pick the item in place — a button's own
      click would too, but a menu around it hears the keydown first. */
  #target(event: KeyboardEvent, current: number, count: number): number | undefined {
    const vertical = this.orientation() === 'vertical';
    const rtl = !vertical && getComputedStyle(this.#host).direction === 'rtl';
    const step = (by: number) => (current + by + count) % count;
    switch (event.key) {
      case ' ':
      case 'Enter':
        return current;
      case 'Home':
        return 0;
      case 'End':
        return count - 1;
      case 'ArrowLeft':
        return vertical ? undefined : step(rtl ? 1 : -1);
      case 'ArrowRight':
        return vertical ? undefined : step(rtl ? -1 : 1);
      case 'ArrowUp':
        return vertical ? step(-1) : undefined;
      case 'ArrowDown':
        return vertical ? step(1) : undefined;
      default:
        return undefined;
    }
  }

  protected onFocusout(event: FocusEvent): void {
    if (!this.#host.contains(event.relatedTarget as Node | null)) this.touch.emit();
  }
}
