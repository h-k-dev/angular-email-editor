import { Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

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
import { HeightSwitch } from '../../../../../core/directives/height-switch/height-switch';
import { HoverLinger } from '../../../../../core/directives/hover-linger/hover-linger';
import { ScrollOwner } from '../../../../../core/directives/scroll-owner/scroll-owner';
import { OverflowRow } from '../../../common/overflow-row/overflow-row';
import { ActionTrigger } from '@h-k-dev/angular-email-editor/actions';
import { TranslatePipe } from '@ngx-translate/core';

import { Viewport } from '../../../../../core/layout/viewport';
import { Preferences } from '../../../../../core/storages/preferences';
import { DropHint } from '../../../common/drop-hint/drop-hint';
import { EmailCompose } from '../email-compose/email-compose';
import { EmailWriter } from '../email-writer/email-writer';
import { MarqueeStart } from '../paper-island';
import { EnvelopeRows, LabelGutter } from './envelope-rows/envelope-rows';
import { MessageMenu } from './message-menu/message-menu';
import { MessageSheet } from './message-sheet';

/** How a desktop sheet is laid out (`MessageForm.layout`). */
export type MessageLayout = 'sheet' | 'document';

/**
 * The desktop sheet: one message (`MessageSheet`) as a wide screen lays it
 * out — Gmail's compose. The envelope rows on top, the text under them
 * scrolling on its own, and at the foot, floating over the text, the
 * attachment strip, the formatting toolbar (off until asked for) and the
 * writer's bar with Send. A frame that is a document lays it out as one
 * instead (`layout`): the composer page, and a zoomed compose window — the
 * same sheet either way, so the page is the zoomed window on a whole screen.
 * A compose window opened on a wide screen holds one.
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
    OverflowRow,
    DotsMorph,
    HeightSwitch,
    HoverLinger,
    AttachmentChip,
    AttachmentChipIcon,
    AttachmentChipIconButton,
    SplitButton,
    SplitButtonLeading,
    SplitButtonTrailing,
    MatIcon,
    MatIconButton,
    MatTooltip,
    DropHint,
    AngularFileDrop,
    MarqueeStart,
    ScrollOwner,
    ActionTrigger,
  ],
  providers: [{ provide: MessageSheet, useExisting: MessageForm }],
  templateUrl: './message-form.html',
  styleUrl: './message-sheet.scss',
  host: { '[attr.data-layout]': 'layout()' },
})
export class MessageForm extends MessageSheet {
  /** How the sheet is laid out: a `sheet` — Gmail's compose, the bar at the
      foot under the text — or a `document`: the bar heading it, above From,
      and bar, envelope and text kept to one centred column of a long line's
      width on paper that runs edge to edge (message-sheet.scss). The
      document is what the composer page is, and what a compose window
      becomes zoomed: one layout, owned here, that either frame just takes. */
  readonly layout = input<MessageLayout>('sheet');

  /** Where the writer's bar sits: heading a document, at a sheet's foot. */
  protected readonly bar = computed(() => (this.layout() === 'document' ? 'top' : 'bottom'));

  /** The bar heads the sheet: its controls are laid out mirrored — Send at
      the end, Discard at the start. */
  protected readonly mirrored = computed(() => this.bar() === 'top');

  protected readonly barAtTop = this.mirrored;

  /** How a document's envelope shows its labels in the gutter
      (`EnvelopeRows.labelGutter`): under the pointer, and on the row focus
      is in (`hover`, Notion's) — or `always`. */
  readonly labelGutter = input<LabelGutter>('hover');

  /** The envelope's gutter, for a document on a desk only — a wide screen,
      whose margin beside the column has room for a label, and a pointer.
      Anywhere else none of it renders, and the rows keep their labels. */
  readonly #narrow = inject(Viewport).narrow;
  protected readonly envelopeGutter = computed(() =>
    this.layout() === 'document' && !this.#narrow() && !this.touch() ? this.labelGutter() : null,
  );

  override readonly toolbarSwitch = true;

  /** Whether the formatting toolbar is switched on (the writer bar's
      formatting options button, and the settings' Formatting toolbar). Off
      by default: the message is written first, and the marks have their
      keys, the bubble menu and the `/` menu; the bar is one press away when
      it is wanted. A {@link Preferences} one: every composer opens as the
      last one was left. */
  protected readonly formattingOpen = inject(Preferences).formattingToolbar;

  /** Whether the composer's formatting toolbar shows: switched on, for a
      message that has formatting. */
  protected readonly toolbarShown = computed(() => !this.plainText() && this.formattingOpen());
}
