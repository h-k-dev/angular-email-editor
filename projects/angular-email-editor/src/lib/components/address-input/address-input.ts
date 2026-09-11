import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  inject,

  // Signals
  booleanAttribute,
  computed,
  contentChild,
  input,
  model,
  numberAttribute,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { isMailbox, splitAddresses } from '../address-chip/address';
import { AddressChip } from '../address-chip/address-chip';
import { AddressChipRemove } from '../address-chip/address-chip.slots';

let nextId = 0;

/**
 * An address field the way Gmail's works: committed addresses as chips,
 * free typing after them. Enter, comma, semicolon or a paste commits what
 * was typed; Backspace on the empty input takes the chip before the caret
 * back for editing; `limit` caps the count (From takes one) and hides the
 * input once reached.
 *
 * **Only an address becomes a chip while typing.** Enter, comma, semicolon,
 * Tab and a paste commit the addresses in what was typed and leave the rest —
 * what is not an address yet — in the input, flagged, for the user to
 * finish. Leaving the field commits everything, so the form sees the typo
 * and flags it; and focus coming back hands the malformed entries at the
 * end of the list straight back to the input, as plain typing again.
 *
 * **Editing is in place.** A chip taken back for editing does not move:
 * the input goes to where the chip was, holds its address, and what is
 * committed there — Enter, Tab, a comma — takes the chip's place, with the
 * chips after it staying after. The input stays in that place, so more can
 * be added there, until focus leaves; then it returns to the end. Leaving
 * with an address commits it in place; leaving with a typo commits the typo
 * at the end of the list, the pending error, where the next focus hands it
 * back.
 *
 * **One pending edit at a time.** There is only ever one thing being fixed,
 * and it is what the caret is on. Starting another edit — `edit()`, Enter
 * on a picked chip, Backspace taking the chip before the caret back — ends
 * the one pending: a typo left in the input and any chip that is not an
 * address go.
 *
 * **Chips while focused, a line of text otherwise.** With focus elsewhere
 * the addresses read as a comma-separated line — no surface, no buttons;
 * focus in the input turns them into chips.
 *
 * **The arrow keys rove the chips; the caret stays in the input.** With
 * the caret at the start of the typing, ← puts a highlight on the chip
 * before it and walks back along the list; from the end of the typing, →
 * reaches the chip after it and walks forward. Walking back onto the
 * caret's own place returns to the caret. Enter edits the highlighted chip,
 * Backspace or Delete removes it, Escape drops the highlight, and so does
 * typing. A click on a chip highlights it. Reaching a chip either way is
 * being done with the typing: an address in the input becomes a chip first,
 * as Enter would make it. The highlight is
 * `aria-activedescendant` on the input and `aria-current` on the chip, and the
 * chips' remove buttons stay out of the tab order — Tab lands on the input —
 * except when the field is full and has no input to land on.
 *
 * A display name is kept — `Ada Lovelace <ada@example.com>` is one chip
 * that shows "Ada Lovelace" — and the value stays `string[]` in header
 * form, ready for a `To:` line.
 *
 * **The control, not the row.** It owns no label and draws no row: the
 * template that holds the form puts it in a row of its own making, beside a
 * label of its own making, exactly as it does for a plain `<input>` — and
 * names the control through `aria-labelledby` (the label's id) or
 * `aria-label`, which land on the text input inside, the element assistive
 * tech reaches. Clicking anywhere on the control puts the caret in; a row
 * that wants its label to do the same calls `focus()`.
 *
 * **A signal-forms control, optionally.** It implements `FormValueControl`
 * for `string[]`: bind a field with `[formField]="envelope.to"` and the
 * directive drives `value` both ways, pushes `invalid`, `touched`,
 * `disabled`, `readonly`, `required` and `name` in, and hears `touch` when
 * focus leaves the input. Without a form, `[(value)]` alone is the whole
 * contract; the state inputs are optional and the chips still flag a
 * malformed address on their own. The rules that go with it — `addressList`
 * — live beside it, because the built-in `required` and `email` know
 * nothing of an array of mailboxes.
 *
 * **No messages of its own.** The control reflects the field's state —
 * invalid *and* touched, so nothing shouts before the user has left it —
 * and a malformed address is flagged on its chip; wording what is wrong is
 * the job of the component that owns the form, which has the errors.
 *
 * **Parts are `data-slot`s** — `chips`, `entry`, `input` — plus the chips'
 * own; that is how the control is styled from outside: theme it through
 * the `--email-*` tokens, and reach a part for a structural override with
 * two attributes.
 *
 * **The selection and its commands are public.** A host's own controls —
 * a bar over the writer, the way a phone's action bar sits over the app
 * bar — work the picked chip through `current()` and `select()` for the
 * state and `edit()`, `remove()` and `copy()` for the commands, each on the
 * current chip unless given another. Such a bar's buttons must decline
 * their mousedown (`(mousedown)="$event.preventDefault()"`): focus stays in
 * the input, and the selection with it — focus leaving the control clears
 * the selection.
 *
 * **The chips' remove control is a template slot.** An
 * `ng-template[emailAddressChipRemove]` in the input's content is handed to
 * every chip it renders, in place of the default × button.
 *
 * **State on the host.** `aria-disabled` while disabled; `data-invalid`
 * while invalid and touched; `data-full` once `limit` is reached;
 * `data-focused` while focus is anywhere in the control. The text input
 * carries `data-refused` while it holds text a commit left behind.
 *
 * No Material, no icon font, no headless library. It holds the list it
 * shows and nothing else: contacts, lookups and sending are the host's.
 */
