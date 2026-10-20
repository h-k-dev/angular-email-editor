import { Component } from '@angular/core';

// Angular Signal Forms
import { FormField, FormRoot } from '@angular/forms/signals';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Angular File Drop
import { AngularFileDrop } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import { AddressDragGroup } from '@h-k-dev/angular-email-editor/address-input';
import { AttachmentChip, AttachmentChipIcon } from '@h-k-dev/angular-email-editor/attachment-chip';
import { AttachmentChips } from '@h-k-dev/angular-email-editor/attachment-chips';
import { OverflowRow } from '../../common/overflow-row/overflow-row';
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
    AttachmentChip,
    AttachmentChipIcon,
    MatIcon,
    MatIconButton,
    AngularFileDrop,
    ActionTrigger,
  ],
  providers: [{ provide: MessageSheet, useExisting: MobileMessageForm }],
  templateUrl: './mobile-message-form.html',
  styleUrl: './message-sheet.scss',
})
export class MobileMessageForm extends MessageSheet {}
