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

import { MessageSheet } from '../message-sheet';

/** Tells the settings on one page apart: each row's label needs an id of
    its own for its control. */
let nextSettingsId = 0;

/**
 * The bar's ⚙ — the message's settings, in a dialog centred over the page,
 * Notion's and Slack's: one fixed size (the global `--dialog-*` tokens,
 * the whole screen at the compact width) that scrolls inside, so a group
 * added later fits the same frame. One view, its groups stacked: the
 * editor's Appearance, the Message (its Format), and the Layout — whether
 * the layout blocks take their gestures, one switch for every one of
 * them. What cannot apply stands disabled, never hidden.
 * The View is the ⋮'s (`MessageMenu`). The button and its dialog, on
 * either sheet: it reads and sets the sheet it sits on, whichever that is,
 * through DI.
 *
 * A native modal `<dialog>`: the top layer puts it over everything, the
 * browser makes the page behind it inert and hands focus back on close. A
 * global element, so it lives on `<body>` (moved there once rendered,
 * taken away with the button): it wears the app's theme by plain
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

  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** Whether the dialog is up — for the button's `aria-expanded`. */
  protected readonly opened = signal(false);

  readonly #id = `message-settings-${nextSettingsId++}`;
  protected readonly dialogId = this.#id;
  protected readonly titleId = `${this.#id}-title`;
  protected readonly formatLabelId = `${this.#id}-format`;
  protected readonly themeLabelId = `${this.#id}-theme`;
  protected readonly layoutLabelId = `${this.#id}-layout`;
  protected readonly layoutHintId = `${this.#id}-layout-hint`;

  constructor() {
    // Out of the sheet, onto <body>, once rendered — and gone with the
    // button: the view only takes its host away, and the dialog is no
    // longer in it.
    const body = inject(DOCUMENT).body;
    afterNextRender({ write: () => body.appendChild(this.dialog().nativeElement) });
    inject(DestroyRef).onDestroy(() => this.dialog().nativeElement.remove());
  }

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    dialog.showModal();
    this.opened.set(true);
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
