import { Service, inject } from '@angular/core';

import type { EditorAppearance } from '../app/compose/message-form/message-sheet';
import { LANGUAGES } from '../i18n/loader';
import { LocalStorage, onOff, oneOf } from './local-storage';
import type { ThemeScheme } from './theme';

/** The app's theme as chosen: light or dark of its own, or the system's. */
export type ThemePreference = ThemeScheme | 'system';

/** Every preference's key starts so: the app's keys, apart from anything
    else on the origin. */
const PREFIX = 'angular-email-editor:';

/**
 * What the user chose, as two-way signals that survive a reload and reach
 * every tab of the app. The app's own — its theme and language — are
 * written by the top bar; the email's by the settings dialog's pages (an
 * email's settings only, never the app's) and the controls they mirror
 * (the writer bar's formatting button, Alt+Z in the source).
 *
 * Core's `LocalUserConfig`: one root registry, so every preference is
 * declared once, with its key, its words and its default, and read from
 * wherever it applies. A setting that belongs to one message — its Format,
 * its Layout switch — is not here: it starts over with the next message.
 *
 * Each signal reads its default while the key is unset, or holds something
 * this version does not know; picking the default removes the key again.
 */
@Service()
export class Preferences {
  readonly #storage = inject(LocalStorage);

  /** The app's theme — the top bar's toggle. Unset reads as `system`:
      the OS's light or dark, as it changes. */
  readonly theme = this.#storage.pairSignal(
    `${PREFIX}theme`,
    oneOf<ThemePreference>(['light', 'dark', 'system'], 'system'),
  );

  /** The language the app speaks — the top bar's picker. Unset reads as
      English, the code's own words. */
  readonly language = this.#storage.pairSignal(`${PREFIX}language`, oneOf(LANGUAGES, 'en'));

  /** How the editor looks — the settings' Theme, the same in every
      composer. Unset reads as `auto`: the app's theme. */
  readonly editorAppearance = this.#storage.pairSignal(
    `${PREFIX}editor-appearance`,
    oneOf<EditorAppearance>(['light', 'dark', 'auto'], 'auto'),
  );

  /** Whether a composer opens with its formatting toolbar — the writer
      bar's formatting button and the settings' Formatting toolbar. Unset
      reads as off: a message is written first, its marks have their keys. */
  readonly formattingToolbar = this.#storage.pairSignal(`${PREFIX}formatting-toolbar`, onOff(false));

  /** Whether long lines wrap in the HTML source — Alt+Z and the settings'
      Word wrap. Unset reads as on (VS Code's word wrap); off, a line stays
      one and the pane scrolls sideways. */
  readonly sourceWrap = this.#storage.pairSignal(`${PREFIX}source-wrap`, onOff(true));

  /** How many rows the attachment strip lays its chips in — its corner
      toggle. Unset reads as `one`: a single line, scrolled sideways. */
  readonly attachmentRows = this.#storage.pairSignal(
    `${PREFIX}attachment-rows`,
    oneOf(['one', 'two'], 'one'),
  );
}
