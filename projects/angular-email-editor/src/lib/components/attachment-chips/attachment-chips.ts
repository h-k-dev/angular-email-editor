import { Component, ViewEncapsulation, computed, contentChildren, input } from '@angular/core';
import { AttachmentChip } from '../attachment-chip/attachment-chip';

/**
 * The row a message's attachment chips sit in — under the body, in Gmail's
 * spot: the strip belongs to the message, not to the envelope.
 *
 * Layout and list semantics only. It wraps its chips, names the list for
 * assistive tech, and holds no data: the host renders one
 * `<li email-attachment-chip>` per attachment inside it and decides, chip
 * by chip in its own template, what each one shows — real progress, a
 * simulated one, none. That is why the pair is two components.
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
  encapsulation: ViewEncapsulation.None,
  host: {
    role: 'list',
    '[attr.aria-label]': 'label()',
    '[attr.aria-busy]': 'busy() || null',
    '[hidden]': '!chips().length',
  },
})
export class AttachmentChips {
  /** Names the list for assistive tech. */
  readonly label = input('Attachments');

  protected readonly chips = contentChildren(AttachmentChip);

  /** Any chip in the strip is busy — uploading, downloading, simulating. */
  readonly busy = computed(() => this.chips().some((chip) => chip.busy()));
}