@Component({
  selector: '[email-address-input]',
  imports: [AddressChip, NgTemplateOutlet],
  templateUrl: './address-input.html',
  styleUrl: './address-input.scss',
  host: {
    '[attr.aria-disabled]': 'disabled() || null',
    '[attr.data-invalid]': 'flagged() || null',
    '[attr.data-full]': 'full() || null',
    '[attr.data-focused]': 'focused() || null',
    '(pointerdown)': 'onPointerdown($event)',
    '(mousedown)': 'keepCaret($event)',
    '(click)': 'focus()',
    '(focusin)': 'focused.set(true)',
    '(focusout)': 'onFocusout($event)',
  },
})
export class AddressInput implements FormValueControl<string[]> {
  /** The committed addresses, in header form. Two-way; the form's value. */
  readonly value = model<string[]>([]);

  readonly placeholder = input('');

  /** The id of the row's label, passed through to the text input — the
      host's label, wherever the host put it. */
  readonly ariaLabelledby = input<string | null>(null, { alias: 'aria-labelledby' });

  /** A name for the text input when there is no visible label. */
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });

  /** Most addresses the field takes; the input hides once reached. Named
      `limit`, not `max`: the form contract keeps that name for the `max` rule. */
  readonly limit = input(Infinity, { transform: numberAttribute });

  /** Prefix for each chip's remove button — "Remove ada@example.com". */
  readonly removeLabel = input('Remove');

  /** What a malformed address is flagged as. */
  readonly invalidLabel = input('not an email address');

  // ── the form contract: pushed in by the field directive ───────────────

  /** The input's `name` attribute; the directive derives one from the path. */
  readonly name = input('');

  readonly disabled = input(false, { transform: booleanAttribute });
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly required = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly touched = input(false, { transform: booleanAttribute });

  /** Focus left the input. The directive marks the field touched on it. */
  readonly touch = output<void>();

  /** The text input's id, for a host label's `for`. */
  readonly id = `email-address-input-${nextId++}`;

  /** The host's remove template, passed on to every chip. */
  protected readonly removeSlot = contentChild(AddressChipRemove);

  protected readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Focus is somewhere in the control — the input or a chip's remove
      button. The chips are chips only then. */
  protected readonly focused = signal(false);

  /** The input holds text a commit left behind: not an address yet. */
  protected readonly refused = signal(false);

  /** Where the input sits among the chips while an edit is in place: the
      index the next committed address takes, the chips from there on
      standing after the input. Null is the end — where the input starts,
      and where it returns when focus leaves. */
  protected readonly editAt = signal<number | null>(null);

  /** The input's slot in the list: `editAt`, or after the last chip. */
  protected readonly entryAt = computed(() => {
    const editAt = this.editAt();
    const length = this.value().length;
    return editAt === null ? length : Math.min(editAt, length);
  });

  /** The chips before the input, and the chips after it. Two lists so the
      input's element never moves in the DOM — a focused element moved is
      a focused element blurred. */
  protected readonly before = computed(() => this.value().slice(0, this.entryAt()));
  protected readonly after = computed(() => this.value().slice(this.entryAt()));

  /** The chip the arrow keys or a click picked, by index in the value — the
      one Enter, Backspace and Delete act on while the caret stays in the
      input. */
  protected readonly active = signal<number | null>(null);

  /** The picked chip's address — the one the arrow keys or a click reached
      and the commands act on — or null. Public, for a host's own controls. */
  readonly current = computed<string | null>(() => {
    const index = this.active();
    return index === null ? null : (this.value()[index] ?? null);
  });

  /** Picks a chip by address, or none. */
  select(address: string | null): void {
    const index = address === null ? -1 : this.value().indexOf(address);
    this.active.set(index < 0 ? null : index);
  }

  /** The chips as rendered, for the commands that are the chip's own. */
  protected readonly chips = viewChildren(AddressChip);

  /** The active chip's id, for the input's `aria-activedescendant`. */
  protected readonly activeId = computed(() => {
    const index = this.active();
    return index !== null && index < this.value().length ? this.chipId(index) : null;
  });

  protected chipId(index: number): string {
    return `${this.id}-chip-${index}`;
  }

  /** The cap is reached: a further address is refused. */
  readonly full = computed(() => this.value().length >= this.limit());

  /** The malformed addresses at the end of the list — what focus hands back
      to the input. */
  readonly #trailingMalformed = computed(() => {
    const value = this.value();
    let start = value.length;
    while (start > 0 && !isMailbox(value[start - 1])) start--;
    return value.slice(start);
  });

  /** Full, and nothing in it to fix: the input hides — the chips say
      everything. A full list ending in a typo keeps it, so focus can hand
      the typo back. */
  protected readonly closed = computed(() => this.full() && !this.#trailingMalformed().length);

  /** Nothing may change: disabled or read-only. Chips lose their remove
      button, the input is out of play. */
  protected readonly locked = computed(() => this.disabled() || this.readonly());

  /** Invalid *and* touched — the moment the state becomes the user's business. */
  protected readonly flagged = computed(() => this.invalid() && this.touched());

  /** Splits a run into addresses and adds the new ones where the input is,
      up to `limit`. Duplicates are dropped; a malformed one is kept and
      flagged — this is the host's way in, and the host decides what it
      holds. */
  commit(raw: string): void {
    this.#insert(splitAddresses(raw));
  }

  /** Drops one address — the picked chip's by default. Identity by string:
      the list never holds the same header form twice, so this takes exactly
      the chip that asked. */
  remove(address: string | null = this.current()): void {
    if (this.locked() || address === null) return;
    this.active.set(null);
    const index = this.value().indexOf(address);
    if (index < 0) return;
    const editAt = this.editAt();
    if (editAt !== null && index < editAt) this.editAt.set(editAt - 1);
    this.value.update((current) => current.filter((a) => a !== address));
  }

  /** A chip's remove control was used: the address goes, and the caret
      comes back to the input — the focused button went with its chip, and
      focus left on nothing would strand a keyboard user and read to a host
      as the field being left. */
  protected removeChip(address: string): void {
    this.remove(address);
    this.focus();
  }

  /** Takes a chip — the picked one by default — back for editing, in its
      place: the input moves to where the chip was and holds its address,
      caret at the end. The edit pending until now ends first. A locked list
      edits nothing. */
  edit(
    address: string | null = this.current(),
    input: HTMLInputElement = this.field().nativeElement,
  ): void {
    if (this.locked() || address === null) return;
    this.active.set(null);
    this.#endPending(input, address);
    const index = this.value().indexOf(address);
    if (index < 0) return;
    this.remove(address);
    this.editAt.set(index);
    input.value = address;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** Ends the pending edit so another can start: the addresses typed so far
      become chips where the input is, the rest of the typing goes, and so
      does every chip that is not an address — but `keep`, the one about to
      be edited. */
  #endPending(input: HTMLInputElement, keep?: string): void {
    this.#insert(splitAddresses(input.value).filter((token) => isMailbox(token)));
    input.value = '';
    this.refused.set(false);
    const value = this.value();
    const dropped = value.filter((address) => !isMailbox(address) && address !== keep);
    if (!dropped.length) return;
    const editAt = this.editAt();
    if (editAt !== null) {
      const ahead = value.slice(0, editAt).filter((address) => dropped.includes(address)).length;
      this.editAt.set(editAt - ahead);
    }
    this.value.set(value.filter((address) => !dropped.includes(address)));
  }

  /** Puts the caret in the input — the whole control is the field, and a
      host's label row may forward its own clicks here. A full field has no
      input to put it in: focus goes to the last chip's remove control. */
  focus(): void {
    if (this.locked()) return;
    if (!this.closed()) {
      this.field().nativeElement.focus();
      return;
    }
    const controls = this.#host.nativeElement.querySelectorAll<HTMLElement>(
      '[data-slot=trailing] :is(button, [href], input, [tabindex]:not([tabindex="-1"]))',
    );
    controls[controls.length - 1]?.focus();
  }

  /** A press anywhere on the control is the input's from that moment: it
      takes focus at the press, not at the click after the release — so a
      chip pressed in a line of text turns the line to chips at once, and a
      hold on a chip runs with the document focused, which the clipboard
      insists on. `keepCaret` then declines the press's own default, which
      would move focus off again. */
  protected onPointerdown(event: PointerEvent): void {
    const input = this.field().nativeElement;
    if (event.target === input || this.locked() || this.closed()) return;
    input.focus();
  }

  /** A press anywhere on the control but the text input itself — a chip,
      its button, the gap between — leaves the caret where it is. The
      browser would otherwise move focus to the body for the press and back
      on the click, and in that instant the row would drop to text and
      reflow: a flash, and a blur that commits and touches for nothing. */
  protected keepCaret(event: MouseEvent): void {
    if (event.target !== this.field().nativeElement) event.preventDefault();
  }

  /** A click on a chip — not on its remove control — picks it, and only
      that: a click on the picked chip picks it again. The caret is in the
      input either way. */
  protected onChipClick(event: MouseEvent, index: number, input: HTMLInputElement): void {
    if ((event.target as Element).closest('[data-slot=trailing]') || this.locked()) return;
    this.#pick(index, input);
    input.focus();
  }

  /** Copies a chip's address — the picked one by default — to the
      clipboard, as a hold on the chip does; the chip shows and says so.
      Resolves to whether the copy went. */
  async copy(address: string | null = this.current()): Promise<boolean> {
    const chip = this.chips().find((candidate) => candidate.address() === address);
    return chip ? chip.copy() : false;
  }

  /** Picking a chip is being done with the typing: the addresses in it
      become chips first, as Enter would make them, and what is not an
      address stays behind, flagged. The picked chip is found again after,
      since chips committed ahead of it move it along. */
  #pick(index: number, input: HTMLInputElement): void {
    const address = this.value()[index];
    this.#settle(input, input.value);
    this.active.set(address === undefined ? null : this.value().indexOf(address));
  }

  protected onInput(): void {
    this.refused.set(false);
    this.active.set(null);
  }

  protected onKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    const active = this.active();
    if (active !== null && this.#onActiveKey(event, active, input)) return;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        // From the start of the typing, ← reaches the chip before the caret;
        // from its end, → the chip after it — the typing becoming chips
        // first, when it holds an address.
        const left = event.key === 'ArrowLeft';
        const edge = left ? 0 : input.value.length;
        if (input.selectionStart !== edge || input.selectionEnd !== edge || this.locked()) return;
        const typed = splitAddresses(input.value).some((token) => isMailbox(token));
        if (typed) this.#settle(input, input.value);
        const entry = this.entryAt();
        const target = left ? entry - 1 : entry;
        if (target < 0 || target >= this.value().length) {
          if (typed) event.preventDefault();
          return;
        }
        event.preventDefault();
        this.active.set(target);
        return;
      }
      case 'Enter':
      case ',':
      case ';':
        // Swallowed even with nothing typed: Enter in an address row must
        // never submit the form around it. The subject line is where Enter
        // sends.
        event.preventDefault();
        this.#settle(input, input.value);
        return;
      case 'Tab':
        // Tab on an address commits it and keeps the caret here, ready for
        // the next one — the list is not left until there is nothing more
        // to commit. Tab on nothing, on a typo, or backwards leaves the
        // field as ever, and leaving commits and flags what was typed.
        if (event.shiftKey || !splitAddresses(input.value).some((token) => isMailbox(token))) {
          return;
        }
        event.preventDefault();
        this.#settle(input, input.value);
        return;
      case 'Backspace': {
        // On nothing typed, the chip before the caret comes back to be
        // edited — the one pending edit.
        if (input.value) return;
        const previous = this.value()[this.entryAt() - 1];
        if (previous === undefined || this.locked()) return;
        event.preventDefault();
        this.edit(previous, input);
        return;
      }
    }
  }

  /** The keys that act on the highlighted chip. True when one did. The
      arrows walk the list's slots — every chip, and the caret's own place
      among them — and stop at either end. */
  #onActiveKey(event: KeyboardEvent, active: number, input: HTMLInputElement): boolean {
    const chips = this.value();
    const entry = this.entryAt();
    const slotOf = (index: number) => (index < entry ? index : index + 1);
    const chipAt = (slot: number) => (slot === entry ? null : slot < entry ? slot : slot - 1);
    switch (event.key) {
      case 'ArrowLeft': {
        const slot = Math.max(0, slotOf(active) - 1);
        this.active.set(chipAt(slot));
        if (slot === entry) input.setSelectionRange(input.value.length, input.value.length);
        break;
      }
      case 'ArrowRight': {
        const slot = Math.min(chips.length, slotOf(active) + 1);
        this.active.set(chipAt(slot));
        if (slot === entry) input.setSelectionRange(0, 0);
        break;
      }
      case 'Escape':
        this.active.set(null);
        break;
      case 'Enter':
        this.edit(chips[active], input);
        break;
      case 'Backspace':
      case 'Delete':
        if (this.locked()) return false;
        this.remove(chips[active]);
        break;
      default:
        return false;
    }
    event.preventDefault();
    return true;
  }

  /** A paste of several addresses: the addresses become chips, the rest
      joins what the input already holds. A single token is left to the
      input, so a name with spaces can still be edited before it commits. */
  protected onPaste(event: ClipboardEvent, input: HTMLInputElement): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (splitAddresses(text).length < 2) return;
    event.preventDefault();
    this.#settle(input, `${input.value}, ${text}`);
  }

  /** Focus arrived in the input: the typos at the end of the list come back
      into it, to be fixed — unless the user is already typing there. They
      come back as plain typing, not flagged: the caret is on them, and the
      next commit judges them again. */
  protected onFocus(input: HTMLInputElement): void {
    const typos = this.#trailingMalformed();
    if (input.value || !typos.length || this.locked()) return;
    this.value.update((current) => current.slice(0, current.length - typos.length));
    input.value = typos.join(', ');
    input.setSelectionRange(input.value.length, input.value.length);
    this.refused.set(false);
  }

  /** Leaving the field commits everything typed — the addresses where the
      caret was, a typo at the end of the list, so the form sees it and the
      next focus hands it back — and is the touch. The input returns to the
      end. Moving to a chip's remove button is not leaving. */
  protected onBlur(event: FocusEvent, input: HTMLInputElement): void {
    if (this.#within(event)) return;
    const tokens = splitAddresses(input.value);
    this.#insert(tokens.filter((token) => isMailbox(token)));
    this.editAt.set(null);
    this.#insert(tokens.filter((token) => !isMailbox(token)));
    input.value = '';
    this.refused.set(false);
    this.touch.emit();
  }

  protected onFocusout(event: FocusEvent): void {
    if (this.#within(event)) return;
    this.focused.set(false);
    this.active.set(null);
    this.editAt.set(null);
  }

  /** Commits the addresses in a run where the input is and leaves the rest
      in it. */
  #settle(input: HTMLInputElement, raw: string): void {
    const tokens = splitAddresses(raw);
    this.#insert(tokens.filter((token) => isMailbox(token)));
    input.value = tokens.filter((token) => !isMailbox(token)).join(', ');
    this.refused.set(!!input.value);
  }

  /** Adds addresses at the input's slot — the end, or the place of an edit,
      which moves along past them so the caret stays after what it made. */
  #insert(incoming: readonly string[]): void {
    if (!incoming.length) return;
    const editAt = this.editAt();
    let added = 0;
    this.value.update((current) => {
      const next = [...current];
      let at = editAt === null ? next.length : Math.min(editAt, next.length);
      for (const address of incoming) {
        if (next.length >= this.limit()) break;
        if (next.includes(address)) continue;
        next.splice(at, 0, address);
        at++;
        added++;
      }
      return next;
    });
    if (editAt !== null && added)
      this.editAt.set(Math.min(editAt, this.value().length - added) + added);
  }

  /** Whether focus is moving to somewhere else inside the control. */
  #within(event: FocusEvent): boolean {
    const destination = event.relatedTarget as Node | null;
    return !!destination && this.#host.nativeElement.contains(destination);
  }
}
