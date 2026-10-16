import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
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
import { ADDRESS_RULES, addressKey, isMailbox, isPending, separatesAt } from '@h-k-dev/angular-email-editor/address';
import {
  ADDRESS_DRAG_TYPE,
  AddressChip,
  AddressChipRemove,
} from '@h-k-dev/angular-email-editor/address-chip';
import { NgTemplateOutlet } from '@angular/common';
import { AddressDragGroup } from './address-drag-group';
import { AddressInputLabel } from './address-input.slots';

let nextId = 0;

/** Where a drag over an input would land — the index in its list — and the
    line drawn there, in the chip list's own coordinates. */
interface DropMarker {
  index: number;
  x: number;
  y: number;
  height: number;
}

/** The chip drag in flight from an address input on this page: where it
    came from, and whether an address input took it as a move. The drag
    data can't be read until the drop, and `dropEffect` at the drag's end is
    not to be trusted (WebKit reports `all`): this is how a target refuses
    a duplicate before the drop and how the source learns to let go. */
let drag: {
  source: AddressInput;
  group: AddressDragGroup | null;
  address: string;
  moved: boolean;
} | null = null;

/**
 * An address field the way Gmail's works: committed addresses as chips,
 * free typing after them. Enter, comma, semicolon or a paste commits what
 * was typed — a comma or semicolon inside a quoted name or angle brackets is
 * just typed, and no key commits while an IME is composing; Backspace on the empty input takes the chip before the caret
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
 * returns to the caret. Enter or F2 — or a double click on
 * any chip — edits it, Alt+← and Alt+→ move it a place along the list,
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
 * form, ready for a `To:` line. Typed bare, `Ada Lovelace ada@example.com`
 * becomes that same chip. An address is in the list once: another entry
 * with the same address — in any case, under any name — is dropped.
 *
 * **The control, not the row.** By default it owns no label and draws no row: the
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
 * **Chips move between inputs by drag and drop.** A chip of an editable
 * input can be dragged to another — To into Cc, as Gmail and Outlook do —
 * and leaves its own list when the other takes it. The other commits it
 * as it was, flagged or pending alike. A chip whose address the other
 * already holds is absorbed, as Gmail does: it leaves its list and the
 * other keeps its own entry. A full list (From holds one) refuses the
 * drop, and the chip stays. Dropped in its own list, a chip is reordered:
 * it moves to the line; the line is not drawn where the chip already is. Alt (Option), or Ctrl, makes
 * it a copy — onto a duplicate, a copy is nothing, so refused. Nothing
 * moves while a drag is over a target: a thin line between its chips
 * (`drop-marker`) shows where the chip will land, before or after the chip
 * under the pointer, and the drop puts it there; the host carries
 * `data-dropping` meanwhile. Only chips are places: a draft — typed in the
 * input, or left at the end of the list when the row lost focus — is not,
 * and a drop lands before it.
 * A drop counts as working both fields: each is touched.
 * A chip lands in an address input or nowhere: it carries no plain text,
 * so a subject line or an editor can't take it. `emailAddressDragGroup` on
 * the element around a writer's rows keeps its chips among them. Plain text
 * dropped from elsewhere is a paste — the addresses become chips, the rest
 * is left typed.
 * `moveTo()` is the same move for the keyboard — a host's "Move to Cc" —
 * and the moved chip says so (`movedLabel`). A touch is never a drag: on
 * a phone the press is the chip's hold-to-copy. `allowDrag` turns it off;
 * a disabled or read-only input is neither source nor target.
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
    '[attr.data-dropping]': 'dropping() || null',
    '(pointerdown)': 'onPointerdown($event)',
    '(mousedown)': 'keepCaret($event)',
    '(click)': 'focus()',
    '(focusin)': 'onFocusin()',
    '(focusout)': 'onFocusout($event)',
    '(dragenter)': 'onDragover($event)',
    '(dragover)': 'onDragover($event)',
    '(dragleave)': 'onDragleave($event)',
    '(drop)': 'onDrop($event)',
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

  /** The ids of whatever describes the field — a hint, an error line —
      passed through to the text input, where assistive tech reads them. */
  readonly ariaDescribedby = input<string | null>(null, { alias: 'aria-describedby' });

  readonly #frameIds = signal<readonly string[]>([]);

  /** What the text input's `aria-describedby` says: the host's own ids and a
      frame's, each once. */
  protected readonly describedBy = computed(() => {
    const ids = new Set([...(this.ariaDescribedby()?.split(/\s+/) ?? []), ...this.#frameIds()]);
    ids.delete('');
    return ids.size ? [...ids].join(' ') : null;
  });

  /** Adds the ids of a frame's own lines — a form field's hint and error —
      to what describes the text input, beside the host's `aria-describedby`;
      each call replaces the frame's previous ids. */
  describe(ids: readonly string[]): void {
    this.#frameIds.set(ids);
  }

  /** Most addresses the field takes; the input hides once reached. Named
      `limit`, not `max`: the form contract keeps that name for the `max` rule. */
  readonly limit = input(Infinity, { transform: numberAttribute });

  /** Prefix for each chip's remove button — "Remove ada@example.com". */
  readonly removeLabel = input('Remove');

  /** What a malformed address is flagged as. */
  readonly invalidLabel = input('not an email address');

  /** The chips' note on a placeholder a template fills in later. */
  readonly pendingLabel = input('filled in when sent');

  /** What a chip moved into this input says, before its address — a host
      with labelled rows says where: "Moved to Cc:". */
  readonly movedLabel = input('Moved');

  /** Chips may be dragged out of this input and dropped into it. Set false
      for a row that only shows; a disabled or read-only input never takes
      part either way. */
  readonly allowDrag = input(true, { transform: booleanAttribute });

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

  /** The host's label template, if it opted into one — rendered first in
      the row; the text input is named by it. */
  protected readonly labelSlot = contentChild(AddressInputLabel);

  /** The label box's id, for the text input's `aria-labelledby`. */
  protected readonly labelId = `${this.id}-label`;

  /** What names the text input: the host's own `aria-labelledby`; else the
      label slot — unless the host gave an `aria-label` instead. */
  protected readonly labelledBy = computed(
    () => this.ariaLabelledby() ?? (this.labelSlot() && !this.ariaLabel() ? this.labelId : null),
  );

  /** The host's remove template, passed on to every chip. */
  protected readonly removeSlot = contentChild(AddressChipRemove);

  protected readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  /** The list of chips, where a press on a draggable chip parks focus. */
  protected readonly chipList = viewChild.required<ElementRef<HTMLElement>>('chipList');

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);

  /** The address rule in force — ours, or the host's (`provideAddressRules`):
      how typing splits, what is an address, what is one recipient. */
  readonly #rules = inject(ADDRESS_RULES);
  /** What becomes a chip: a well-formed mailbox, or a placeholder a
      template fills in later. Everything else is a typo to hand back. */
  #accepts = (raw: string) => isMailbox(raw, this.#rules) || isPending(raw, this.#rules);
  #key = (raw: string) => addressKey(raw, this.#rules);
  /** The list has this address already — in any case, under any name. */
  #holds = (raw: string) => this.#keys().has(this.#key(raw));
  /** The list's addresses by key, parsed once a change — not on every
      `dragover`. */
  readonly #keys = computed(() => new Set(this.value().map(this.#key)));

  /** The chips this input trades with: those of the nearest
      `emailAddressDragGroup`, or of every input in none. */
  readonly #group = inject(AddressDragGroup, { optional: true });

  readonly #focused = signal(false);

  /** Focus is somewhere in the control — the input or a chip's remove
      button. The chips are chips only then. Read-only; for a host's own
      frame (a form field whose label floats on it). */
  readonly focused = this.#focused.asReadonly();

  readonly #text = signal('');

  /** What is typed in the input and not committed yet — for a host's own
      frame, where a field with typing in it is not empty. */
  readonly text = this.#text.asReadonly();

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
    while (start > 0 && !this.#accepts(value[start - 1])) start--;
    return value.slice(start);
  });

  /** Where the draft starts in the list: the trailing malformed entries are
      the typing the row was left with — what focus hands back to the input
      — and no chip is placed among or after them. A drop, or `moveTo()`,
      lands before. */
  readonly #draftStart = computed(() => this.value().length - this.#trailingMalformed().length);

  /** Full, and nothing in it to fix: the input hides — the chips say
      everything. A full list ending in a typo keeps it, so focus can hand
      the typo back. */
  protected readonly closed = computed(() => this.full() && !this.#trailingMalformed().length);

  /** Nothing may change: disabled or read-only. Chips lose their remove
      button, the input is out of play. */
  protected readonly locked = computed(() => this.disabled() || this.readonly());

  /** Chips can be dragged out of the list, and dropped into it. */
  protected readonly canDrag = computed(() => this.allowDrag() && !this.locked());

  /** Where a drag over the input would land: the index in the list, and
      the line drawn there — in the chip list's own coordinates. Null while
      no drag the input would take is over it. Drawn on top, out of the
      flow, so nothing moves under the pointer. */
  protected readonly dropMarker = signal<DropMarker | null>(null, {
    // A drag sends `dragover` every few dozen milliseconds, moving or not:
    // the same place again is no change, and renders nothing.
    equal: (a, b) =>
      a === b ||
      (!!a && !!b && a.index === b.index && a.x === b.x && a.y === b.y && a.height === b.height),
  });

  /** A drag the input would take is over it. */
  protected readonly dropping = computed(() => this.dropMarker() !== null);

  /** The press under way is a mouse's (or a pen's) on a draggable chip:
      its default has to stay, or the browser never starts the drag. */
  #dragPress = false;

  /** Invalid *and* touched — the moment the state becomes the user's business. */
  protected readonly flagged = computed(() => this.invalid() && this.touched());

  /** Splits a run into addresses and adds the new ones to the end of the
      list, up to `limit`. Duplicates — by address, case-insensitively —
      are dropped; a malformed one is kept and
      flagged — this is the host's way in, and the host decides what it
      holds. */
  commit(raw: string): void {
    this.#insert(this.#rules.split(raw));
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
    this.#write(input, address);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** Ends the pending edit so another can start: the addresses typed so far
      become chips, the rest of the typing goes, and so
      does every chip that is not an address — but `keep`, the one about to
      be edited. */
  #endPending(input: HTMLInputElement, keep?: string): void {
    this.#insert(this.#rules.split(input.value).filter((token) => this.#accepts(token)));
    this.#write(input, '');
    this.refused.set(false);
    const value = this.value();
    const kept = value.filter((address) => this.#accepts(address) || address === keep);
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
    const target = event.target as Element;
    this.#dragPress =
      event.pointerType !== 'touch' &&
      this.canDrag() &&
      !!target.closest?.('[email-address-chip]') &&
      !target.closest('[data-slot=trailing]');
    if (target === input || this.locked() || this.closed()) return;
    input.focus();
  }

  /** A press anywhere on the control but the text input itself — a chip,
      its button, the gap between — leaves the caret where it is. The
      browser would otherwise move focus to the body for the press and back
      on the click, and in that instant the row would drop to text and
      reflow: a flash, and a blur that commits and touches for nothing.
      Except a mouse's press on a draggable chip: no engine starts a drag
      from a press whose default was declined, so it keeps it, and the
      press's focus lands on the chip list instead (`tabindex="-1"`) —
      still inside the control, so nothing commits; the click or the drag's
      end brings the caret back. */
  protected keepCaret(event: MouseEvent): void {
    if (event.target === this.field().nativeElement || this.#dragPress) return;
    event.preventDefault();
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

  /** Moves a chip — the picked one by default — to another address input:
      the keyboard's way to do what a drag does, for a host's own "Move to
      Cc". The target takes it as it is, to the end of its list — before
      a draft the row was left with — and it
      leaves this one; both are touched, and the moved chip says so
      (`movedLabel`). One the target already holds is absorbed: it leaves
      here, and the target keeps its own entry. A full target, or either
      input locked, moves nothing. Returns whether it moved. */
  moveTo(target: AddressInput, address: string | null = this.current()): boolean {
    if (address === null || target === this || this.locked() || target.locked()) return false;
    if (!this.value().includes(address)) return false;
    if (!target.#holds(address) && !target.#insert([address], target.#draftStart()).length) {
      return false;
    }
    this.remove(address);
    this.touch.emit();
    target.touch.emit();
    target.#announceMoved(address);
    return true;
  }

  /** The chip that arrived by a move — or the entry that absorbed it —
      says so, once it is drawn. */
  #announceMoved(address: string): void {
    const key = this.#key(address);
    afterNextRender(
      () =>
        this.chips()
          .find((chip) => this.#key(chip.address()) === key)
          ?.announce(`${this.movedLabel()} ${address}`),
      { injector: this.#injector },
    );
  }

  // ── drag and drop ─────────────────────────────────────────────────────

  /** A chip of this list started a drag: remember it, so a target on the
      page can judge the drop before it happens and tell this list to let
      go after. */
  protected onChipDragstart(address: string): void {
    drag = this.canDrag() ? { source: this, group: this.#group, address, moved: false } : null;
  }

  /** The drag ended: if an address input took the chip as a move, it
      leaves — through `remove()`, as the × takes it — and the field is
      touched. The press parked focus on the list; the caret comes back. */
  protected onChipDragend(): void {
    const ended = drag;
    drag = null;
    if (ended?.source === this && ended.moved) {
      this.remove(ended.address);
      this.touch.emit();
    }
    if (document.activeElement === this.chipList().nativeElement) this.focus();
  }

  /** What a drop here would be: `move` or `copy` for a drag the input
      takes, `none` for one it refuses — said, so the text input inside
      can't take the text in its place — and null for a drag that isn't an
      address (files: the page's drop zone's), left to the page. A chip is
      taken only from another input of the same group, while this page's
      drag is in flight — a chip from anywhere else is refused. */
  #dropEffect(event: DragEvent): 'move' | 'copy' | 'none' | null {
    const types = event.dataTransfer?.types ?? [];
    const chip = types.includes(ADDRESS_DRAG_TYPE);
    if (!chip && !types.includes('text/plain')) return null;
    if (!this.canDrag()) return chip ? 'none' : null;
    if (!chip) return this.full() ? 'none' : 'copy';
    const from = drag;
    if (!from || from.group !== this.#group) return 'none';
    const copy = event.altKey || event.ctrlKey;
    // Its own list: a move is a reorder; a copy would add nothing.
    if (from.source === this) return copy ? 'none' : 'move';
    // Held already: a move is absorbed, even into a full list; a copy is
    // nothing.
    if (this.#holds(from.address)) return copy ? 'none' : 'move';
    if (this.full()) return 'none';
    return copy ? 'copy' : 'move';
  }

  protected onDragover(event: DragEvent): void {
    const effect = this.#dropEffect(event);
    if (effect === null) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = effect;
    const marker = effect === 'none' ? null : this.#dropAt(event);
    this.dropMarker.set(marker && this.#inPlace(marker.index) ? null : marker);
  }

  /** A drop at this index would leave the dragged chip where it is: right
      before or right after itself, in its own list. No line there. */
  #inPlace(index: number): boolean {
    if (drag?.source !== this) return false;
    const at = this.value().indexOf(drag.address);
    return index === at || index === at + 1;
  }

  /** Moves a chip of the list to stand before the entry at `at` (the end,
      past the last). True when it moved — not when it would stay put. */
  #reorder(address: string, at: number): boolean {
    const from = this.value().indexOf(address);
    if (from < 0 || at < 0 || at > this.value().length || at === from || at === from + 1) {
      return false;
    }
    const to = at > from ? at - 1 : at;
    this.value.update((current) => {
      const next = current.filter((held) => held !== address);
      next.splice(to, 0, address);
      return next;
    });
    return true;
  }

  /** Where a drop at the pointer lands, in reading order: before the first
      entry that starts after the pointer — on a later line, or on its line
      past the pointer's side of the entry's middle — else at the end. And
      the line that says so: midway between two entries on one line, or
      just outside the entry at a line's start or end. */
  #dropAt(event: DragEvent): DropMarker {
    const list = this.chipList().nativeElement;
    const box = list.getBoundingClientRect();
    const rtl = getComputedStyle(list).direction === 'rtl';
    const x = event.clientX ?? 0;
    const y = event.clientY ?? 0;
    const chips = [...list.querySelectorAll(':scope > [email-address-chip]')];
    // Only the chips before the draft are places; the draft is not.
    const rects = chips.slice(0, this.#draftStart()).map((chip) => chip.getBoundingClientRect());
    let index = rects.findIndex(
      (r) =>
        y < r.top || (y <= r.bottom && (rtl ? x > r.left + r.width / 2 : x < r.left + r.width / 2)),
    );
    if (index < 0) index = rects.length;
    const start = (r: DOMRect) => (rtl ? r.right : r.left);
    const end = (r: DOMRect) => (rtl ? r.left : r.right);
    // At a line's start or end the line stands a gap off the entry, as Gmail's does.
    const out = rtl ? 4 : -4;
    const at = rects[index];
    const before = rects[index - 1];
    let line: { x: number; top: number; height: number };
    if (at && before && Math.abs(before.top - at.top) < 1) {
      line = { x: (end(before) + start(at)) / 2, top: at.top, height: at.height };
    } else if (at) {
      line = { x: start(at) + out, top: at.top, height: at.height };
    } else if (before) {
      line = { x: end(before) - out, top: before.top, height: before.height };
    } else {
      // No chip yet: at the start — of the draft, if the row was left with one.
      const first = (chips[0] ?? list.querySelector('[data-slot=entry]')!).getBoundingClientRect();
      line = { x: start(first) + (chips[0] ? out : 0), top: first.top, height: first.height };
    }
    return { index, x: line.x - box.left, y: line.top - box.top, height: line.height };
  }

  /** Leaving for somewhere outside the control: the drag is no longer over
      it. (A leave with nowhere named — some engines — ends it too; the
      next `dragover` inside brings it back.) */
  protected onDragleave(event: DragEvent): void {
    const to = event.relatedTarget as Node | null;
    if (!to || !this.#host.nativeElement.contains(to)) this.dropMarker.set(null);
  }

  /** The drop: a chip is committed as it was; plain text from elsewhere is
      a paste — its addresses become chips, the rest joins the typing. What
      was typed stays. A chip the list holds already is absorbed by a move:
      nothing is added, and the source lets it go. Nothing added otherwise
      (the limit) is no drop: the source keeps its chip. */
  protected onDrop(event: DragEvent): void {
    const effect = this.#dropEffect(event);
    this.dropMarker.set(null);
    if (effect === null) return;
    event.preventDefault();
    const transfer = event.dataTransfer!;
    if (effect === 'none') {
      transfer.dropEffect = 'none';
      return;
    }
    const entry = transfer.getData(ADDRESS_DRAG_TYPE);
    const { index } = this.#dropAt(event);
    let changed: boolean;
    if (entry && drag?.source === this) {
      // Its own chip: a reorder. The source is this list; nothing leaves.
      changed = this.#reorder(entry, index);
      if (changed) this.active.set(null);
    } else if (entry) {
      const absorbed = effect === 'move' && this.#holds(entry);
      changed = absorbed || this.#insert([entry], index).length > 0;
      if (changed && drag?.address === entry) {
        drag.moved = effect === 'move';
        if (drag.moved) this.#announceMoved(entry);
      }
    } else {
      const tokens = this.#rules.split(transfer.getData('text/plain'));
      changed =
        this.#insert(
          tokens.filter((token) => this.#accepts(token)),
          index,
        ).length > 0;
      const rest = tokens.filter((token) => !this.#accepts(token));
      if (rest.length) {
        const input = this.field().nativeElement;
        this.#write(input, [input.value, ...rest].filter(Boolean).join(', '));
        this.refused.set(true);
        input.focus();
        changed = true;
      }
    }
    if (!changed) {
      transfer.dropEffect = 'none';
      return;
    }
    this.touch.emit();
  }

  /** Picking a chip is being done with the typing: the addresses in it
      become chips first, as Enter would make them, and what is not an
      address stays behind, flagged. */
  #pick(index: number, input: HTMLInputElement): void {
    const address = this.value()[index];
    this.#settle(input, input.value);
    this.active.set(address === undefined ? null : this.value().indexOf(address));
  }

  protected onFocusin(): void {
    this.#focused.set(true);
  }

  protected onInput(input: HTMLInputElement): void {
    this.#text.set(input.value);
    this.refused.set(false);
    this.active.set(null);
  }

  protected onKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    // An IME's own Enter picks its candidate; nothing here may act on it.
    if (event.isComposing) return;
    const active = this.active();
    if (active !== null && this.#onActiveKey(event, active, input)) return;
    switch (event.key) {
      case 'ArrowLeft': {
        // From the start of the typing, ← reaches the last chip — the
        // typing becoming chips first, when it holds an address.
        if (input.selectionStart !== 0 || input.selectionEnd !== 0 || this.locked()) return;
        const typed = this.#rules.split(input.value).some((token) => this.#accepts(token));
        if (typed) this.#settle(input, input.value);
        const last = this.value().length - 1;
        if (typed || last >= 0) event.preventDefault();
        if (last >= 0) this.active.set(last);
        return;
      }
      case ',':
      case ';':
        // Inside a quoted name or angle brackets the character is the
        // mailbox's own: `"Lovelace, Ada"`.
        if (!separatesAt(input.value, input.selectionStart ?? input.value.length)) return;
        event.preventDefault();
        this.#settle(input, input.value);
        return;
      case 'Enter':
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
        if (event.shiftKey || !this.#rules.split(input.value).some((token) => this.#accepts(token))) {
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
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // Alt+← / Alt+→ move the chip a place — the drag's reorder, by key.
      // At either end there is nowhere to go, and the key is still the
      // chip's: it never walks the highlight instead.
      if (this.locked()) return false;
      const address = chips[active];
      if (this.#reorder(address, event.key === 'ArrowLeft' ? active - 1 : active + 2)) {
        this.active.set(this.value().indexOf(address));
        this.touch.emit();
      }
      event.preventDefault();
      return true;
    }
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
      case 'F2':
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
    if (this.#rules.split(text).length < 2) return;
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
    this.#write(input, typos.join(', '));
    input.setSelectionRange(input.value.length, input.value.length);
    this.refused.set(false);
  }

  /** Leaving the field commits everything typed — the addresses, then a
      typo at the end of the list, so the form sees it and the next focus
      hands it back — and is the touch. Moving to a chip's remove button is
      not leaving. */
  protected onBlur(event: FocusEvent, input: HTMLInputElement): void {
    if (this.#within(event)) return;
    this.#leave(input);
  }

  #leave(input: HTMLInputElement): void {
    const tokens = this.#rules.split(input.value);
    this.#insert(tokens.filter((token) => this.#accepts(token)));
    this.#insert(tokens.filter((token) => !this.#accepts(token)));
    this.#write(input, '');
    this.refused.set(false);
    this.touch.emit();
  }

  protected onFocusout(event: FocusEvent): void {
    if (this.#within(event)) return;
    // Focus parked on the chip list by a press that came to nothing leaves
    // from there: leaving is leaving, wherever the caret had got to.
    if (event.target === this.chipList().nativeElement) this.#leave(this.field().nativeElement);
    this.#focused.set(false);
    this.active.set(null);
  }

  /** Commits the addresses in a run and leaves the rest in the input. */
  #settle(input: HTMLInputElement, raw: string): void {
    const tokens = this.#rules.split(raw);
    this.#insert(tokens.filter((token) => this.#accepts(token)));
    this.#write(input, tokens.filter((token) => !this.#accepts(token)).join(', '));
    this.refused.set(!!input.value);
  }

  /** Adds the new addresses to the list — at the end, or before the entry
      at `at` (a drop) — up to `limit`, each only if its address is not in
      the list yet; the entry already there keeps its name. Returns what
      was added. */
  #insert(incoming: readonly string[], at = Infinity): string[] {
    const added: string[] = [];
    if (!incoming.length) return added;
    this.value.update((current) => {
      const seen = new Set(current.map(this.#key));
      for (const address of incoming) {
        if (current.length + added.length >= this.limit()) break;
        if (seen.has(this.#key(address))) continue;
        seen.add(this.#key(address));
        added.push(address);
      }
      return [...current.slice(0, at), ...added, ...current.slice(at)];
    });
    return added;
  }

  /** Puts text in the input — the one way it is written, so `text` follows. */
  #write(input: HTMLInputElement, text: string): void {
    input.value = text;
    this.#text.set(text);
  }

  /** Whether focus is moving to somewhere else inside the control. */
  #within(event: FocusEvent): boolean {
    const destination = event.relatedTarget as Node | null;
    return !!destination && this.#host.nativeElement.contains(destination);
  }
}
