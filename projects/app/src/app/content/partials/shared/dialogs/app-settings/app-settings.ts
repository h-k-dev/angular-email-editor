import { NgTemplateOutlet } from '@angular/common';
import { Component, Injector, WritableSignal, computed, inject } from '@angular/core';

// Angular Aria
import { Tab, TabContent, TabList, TabPanel, Tabs } from '@angular/aria/tabs';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogClose, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';

// Angular Email Editor
import {
  ToggleButtonGroup,
  ToggleButtonGroupIcon,
  ToggleButtonGroupText,
} from '@h-k-dev/angular-email-editor/toggle-button-group';
import { TranslatePipe } from '@ngx-translate/core';

import { largeDialog } from '../../../../../core/layout/dialogs';
import { MIN_DURATIONS, Preferences } from '../../../../../core/storages/preferences';
import { Viewport } from '../../../../../core/layout/viewport';
import { Theme } from '../../../../../core/theme/theme';
import { I18n } from '../../../../../core/translations/i18n';
import { Region, RegionCode } from '../../../../../core/translations/region';
import { LANGUAGE_NAMES } from '../../../common/language-menu/language-menu';
import { OverflowRow } from '../../../common/overflow-row/overflow-row';

/** Tells one opening of the settings from another: the dialog's id, which
    each row's label id is made from for its control. */
let nextSettingsId = 0;

/** The aside's sections, in order: one tab and one page each. */
const SECTIONS = [
  { id: 'appearance', icon: 'palette', label: 'app.settings.sections.appearance' },
  { id: 'language', icon: 'translate', label: 'app.settings.sections.language' },
  { id: 'calendar', icon: 'calendar_month', label: 'app.settings.sections.calendar' },
] as const;

export type AppSettingsSection = (typeof SECTIONS)[number]['id'];

/** What the dialog opens with: the open section, its opener's to keep from
    one opening to the next. */
export interface AppSettingsData {
  readonly section: WritableSignal<AppSettingsSection | undefined>;
}

/**
 * Opens the app's settings: a large dialog (`largeDialog`), the whole
 * screen at the compact width; Escape and a press on the backdrop close
 * it, focus goes back to where it was.
 */
export function openAppSettings(
  injector: Injector,
  data: AppSettingsData,
): MatDialogRef<AppSettings> {
  const id = `app-settings-${nextSettingsId++}`;
  return injector.get(MatDialog).open<AppSettings, AppSettingsData>(AppSettings, {
    id,
    ariaLabelledBy: `${id}-title`,
    injector,
    data,
    ...largeDialog('app-settings-pane'),
  });
}

/**
 * The app's settings — never the email's (those are the composer's own
 * dialog, `MessageSettings`, in the same frame): Appearance (the app's
 * theme — System, the default, Light or Dark), Language, and Calendar (its
 * region — apart from the language — and an event's minimum duration). Opened from the
 * mailbox aside's foot. Every pick applies at once, behind it, and this
 * browser keeps it ({@link Preferences}); there is nothing to save.
 */
@Component({
  selector: 'app-settings',
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    MatIcon,
    MatIconButton,
    MatDialogClose,
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
  templateUrl: './app-settings.html',
  styleUrl: './app-settings.scss',
})
export class AppSettings {
  protected readonly viewport = inject(Viewport);
  protected readonly theme = inject(Theme);
  protected readonly i18n = inject(I18n);
  protected readonly region = inject(Region);
  protected readonly minDuration = inject(Preferences).calendarMinDuration;
  protected readonly minDurations = MIN_DURATIONS;

  protected readonly sections = SECTIONS;
  protected readonly languageNames = LANGUAGE_NAMES;
  /** The open section — the opener's, kept from one opening to the next. */
  protected readonly section = inject<AppSettingsData>(MAT_DIALOG_DATA).section;

  /** The dialog's id (`openAppSettings`), which names its title. */
  readonly #id = inject(MatDialogRef).id;
  protected readonly titleId = `${this.#id}-title`;
  protected readonly themeLabelId = `${this.#id}-theme`;
  protected readonly languageLabelId = `${this.#id}-language`;
  protected readonly regionLabelId = `${this.#id}-region`;
  protected readonly minDurationLabelId = `${this.#id}-min-duration`;

  /** Each region by its name in the app's language — the region and the
      language are two settings, but the words are always the language's. */
  protected readonly regionNames = computed<Record<RegionCode, string>>(() => {
    const names = new Intl.DisplayNames([this.i18n.lang()], { type: 'region' });
    return Object.fromEntries(
      this.region.regions.map((code) => [code, names.of(code) ?? code]),
    ) as Record<RegionCode, string>;
  });
}
