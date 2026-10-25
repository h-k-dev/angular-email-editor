import {
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

import { TranslatePipe } from '@ngx-translate/core';

import { I18n } from '../../../../../../core/translations/i18n';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import {
  MessageSettings,
  SettingsSection,
  openMessageSettings,
} from '../message-settings/message-settings';

/** A pick in the ⋮: the settings dialog. */
type MessageMenuValue = 'settings';

/**
 * The bar's ⋮ — the bar's one entry to the message's options, as core's
 * writer has it: Settings… (core's Preferences…), a menu choice, so the
 * menu closes and the settings dialog opens (`MessageSettings`, opened from
 * here, closed with the menu) — the Theme, the Format and the Layout. No
 * View here: the editor and its HTML switch on the frame's own </> where it
 * has one. The button and its menu, on either sheet: the settings it opens
 * set the sheet it sits on, whichever that is, through DI.
 */
@Component({
  selector: 'message-menu',
  imports: [TranslatePipe, MatIcon, MatIconButton, MatTooltip, MenuTrigger, ToolbarMenu],
  templateUrl: './message-menu.html',
  host: { style: 'display: contents' },
})
export class MessageMenu {
  readonly #i18n = inject(I18n);
  readonly #injector = inject(Injector);

  /** The settings while open — one at a time. */
  #settings: MatDialogRef<MessageSettings> | null = null;
  /** The settings' open section, kept from one opening to the next. */
  readonly #section = signal<SettingsSection | undefined>('personalization');

  constructor() {
    // The settings go with the sheet they set.
    inject(DestroyRef).onDestroy(() => this.#settings?.close());
  }

  /** Which way the menu opens from the bar: away from the sheet's edge —
      up from a bar at the foot, down from one heading the sheet. */
  readonly side = input<'above' | 'below'>('above');

  /** Which end of the button it lines up with: the bar's near end. */
  readonly align = input<'start' | 'end'>('start');

  /** Settings…. */
  protected readonly items = computed<ToolbarMenuItem<MessageMenuValue>[]>(() => {
    this.#i18n.lang();
    return [{ value: 'settings', label: this.#i18n.t('composer.settings.open'), icon: 'settings' }];
  });

  protected onSelected(value: MessageMenuValue): void {
    if (value !== 'settings') return;
    // Once the menu has gone and handed focus back to the ⋮: the dialog
    // takes it from there, and gives it back to the ⋮ when it closes.
    afterNextRender({ write: () => this.#openSettings() }, { injector: this.#injector });
  }

  #openSettings(): void {
    if (this.#settings) return;
    const settings = openMessageSettings(this.#injector, { section: this.#section });
    this.#settings = settings;
    settings.afterClosed().subscribe(() => (this.#settings = null));
  }
}
