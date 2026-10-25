import { Component, computed, signal } from '@angular/core';

// Angular Signal Forms
import { FormField, FormRoot } from '@angular/forms/signals';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

// Angular File Drop
import { AngularFileDrop } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import { AddressDragGroup } from '@h-k-dev/angular-email-editor/address-input';
import {
  AttachmentChip,
  AttachmentChipIcon,
  AttachmentChipIconButton,
} from '@h-k-dev/angular-email-editor/attachment-chip';
import { AttachmentChips } from '@h-k-dev/angular-email-editor/attachment-chips';
import {
  SplitButton,
  SplitButtonLeading,
  SplitButtonTrailing,
} from '@h-k-dev/angular-email-editor/split-button';
import { DotsMorph } from '../../../common/dots-morph/dots-morph';
import { HeightSwitch } from '../../../../../core/common/directives/height-switch/height-switch';
import { HoverLinger } from '../../../../../core/common/directives/hover-linger/hover-linger';
import { FloatingScrollbar } from '../../../../../core/common/directives/floating-scrollbar/floating-scrollbar';
import { OverflowRow } from '../../../common/overflow-row/overflow-row';
import { ActionTrigger } from '@h-k-dev/angular-email-editor/actions';
import { TranslatePipe } from '@ngx-translate/core';

import { EmailCompose } from '../email-compose/email-compose';
import { EmailWriter } from '../email-writer/email-writer';
import { EnvelopeRows } from './envelope-rows/envelope-rows';
import { MessageMenu } from './message-menu/message-menu';
import { MessageSheet } from './message-sheet';

/**
 * The phone's sheet: one message (`MessageSheet`) as a phone lays it out —
 * the screen, with the keyboard taking half of it. The writer's bar heads
 * the sheet, mirrored (Send at the end, under the thumb), at the app's tap
 * size; the whole sheet scrolls, so the bar and the envelope rows go up and
 * away as the text grows and the text has what the keyboard leaves to
 * itself (Gmail's); the formatting toolbar is always there, stuck to the
 * bottom of the screen — on the keyboard — with the attachment strip over
 * it. No zoom, no source view, no formatting switch: none of them exist on
 * a phone.
 *
 * Chosen as a message opens on a phone (the page, a compose window), and
 * kept until it closes. The frame may put its own controls into the bar:
 * `leading` ones before Attach, `actions` ones after Discard.
 */
@Component({
  selector: 'div[mobile-message-form]',
  imports: [
    TranslatePipe,
    // Form
    FormField,
    FormRoot,

    // Components
    EmailWriter,
    EmailCompose,
    EnvelopeRows,
    MessageMenu,
    AddressDragGroup,
    AttachmentChips,
    OverflowRow,
    DotsMorph,
    HeightSwitch,
    HoverLinger,
    FloatingScrollbar,
    AttachmentChip,
    AttachmentChipIcon,
    AttachmentChipIconButton,
    SplitButton,
    SplitButtonLeading,
    SplitButtonTrailing,
    MatIcon,
    MatIconButton,
    MatTooltip,
    AngularFileDrop,
    ActionTrigger,
  ],
  providers: [{ provide: MessageSheet, useExisting: MobileMessageForm }],
  templateUrl: './mobile-message-form.html',
  styleUrl: './message-sheet.scss',
})
export class MobileMessageForm extends MessageSheet {
  /** The bar heads the phone's sheet. */
  protected readonly barAtTop = signal(true).asReadonly();

  /** What the composer's floating foot covers of the sheet's foot, px —
      the sheet's end scroll padding, as the stuck bar is its start's: a
      focused row stays clear of it, and so does the sheet's scrollbar. */
  protected readonly footRoom = computed(() => this.emailPane().footRoom());

  /** The strip starts put away: on a phone the text needs every line, and
      the attach button's toggle already says how many are attached. */
  override readonly attachmentsHidden = signal(true);
}
