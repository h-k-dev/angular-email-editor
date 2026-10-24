import { NgTemplateOutlet } from '@angular/common';
import { Component, Injector, WritableSignal, inject } from '@angular/core';

// Angular Aria
import { Tab, TabContent, TabList, TabPanel, Tabs } from '@angular/aria/tabs';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogClose,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggle } from '@angular/material/slide-toggle';

// Angular Email Editor
import {
  ToggleButtonGroup,
  ToggleButtonGroupIcon,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { TranslatePipe } from '@ngx-translate/core';

import { Preferences } from '../../../../services/preferences';
import { OverflowRow } from '../../../common/overflow-row/overflow-row';
import { Viewport } from '../../../../services/viewport';
import { MessageSheet } from '../message-sheet';

/** Tells one opening of the settings from another: the dialog's id, which
    each row's label id is made from for its control. */
let nextSettingsId = 0;

/** The aside's sections, in order: one tab and one page each. */
const SECTIONS = [
  { id: 'personalization', icon: 'palette', label: 'composer.settings.sections.personalization' },
  { id: 'designer', icon: 'dashboard', label: 'composer.settings.sections.designer' },
  { id: 'writer', icon: 'edit_note', label: 'composer.settings.sections.writer' },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]['id'];

/** What the dialog opens with: the open section, its opener's to keep from
    one opening to the next. */
export interface MessageSettingsData {
  readonly section: WritableSignal<SettingsSection | undefined>;
}

/**
 * Opens the settings of the sheet `injector` sits on — it reads and sets
 * that sheet through DI, whichever it is. One fixed size (the
 * `.message-settings-pane`, styles.scss), the whole screen at the compact
 * width; Escape and a press on the backdrop close it, focus goes back to
 * where it was.
 */
export function openMessageSettings(
  injector: Injector,
  data: MessageSettingsData,
): MatDialogRef<MessageSettings> {
  const id = `message-settings-${nextSettingsId++}`;
  return injector.get(MatDialog).open<MessageSettings, MessageSettingsData>(MessageSettings, {
    id,
    ariaLabelledBy: `${id}-title`,
    injector,
    data,
    panelClass: 'message-settings-pane',
    // The pane's own size, never Material's 80vw cap.
    maxWidth: 'none',
  });
}

/**
 * The message's settings, in a dialog centred over the page
 * (`openMessageSettings`), Notion's and Linear's: a roomy frame of its own
 * (the whole screen at the compact width, the global `--dialog-*` tokens)
 * that scrolls inside, so
 * a setting added later fits the same frame. An aside of sections, each its own
 * page (Aria tabs — a row over the page at the compact width):
 * Personalization (the editor's theme), Designer (the HTML source's
 * word wrap) and Writer (the message's Format, the Layout — whether the layout blocks take their gestures, one
 * switch for every one of them — and the formatting toolbar). What cannot
 * apply stands disabled, never hidden. The email's settings only: the
 * app's own — its theme, its language — stay in the app's top bar.
 *
 * Two kinds of setting, told apart on the page: the {@link Preferences}
 * the email reads, which this browser keeps for every composer and every
 * tab, and the message's own (Format, Layout), which start over with the
 * next message.
 * Opened by the ⋮'s Settings… (`MessageMenu`, which holds it) — core's
 * Preferences…: the ⋮ is the bar's one entry to the message's options. On
 * either sheet: it reads and sets the sheet it was opened from, whichever
 * that is, through DI.
 *
 * A MatDialog: a global element in the overlay container on `<body>`, so
 * it wears the app's theme — never a sheet's paper island — and Escape
 * reaches no compose window on its way out. A pick is applied at once,
 * behind it; there is nothing to save.
 */
@Component({
  selector: 'message-settings',
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    MatIcon,
    MatIconButton,
    MatDialogClose,
    MatSlideToggle,
    Tabs,
    TabList,
    Tab,
    TabPanel,
    TabContent,
    ToggleButtonGroup,
    ToggleButtonGroupIcon,
    ToggleButtonGroupText,
    OverflowRow,
  ],
  templateUrl: './message-settings.html',
  styleUrl: './message-settings.scss',
})
export class MessageSettings {
  protected readonly sheet = inject(MessageSheet);
  protected readonly viewport = inject(Viewport);
  protected readonly preferences = inject(Preferences);

  protected readonly sections = SECTIONS;
  /** The open section — the opener's, kept from one opening to the next. */
  protected readonly section = inject<MessageSettingsData>(MAT_DIALOG_DATA).section;

  /** The dialog's id (`openMessageSettings`), which names its title. */
  readonly #id = inject(MatDialogRef).id;
  protected readonly titleId = `${this.#id}-title`;
  protected readonly formatLabelId = `${this.#id}-format`;
  protected readonly themeLabelId = `${this.#id}-theme`;
  protected readonly wrapLabelId = `${this.#id}-wrap`;
  protected readonly wrapHintId = `${this.#id}-wrap-hint`;
  protected readonly toolbarLabelId = `${this.#id}-toolbar`;
  protected readonly toolbarHintId = `${this.#id}-toolbar-hint`;
  protected readonly layoutLabelId = `${this.#id}-layout`;
  protected readonly layoutHintId = `${this.#id}-layout-hint`;
}
