import { Directive, TemplateRef, inject } from '@angular/core';
import { Attachment, AttachmentKind, AttachmentStatus } from './attachment';

/**
 * The chip's template slots. A host that wants its own icon or its own
 * progress readout hands the chip a template, and the chip renders it
 * inside the box it already sizes — so a Material icon, a font icon or a
 * custom SVG lands in the same 1em square the default glyph does, and the
 * stylesheet never has to reach into the host's markup.
 *
 *     <li email-attachment-chip [attachment]="file">
 *       <mat-icon *emailAttachmentIcon="let kind = kind" inline>
 *         {{ kind === 'pdf' ? 'picture_as_pdf' : 'attach_file' }}
 *       </mat-icon>
 *     </li>
 */

/** What the icon template is given: the attachment, and the kind the chip
    worked out from its MIME type. */
export interface AttachmentChipIconContext {
  readonly $implicit: Attachment;
  readonly kind: AttachmentKind;
}

/** Which progress the chip is drawing: a bar with a number, a sweep with
    none, the chip's own fake fill, or nothing yet while the transfer waits. */
export type AttachmentProgressMode = 'determinate' | 'indeterminate' | 'simulated' | 'queued';

/** What the progress template is given: the attachment and everything the
    chip knows about its transfer. `percent` is `progress` as a whole number
    of 0–100, clamped. */
export interface AttachmentChipProgressContext {
  readonly $implicit: Attachment;
  readonly status: AttachmentStatus | null;
  readonly progress: number | null;
  readonly percent: number;
  readonly mode: AttachmentProgressMode;
}

/**
 * The chip's icon slot: mark an `ng-template` with it (or use the `*`
 * shorthand on the element itself) and the chip renders it in place of the
 * default glyph, in the icon box. The box is `--email-attachment-chip-icon-size`
 * square and sets `font-size` and `color` to match, so a `mat-icon` with
 * `inline`, a font icon, or an SVG drawn at `1em` all fit without a rule.
 */
@Directive({ selector: 'ng-template[emailAttachmentIcon]' })
export class AttachmentChipIcon {
  readonly template = inject<TemplateRef<AttachmentChipIconContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: AttachmentChipIcon,
    context: unknown,
  ): context is AttachmentChipIconContext {
    return true;
  }
}

/**
 * The chip's progress slot: the readout in the trailing square, rendered
 * from the host's template instead of the default percentage. The bar along
 * the chip's edge and the scanning sweep stay the chip's — this replaces
 * only what the square shows.
 */
@Directive({ selector: 'ng-template[emailAttachmentProgress]' })
export class AttachmentChipProgress {
  readonly template = inject<TemplateRef<AttachmentChipProgressContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: AttachmentChipProgress,
    context: unknown,
  ): context is AttachmentChipProgressContext {
    return true;
  }
}
