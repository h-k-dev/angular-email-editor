import { NgTemplateOutlet } from '@angular/common';
import { Component, booleanAttribute, computed, inject, input } from '@angular/core';

// Form
import { FormRoot } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltip, TooltipPosition } from '@angular/material/tooltip';

import { ScrollOwner } from '../../../../../core/common/directives/scroll-owner/scroll-owner';

/** Where the writer's bar sits: closing the sheet, or heading it. */
export type WriterBarPosition = 'top' | 'bottom';

/** What scrolls: the body alone, under the envelope held in place — or the
    whole sheet, so the bar and the envelope scroll away above the text. */
export type WriterScroll = 'body' | 'sheet';

/**
 * The email writer: the sheet a message is written on, and the form it is
 * sent with. It declares the sheet's regions — the bar with Send, the
 * envelope block, the body filling the rest — and the host fills them: the
 * bar's extra buttons marked `actions` (beside Send) or `leading` (the bar's
 * start), rows marked `envelope` land in the envelope block, everything else
 * (the editor, with the attachment strip inside it) in the body, each a
 * `[formField]` of the one `[formRoot]` this element carries. The root is a
 * host directive, so the host binds `[formRoot]="envelope"` right on the
 * writer and keeps every field on its own template, beside the model they
 * edit.
 *
 * The Send button is the form's submit. It, Enter in the subject, and the
 * editor's Mod-Enter and /send all end in the same `submit()`, validated the
 * same way; while the submission runs the button shows its progress, and
 * the form ignores another submit until it settles. What
 * sending *does* is the host's (the form's action).
 *
 * The bar has two places (`bar`): closing the sheet under the formatting
 * toolbar, where the message ends and is sent — or heading it, above the
 * envelope, where the thumb and the eye start (a phone's sheet, a zoomed
 * window). Heading the sheet, the row is mirrored: the actions first, Send
 * at the end. The writer knows no screen: its host — the desktop sheet or
 * the phone's — says where the bar goes, what scrolls and how large the
 * bar's buttons are.
 */
@Component({
  selector: 'form[email-writer]',
  imports: [
    NgTemplateOutlet,

    // Material
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltip,
  ],
  hostDirectives: [{ directive: FormRoot, inputs: ['formRoot'] }],
  templateUrl: './email-writer.html',
  styleUrl: './email-writer.scss',
  host: {
    // Where the bar is, and how large: the stylesheet tells the body how
    // much room a bar at the foot takes (`--writer-foot-bar`).
    '[attr.data-bar]': 'bar()',
    '[attr.data-dense]': 'dense() || null',
    // What scrolls: the body, or the whole sheet.
    '[attr.data-scroll]': 'scroll()',
  },
})
export class EmailWriter {
  readonly #root = inject(FormRoot);

  /** Where the bar goes: closing the sheet (`bottom`) or heading it. Only
      its place: how large its buttons are is `dense`. */
  readonly bar = input<WriterBarPosition>('bottom');

  /** A compact bar, for a pointer: every button 32px. Off, the bar keeps
      the app's 40/48px, for a finger. */
  readonly dense = input(false, { transform: booleanAttribute });

  /** What scrolls: `body` — the text alone, under the bar and the envelope
      held in place — or `sheet` — everything, so the bar sticks on top and
      the envelope scrolls away above the text as it is written (a phone,
      Gmail's; a document: the zoomed window, the composer page). The sheet
      scrolls where the writer owns the scroll: a `scrollOwner` on its own
      element, which the body (`EmailCompose`) inside hears too — one
      scroller, never two. */
  readonly #owner = inject(ScrollOwner, { self: true, optional: true });
  protected readonly scroll = computed<WriterScroll>(() =>
    this.#owner?.active() ? 'sheet' : 'body',
  );

  /** The bar heads the sheet, mirrored: Send at its end. */
  protected readonly barOnTop = computed(() => this.bar() === 'top');

  /** Send's tooltip opens away from the sheet's edge the bar sits on. */
  protected readonly tooltipPosition = computed<TooltipPosition>(() =>
    this.barOnTop() ? 'below' : 'above',
  );

  /** The submission is running — the transport has the message. */
  protected readonly submitting = computed(() => this.#root.fieldTree()().submitting());
}
