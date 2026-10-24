import { Component, computed, inject, input } from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// Aria
import { MenuTrigger } from '@angular/aria/menu';
import { TranslatePipe } from '@ngx-translate/core';

import { AppLanguage } from '../../i18n/loader';
import { I18n } from '../../services/i18n';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../compose/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';

/** A language in its own words — a name is never translated: whoever looks
    for their language looks for it as they write it. */
const NAMES: Record<AppLanguage, string> = {
  en: 'English',
  ja: '日本語',
  de: 'Deutsch',
};

/**
 * The app's language picker: a plain icon button, named for the language in
 * use, that opens an Angular Aria menu of the others — radio items, since exactly one
 * is on. The menu is the app's own Aria menu (`toolbar-menu`), the one the
 * composer's font dropdowns use: one menu in the app, not two.
 */
@Component({
  selector: 'div[language-menu]',
  imports: [TranslatePipe, MatButtonModule, MatIconModule, MenuTrigger, ToolbarMenu],
  templateUrl: './language-menu.html',
  styleUrl: './language-menu.scss',
})
export class LanguageMenu {
  protected readonly i18n = inject(I18n);

  /** Where the menu opens from the button, and which edge it lines up with
      (the toolbar menu's own placement, flipped where there is no room). */
  readonly side = input<'above' | 'below'>('above');
  readonly align = input<'start' | 'end'>('end');

  /** The language in use, in its own words — the button's name. */
  protected readonly current = computed(() => NAMES[this.i18n.lang()]);

  protected readonly items = computed<ToolbarMenuItem<AppLanguage>[]>(() =>
    this.i18n.languages.map((language) => ({
      value: language,
      label: NAMES[language],
      kind: 'radio',
      checked: language === this.i18n.lang(),
    })),
  );

  protected use(language: AppLanguage): void {
    this.i18n.use(language);
  }
}
