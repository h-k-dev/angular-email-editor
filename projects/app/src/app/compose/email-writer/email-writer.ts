import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';

// Form
import { FormRoot } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

// Global
import { Viewport } from '../../viewport';

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
 * The bar has two places. On a phone it heads the sheet, above the envelope,
 * where the thumb and the eye start; wider, it closes the sheet under the
 * formatting toolbar, where the message ends and is sent.
 */
@Component({
  selector: 'form[email-writer]',
  imports: [
    NgTemplateOutlet,

    // Material
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  hostDirectives: [{ directive: FormRoot, inputs: ['formRoot'] }],
  templateUrl: './email-writer.html',
  styleUrl: './email-writer.scss',
})
export class EmailWriter {
  readonly #root = inject(FormRoot);

  /** The full-width breakpoint puts the bar on top; above it, at the bottom. */
  protected readonly viewport = inject(Viewport);

  /** The submission is running — the transport has the message. */
  protected readonly submitting = computed(() => this.#root.fieldTree()().submitting());
}
