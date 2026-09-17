import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  TemplateRef,
  booleanAttribute,
  computed,
  contentChild,
  inject,
  input,
  numberAttribute,
  output,
  signal,
} from '@angular/core';
import { isEmailAddress, parseMailbox } from './address';
import { AddressChipRemove, AddressChipRemoveContext } from './address-chip.slots';

/** The copy command, on a throwaway selection: the fallback for a clipboard
    API that refuses. True when the browser reports the copy done. */
function copyWithCommand(text: string): boolean {
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  scratch.style.position = 'fixed';
  scratch.style.top = '-1000px';
  document.body.append(scratch);
  scratch.select();
  let done = false;
  try {
    done = document.execCommand('copy');
  } catch {
    done = false;
  }
  scratch.remove();
  return done;
}

/**
 * One address as a chip, the way Gmail draws it: the display name when the
 * mailbox has one, the address otherwise, and the whole header form in the
 * title. An address that is not one is flagged, not refused — the user
 * sees the typo, the host decides what to do about it.
 *
 * **Parts are `data-slot`s** — `name`, `note`, `trailing`, `remove` — and
 * that is how it is styled from outside: theme it through the `--email-*` tokens, and reach
 * a part for a structural override with two attributes
 * (`[email-address-chip] [data-slot='name'][data-slot]`).
 *
 * **State on the host.** `data-invalid` marks a malformed address (a list
 * item may not carry `aria-invalid`; the flag is spoken through the `note`
 * slot instead). `aria-disabled` takes the remove button out of play, and
 * `aria-current` marks the chip a list's keys act on; each is an input under
 * its ARIA name, reflected back, and a styling hook too.
 *
 * **The remove control is a template slot.** The chip draws its own ×
 * button by default; an `ng-template[emailAddressChipRemove]` in the chip's
 * content — or handed down as `removeTemplate` by the address input —
 * replaces it, rendered in the `trailing` box with the address, the
 * accessible name, the disabled state and a `remove()` to call.
 *
 * **Hold to copy.** A press held on the chip for the length of a phone's
 * touch-and-hold — 500ms, `holdDelay` — copies the address, in header form,
 * to the clipboard, mouse or touch alike; a release or a drag before that
 * does not, and the browser's own context menu stays away. The chip shows
 * and says "Copied" for a moment (`data-copied`, a live `status` slot) and
 * emits `copied`.
 *
 * **It asks, it does not do.** The chip holds no list: `removed` is a
 * request the host answers by dropping the address. The address input
 * renders these for its value; a host can render them on its own for a
 * read-only header (a sent copy, a preview).
 *
 * Meant for an `<li>`. No Material, no icon font, no headless library.
 */
@Component({
  selector: '[email-address-chip]',
  imports: [NgTemplateOutlet],
  templateUrl: './address-chip.html',
  styleUrl: './address-chip.scss',
  host: {
    '[attr.data-invalid]': 'valid() ? null : true',
    '[attr.aria-disabled]': 'ariaDisabled() || null',
    '[attr.data-inline]': 'inline() || null',
    '[attr.aria-current]': 'ariaCurrent() || null',
    '[attr.data-copied]': 'justCopied() || null',
    '[title]': 'title()',
    '(pointerdown)': 'onPointerdown($event)',
    '(pointermove)': 'onPointermove($event)',
    '(pointerup)': 'cancelHold()',
    '(pointercancel)': 'cancelHold()',
    '(pointerleave)': 'cancelHold()',
    '(contextmenu)': 'onContextmenu($event)',
  },
})
export class AddressChip {
  /** The mailbox in header form: `Ada <ada@example.com>` or `ada@example.com`. */
  readonly address = input.required<string>();

  /** Set false for a read-only list: the chip stays, the remove button goes. */
  readonly removable = input(true, { transform: booleanAttribute });

  /** Draw the address as text in a line, not as a chip: no surface, no
      room after the address, and the remove control out of the flow and out
      of sight — still focusable, so the keyboard reaches it and a list can
      turn back into chips when it does. The address input sets it while it
      is not focused. Reflected as `data-inline`. */
  readonly inline = input(false, { transform: booleanAttribute });

  /** The list's highlight is on this chip: the one the arrow keys reached,
      or a click picked, while the caret stays in the list's input. An input
      under its ARIA name, like `aria-disabled`, reflected back as
      `aria-current="true"` — the list names the same chip in its input's
      `aria-activedescendant` — and drawn as a focus ring. */
  readonly ariaCurrent = input(false, { transform: booleanAttribute, alias: 'aria-current' });

  /** Whether the remove button is in the tab order. A list that reaches
      its chips with the arrow keys sets false: Tab goes straight to its
      input, and the button stays clickable and focusable by script. */
  readonly removeTabbable = input(true, { transform: booleanAttribute });

  /** Prefix for the remove button's accessible name — "Remove ada@example.com". */
  readonly removeLabel = input('Remove');

