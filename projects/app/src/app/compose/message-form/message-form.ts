import { Component, computed, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

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
import { ActionTrigger } from '@h-k-dev/angular-email-editor/actions';
import { TranslatePipe } from '@ngx-translate/core';

import { DropHint } from '../drop-hint/drop-hint';
import { EmailCompose } from '../email-compose/email-compose';
import { EmailWriter, WriterBarPosition } from '../email-writer/email-writer';
import { MarqueeStart } from '../paper-island';
import { EnvelopeRows } from './envelope-rows/envelope-rows';
import { MessageMenu } from './message-menu/message-menu';
import { MessageSheet } from './message-sheet';

/**
 * The desktop sheet: one message (`MessageSheet`) as a wide screen lays it
 * out — Gmail's compose. The envelope rows on top, the text under them
 * scrolling on its own, and at the foot, floating over the text, the
 * attachment strip, the formatting toolbar (off until asked for) and the
 * writer's bar with Send. A frame that is a document heads the sheet with
 * the bar instead (`bar`: the zoomed window). The composer page docks panes
 * around one of these; a compose window opened on a wide screen holds one.
 *
 * The frame may put its own controls into the writer's bar: `leading` ones
 * after the formatting switch, `actions` ones before Discard.
 */
@Component({
  selector: 'div[message-form]',
  imports: [
    TranslatePipe,
    NgTemplateOutlet,
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
    AttachmentChip,
    AttachmentChipIcon,
    MatIcon,
    MatIconButton,
    DropHint,
    AngularFileDrop,
    MarqueeStart,
    ActionTrigger,
  ],
  providers: [{ provide: MessageSheet, useExisting: MessageForm }],
  templateUrl: './message-form.html',
  styleUrl: './message-sheet.scss',
})
export class MessageForm extends MessageSheet {
  /** Where the writer's bar sits: at the foot, under the text — or heading
      the sheet, for a frame that is a document (the zoomed window). */
  readonly bar = input<WriterBarPosition>('bottom');

  /** The bar heads the sheet: its controls are laid out mirrored — Send at
      the end, Discard at the start. */
  protected readonly mirrored = computed(() => this.bar() === 'top');

  /** Whether the formatting toolbar is switched on (the writer bar's
      formatting options button). Off by default: the message is written
      first, and the marks have their keys, the bubble menu and the `/`
      menu; the bar is one press away when it is wanted. */
  protected readonly formattingOpen = signal(false);

  /** Whether the composer's formatting toolbar shows: switched on, for a
      message that has formatting. */
  protected readonly toolbarShown = computed(() => !this.plainText() && this.formattingOpen());
}
