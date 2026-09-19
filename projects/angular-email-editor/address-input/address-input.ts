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
import {
  AddressChip,
  AddressChipRemove,
  isMailbox,
  splitAddresses,
} from 'angular-email-editor/address-chip';

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
 * **The input is always at the end, and editing happens there.** A chip
 * taken back for editing — a double click, Enter on a picked chip,
 * Backspace, `edit()` — leaves its place: its address goes into the input,
 * after the last chip, exactly like a typo the field handed back — and what
 * is committed from it joins the end of the list. There is one place where
 * text is typed, and it never moves.
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
 * the caret at the start of the typing, ← puts a highlight on the last chip
 * and walks back along the list; → walks forward, and past the last chip
 * returns to the caret. Enter — or a double click on
 * any chip — edits it,
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
  imports: [AddressChip],
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

  /** Splits a run into addresses and adds the new ones to the end of the
      list, up to `limit`. Duplicates are dropped; a malformed one is kept and
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

  /** Takes a chip — the picked one by default — back for editing: it
      leaves the list and the input, at the end, holds its address, caret at
      the end. The edit pending until now ends first. A locked list edits
      nothing. */
  edit(
    address: string | null = this.current(),
    input: HTMLInputElement = this.field().nativeElement,
  ): void {
    if (this.locked() || address === null) return;
    this.active.set(null);
    this.#endPending(input, address);
    if (!this.value().includes(address)) return;
    this.remove(address);
    input.value = address;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** Ends the pending edit so another can start: the addresses typed so far
      become chips, the rest of the typing goes, and so
      does every chip that is not an address — but `keep`, the one about to
      be edited. */
  #endPending(input: HTMLInputElement, keep?: string): void {
    this.#insert(splitAddresses(input.value).filter((token) => isMailbox(token)));
    input.value = '';
    this.refused.set(false);
    const value = this.value();
    const kept = value.filter((address) => isMailbox(address) || address === keep);
    if (kept.length !== value.length) this.value.set(kept);
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

  /** A double click on a chip — not on its remove control — takes it back
      for editing. */
  protected onChipDblclick(event: MouseEvent, address: string, input: HTMLInputElement): void {
    if ((event.target as Element).closest('[data-slot=trailing]')) return;
    this.edit(address, input);
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
      address stays behind, flagged. */
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
      case 'ArrowLeft': {
        // From the start of the typing, ← reaches the last chip — the
        // typing becoming chips first, when it holds an address.
        if (input.selectionStart !== 0 || input.selectionEnd !== 0 || this.locked()) return;
        const typed = splitAddresses(input.value).some((token) => isMailbox(token));
        if (typed) this.#settle(input, input.value);
        const last = this.value().length - 1;
        if (typed || last >= 0) event.preventDefault();
        if (last >= 0) this.active.set(last);
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
        // On nothing typed, the last chip comes back to be edited — the one
        // pending edit.
        if (input.value) return;
        const previous = this.value().at(-1);
        if (previous === undefined || this.locked()) return;
        event.preventDefault();
        this.edit(previous, input);
        return;
      }
    }
  }

  /** The keys that act on the highlighted chip. True when one did. The
      arrows walk the chips: ← stops at the first, → past the last returns
      to the caret. */
  #onActiveKey(event: KeyboardEvent, active: number, input: HTMLInputElement): boolean {
    const chips = this.value();
    switch (event.key) {
      case 'ArrowLeft':
        this.active.set(Math.max(0, active - 1));
        break;
      case 'ArrowRight':
        if (active + 1 < chips.length) {
          this.active.set(active + 1);
        } else {
          this.active.set(null);
          input.setSelectionRange(0, 0);
        }
        break;
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

  /** Leaving the field commits everything typed — the addresses, then a
      typo at the end of the list, so the form sees it and the next focus
      hands it back — and is the touch. Moving to a chip's remove button is
      not leaving. */
  protected onBlur(event: FocusEvent, input: HTMLInputElement): void {
    if (this.#within(event)) return;
    const tokens = splitAddresses(input.value);
    this.#insert(tokens.filter((token) => isMailbox(token)));
    this.#insert(tokens.filter((token) => !isMailbox(token)));
    input.value = '';
    this.refused.set(false);
    this.touch.emit();
  }

  protected onFocusout(event: FocusEvent): void {
    if (this.#within(event)) return;
    this.focused.set(false);
    this.active.set(null);
  }

  /** Commits the addresses in a run and leaves the rest in the input. */
  #settle(input: HTMLInputElement, raw: string): void {
    const tokens = splitAddresses(raw);
    this.#insert(tokens.filter((token) => isMailbox(token)));
    input.value = tokens.filter((token) => !isMailbox(token)).join(', ');
    this.refused.set(!!input.value);
  }

  /** Adds the new addresses to the end of the list, up to `limit`. */
  #insert(incoming: readonly string[]): void {
    if (!incoming.length) return;
    this.value.update((current) => {
      const next = [...current];
      for (const address of incoming) {
        if (next.length >= this.limit()) break;
        if (!next.includes(address)) next.push(address);
      }
      return next;
    });
  }

  /** Whether focus is moving to somewhere else inside the control. */
  #within(event: FocusEvent): boolean {
    const destination = event.relatedTarget as Node | null;
    return !!destination && this.#host.nativeElement.contains(destination);
  }
}
