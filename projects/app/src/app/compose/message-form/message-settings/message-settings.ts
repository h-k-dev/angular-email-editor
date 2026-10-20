import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';

// Angular Aria
import { Tab, TabList, TabPanel, Tabs } from '@angular/aria/tabs';

// Angular Material
import { MatIconButton } from '@angular/material/button';
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
import { Viewport } from '../../../../services/viewport';
import { MessageSheet } from '../message-sheet';

/** Tells the settings on one page apart: each row's label needs an id of
    its own for its control. */
let nextSettingsId = 0;

/** The aside's sections, in order: one tab and one page each. */
const SECTIONS = [
  { id: 'personalization', icon: 'palette', label: 'composer.settings.sections.personalization' },
  { id: 'designer', icon: 'dashboard', label: 'composer.settings.sections.designer' },
  { id: 'writer', icon: 'edit_note', label: 'composer.settings.sections.writer' },
] as const;

type SettingsSection = (typeof SECTIONS)[number]['id'];

/**
 * The message's settings, in a dialog centred over the page,
 * Notion's and Linear's: a roomy frame of its own (the whole screen at the
 * compact width, the global `--dialog-*` tokens) that scrolls inside, so
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
 * either sheet: it reads and sets the sheet it sits on, whichever that is,
 * through DI.
 *
 * A native modal `<dialog>`: the top layer puts it over everything, the
 * browser makes the page behind it inert and hands focus back on close. A
 * global element, so it lives on `<body>` (moved there once rendered,
 * taken away with its menu): it wears the app's theme by plain
 * inheritance — never a sheet's paper island — and Escape reaches no
 * compose window on its way out. A pick is applied at once, behind it;
 * there is nothing to save.
 */
@Component({
  selector: 'message-settings',
  imports: [
    TranslatePipe,
    MatIcon,
    MatIconButton,
    MatSlideToggle,
    Tabs,
    TabList,
    Tab,
    TabPanel,
    ToggleButtonGroup,
    ToggleButtonGroupIcon,
    ToggleButtonGroupText,
  ],
  templateUrl: './message-settings.html',
  styleUrl: './message-settings.scss',
  host: { style: 'display: contents' },
})
export class MessageSettings {
  protected readonly sheet = inject(MessageSheet);
  protected readonly viewport = inject(Viewport);
  protected readonly preferences = inject(Preferences);

  protected readonly sections = SECTIONS;
  /** The open section — kept from one opening to the next. */
  protected readonly section = signal<SettingsSection | undefined>('personalization');

  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly #id = `message-settings-${nextSettingsId++}`;
  protected readonly dialogId = this.#id;
  protected readonly titleId = `${this.#id}-title`;
  protected readonly formatLabelId = `${this.#id}-format`;
  protected readonly themeLabelId = `${this.#id}-theme`;
  protected readonly wrapLabelId = `${this.#id}-wrap`;
  protected readonly wrapHintId = `${this.#id}-wrap-hint`;
  protected readonly toolbarLabelId = `${this.#id}-toolbar`;
  protected readonly toolbarHintId = `${this.#id}-toolbar-hint`;
  protected readonly layoutLabelId = `${this.#id}-layout`;
  protected readonly layoutHintId = `${this.#id}-layout-hint`;

  constructor() {
    // Out of the sheet, onto <body>, once rendered — and gone with its
    // menu: the view only takes its host away, and the dialog is no longer
    // in it.
    const body = inject(DOCUMENT).body;
    afterNextRender({ write: () => body.appendChild(this.dialog().nativeElement) });
    inject(DestroyRef).onDestroy(() => this.dialog().nativeElement.remove());
  }

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    dialog.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  /** A press on the backdrop — the dialog element itself, round the panel
      that fills it — closes, as Escape does. */
  protected onPress(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }
}
