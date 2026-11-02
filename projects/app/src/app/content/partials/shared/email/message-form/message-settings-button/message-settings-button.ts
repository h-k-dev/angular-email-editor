import { Component, DestroyRef, Injector, inject, input, signal } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import {
  MessageSettings,
  SettingsSection,
  openMessageSettings,
} from '../message-settings/message-settings';

/**
 * The bar's gear — the bar's one entry to the message's options, as core's
 * writer has it (`m-email-preferences-button`): a press opens the settings
 * dialog at once (`MessageSettings`, opened from here, closed with the
 * sheet) — the Theme, the Format and the Layout. No View here: the editor
 * and its HTML switch on the frame's own </> where it has one. On either
 * sheet: the settings it opens set the sheet it sits on, whichever that is,
 * through DI.
 */
@Component({
  selector: 'message-settings-button',
  imports: [TranslatePipe, MatIcon, MatIconButton, MatTooltip],
  templateUrl: './message-settings-button.html',
  host: { style: 'display: contents' },
})
export class MessageSettingsButton {
  readonly #injector = inject(Injector);

  /** The settings while open — one at a time. */
  #settings: MatDialogRef<MessageSettings> | null = null;
  /** The settings' open section, kept from one opening to the next. */
  readonly #section = signal<SettingsSection | undefined>('personalization');

  constructor() {
    // The settings go with the sheet they set.
    inject(DestroyRef).onDestroy(() => this.#settings?.close());
  }

  /** Which way the tooltip opens from the bar: away from the sheet's edge —
      up from a bar at the foot, down from one heading the sheet. */
  readonly side = input<'above' | 'below'>('above');

  protected open(): void {
    if (this.#settings) return;
    const settings = openMessageSettings(this.#injector, { section: this.#section });
    this.#settings = settings;
    settings.afterClosed().subscribe(() => (this.#settings = null));
  }
}