  /** What the flag on a malformed address says, for the title and for
      assistive tech. */
  readonly invalidLabel = input('not an email address');

  /** The remove button is out of play — e.g. while the message sends. */
  readonly ariaDisabled = input(false, { alias: 'aria-disabled', transform: booleanAttribute });

  /** The remove button was pressed. The host drops the address; the chip
      goes when the host's list no longer has it. */
  readonly removed = output<void>();

  /** How long a press must be held to copy the address, in milliseconds:
      the length of a phone's touch-and-hold, 500ms, so the gesture is the
      one a thumb already knows. 0 turns the hold off. */
  readonly holdDelay = input(500, { transform: numberAttribute });

  /** What the chip says, for a moment, once a hold has copied the address
      — "Copied", followed by the address. */
  readonly copiedLabel = input('Copied');

  /** A hold copied the address to the clipboard, in header form. */
  readonly copied = output<string>();

  /** The address was just copied: shown for a moment, and said. Reflected
      as `data-copied`. */
  protected readonly justCopied = signal(false);

  #hold: {
    id: number | undefined;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  #copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.cancelHold();
      clearTimeout(this.#copiedTimer);
    });
  }

  /** A press begins a hold — a primary pointer, mouse or touch alike, on
      the chip itself and not its remove control. */
  protected onPointerdown(event: PointerEvent): void {
    if (event.button !== 0 || event.isPrimary === false || !this.holdDelay()) return;
    if ((event.target as Element | null)?.closest('[data-slot=trailing]')) return;
    this.cancelHold();
    this.#hold = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => void this.copy(), this.holdDelay()),
    };
  }

  /** A hold that moves is a drag or a scroll, not a hold. */
  protected onPointermove(event: PointerEvent): void {
    const hold = this.#hold;
    if (!hold || (event.pointerId ?? hold.id) !== hold.id) return;
    if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10) this.cancelHold();
  }

  /** Released, cancelled or gone before the time: no copy. */
  protected cancelHold(): void {
    if (!this.#hold) return;
    clearTimeout(this.#hold.timer);
    this.#hold = null;
  }

  /** The hold is the chip's, not the browser's: no context menu on it, on
      a phone or under a right button. */
  protected onContextmenu(event: Event): void {
    if (this.#hold || this.justCopied()) event.preventDefault();
  }

  /** Writes the address to the clipboard: the async API first, and when
      it refuses — an unfocused document, a context without it — the old
      copy command on a selection made for the purpose. */
  /** Copies the address, in header form, to the clipboard — what a hold
      does, and what a host's own control may ask for — and shows and says
      so. The async API first; when it refuses (an unfocused document, a
      context without it), the old copy command on a selection made for the
      purpose. Resolves to whether the copy went. */
  async copy(): Promise<boolean> {
    this.#hold = null;
    const text = this.address();
    if (!document.hasFocus()) window.focus();
    const modern = navigator.clipboard
      ? navigator.clipboard.writeText(text).then(() => true)
      : Promise.resolve(false);
    const done = (await modern.catch(() => false)) || copyWithCommand(text);
    if (!done) return false;
    this.justCopied.set(true);
    this.copied.emit(text);
    clearTimeout(this.#copiedTimer);
    this.#copiedTimer = setTimeout(() => this.justCopied.set(false), 1500);
    return true;
  }

  /** A remove template handed down by a list that renders the chip — the
      address input passes its own `emailAddressChipRemove` slot here. One
      in the chip's own content wins. */
  readonly removeTemplate = input<TemplateRef<AddressChipRemoveContext> | null>(null);

  protected readonly removeSlot = contentChild(AddressChipRemove);

  /** The template the trailing box renders, or null for the default button. */
  protected readonly removeOutlet = computed(
    () => this.removeSlot()?.template ?? this.removeTemplate(),
  );

  protected readonly mailbox = computed(() => parseMailbox(this.address()));

  /** Whether the address part is well-formed. Public so a list can count. */
  readonly valid = computed(() => isEmailAddress(this.mailbox().address));

  /** The remove control's accessible name — "Remove ada@example.com". */
  protected readonly removeName = computed(() => `${this.removeLabel()} ${this.address()}`);

  protected readonly removeContext = computed<AddressChipRemoveContext>(() => ({
    $implicit: this.address(),
    mailbox: this.mailbox(),
    valid: this.valid(),
    disabled: this.ariaDisabled(),
    tabbable: this.removeTabbable(),
    label: this.removeName(),
    remove: this.remove,
  }));

  /** Asks to be removed, unless the control is out of play. One function
      for the chip's life, so a template holding it never sees it change. */
  protected readonly remove = (): void => {
    if (!this.ariaDisabled()) this.removed.emit();
  };

  protected readonly title = computed(() =>
    this.valid() ? this.address() : `${this.address()} — ${this.invalidLabel()}`,
  );
}
