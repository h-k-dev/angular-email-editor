import {
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  input,
  model,
} from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { Attachment, AttachmentChip } from '@h-k-dev/angular-email-editor/attachment-chip';

/**
 * The row a message's attachment chips sit in — under the body, in Gmail's
 * spot: the strip belongs to the message, not to the envelope.
 *
 * **The strip is the form's control.** It holds the list as its `value` —
 * a `FormValueControl` over the attachments, bound with `[formField]` or
 * two-way as `[(value)]` — and nothing else: the host renders one
 * `<li email-attachment-chip>` per item into it and decides, chip by chip
 * in its own template, what each one shows (real progress, a simulated one,
 * none). That is why the pair is two components. The chips register by
 * being content: each one's `removed` is relayed into the value for as long
 * as it is in the strip, so a chip's × takes its item out of the message
 * with no wiring on the host's side. Identity, not name — the host's items
 * are the value's, so the chip that asked is exactly the item that goes.
 * `disabled` (the form's, or the host's) holds the value still.
 *
 * **Focus keeps its place.** When the chip that goes holds focus — its ×
 * pressed from the keyboard, say — focus moves first to the same control
 * on its neighbour (the next chip, else the one before), so a keyboard user
 * removing chips one after another never lands on the page's start. With
 * no neighbour left it stays put: where focus goes once the strip empties
 * is the host's to say (back to the text, say), in its own `(removed)`.
 *
 * `aria-busy` is reflected while any chip is busy, so a host can style or
 * gate on the strip as a whole (`[email-attachment-chips][aria-busy='true']`,
 * or a disabled Send).
 *
 * Meant for a `<ul>`. `role="list"` is set anyway, because `list-style: none`
 * costs a list its semantics in Safari. Hidden while it holds no chips, so a
 * host can place it unconditionally.
 */
@Component({
  selector: '[email-attachment-chips]',
  template: '<ng-content />',
  styleUrl: './attachment-chips.scss',
  host: {
    role: 'list',
    '[attr.aria-label]': 'label()',
    '[attr.aria-busy]': 'busy() || null',
    '[attr.aria-disabled]': 'disabled() || null',
    '[hidden]': '!chips().length',
  },
})
export class AttachmentChips<T extends Attachment = Attachment> implements FormValueControl<T[]> {
  /** Names the list for assistive tech. */
  readonly label = input('Attachments');

  /** The attachments the strip stands for — the form's value. The host
      renders a chip per item; a chip's removal takes its item out of here. */
  readonly value = model<T[]>([]);

  /** Nothing may leave the value — e.g. while the message sends. */
  readonly disabled = input(false, { transform: booleanAttribute });

  protected readonly chips = contentChildren(AttachmentChip);
  /** The same chips' elements, in the same order — where focus can go. */
  private readonly chipElements = contentChildren(AttachmentChip, { read: ElementRef });

  /** Any chip in the strip is busy — uploading, downloading, simulating. */
  readonly busy = computed(() => this.chips().some((chip) => chip.busy()));

  constructor() {
    effect((onCleanup) => {
      const subscriptions = this.chips().map((chip) =>
        chip.removed.subscribe(() => this.#removeChip(chip)),
      );
      onCleanup(() => subscriptions.forEach((subscription) => subscription.unsubscribe()));
    });
  }

  /** A chip asked to go: focus on it moves to its neighbour, then its item
      leaves the value. */
  #removeChip(chip: AttachmentChip): void {
    if (this.disabled()) return;
    const elements = this.chipElements().map((ref) => ref.nativeElement as HTMLElement);
    const index = this.chips().indexOf(chip);
    const element = elements[index];
    const focused = element?.ownerDocument.activeElement;
    if (element && focused instanceof HTMLElement && element.contains(focused)) {
      const neighbour = elements[index + 1] ?? elements[index - 1];
      if (neighbour) focusLike(focused, neighbour);
    }
    this.remove(chip.attachment() as T);
  }

  /** Takes one attachment out of the value, by identity. A no-op while
      disabled. */
  remove(attachment: T): void {
    if (this.disabled()) return;
    this.value.update((list) => list.filter((item) => item !== attachment));
  }
}

/** Focuses, in `chip`, the control that matches `focused` in another chip
    — the same part, by its data-slot (the ×, the download, the chip's own
    click), or the button a host put in that part's box; failing that, the
    chip's first live button. */
function focusLike(focused: HTMLElement, chip: HTMLElement): void {
  const slot = focused.closest('[data-slot]')?.getAttribute('data-slot');
  const part = slot ? chip.querySelector<HTMLElement>(`[data-slot='${slot}']`) : null;
  const target =
    (part?.matches('button:not(:disabled)')
      ? part
      : part?.querySelector<HTMLElement>('button:not(:disabled)')) ??
    chip.querySelector<HTMLElement>('button:not(:disabled)');
  target?.focus();
}
