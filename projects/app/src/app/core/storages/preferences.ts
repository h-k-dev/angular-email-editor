import { Service, inject } from '@angular/core';

import type { EditorAppearance } from '../../content/partials/shared/email/message-form/message-sheet';
import { LANGUAGES } from '../../../i18n/loader';
import type { CustomSwatches } from '@h-k-dev/angular-email-editor/swatches';
import { LocalStorage, StorageCodec, onOff, oneOf, wholeIn } from './local-storage';
import type { ThemeScheme } from '../theme/theme';

/** The app's theme as chosen: light or dark of its own, or the system's. */
export type ThemePreference = ThemeScheme | 'system';

/** Every preference's key starts so: the app's keys, apart from anything
    else on the origin. */
const PREFIX = 'angular-email-editor:';

/** How narrow the inbox's list may be dragged, px: a row's least — the
    40px avatar, the five 28px quick actions a hovered row shows (156px),
    their insets and the scrollbar's gutter, and still ~90px of the
    sender's name beside them. How wide a width may be kept is a sanity
    bound, not a layout one: what really stops the list is the message
    beside it, which keeps {@link INBOX_READER_MIN}. */
export const INBOX_LIST_MIN = 360;
export const INBOX_LIST_MAX = 4000;

/** The list's width until its divider is dragged, px. */
export const INBOX_LIST_DEFAULT = 400;

/** What the open message keeps at least, px, however far the list is
    dragged — the email renders no narrower than this. */
export const INBOX_READER_MIN = 720;

/** How narrow the snippets' list may be dragged, px: a name and a line of
    its words beside the scrollbar's gutter. Its sanity bound and default
    are the inbox list's. */
export const SNIPPET_LIST_MIN = 280;

/** What the open snippet keeps at least, px: the editor's column (600)
    and its insets. */
export const SNIPPET_EDITOR_MIN = 640;

/** What the template designer's editor keeps at least, px, however far
    either pane beside it is dragged: the email's 720px column — an email
    wider than that scrolls in it. */
export const DESIGNER_EDITOR_MIN = 720;

/** How narrow the designer's preview may be dragged, px: the phone — its
    375px screen and 12px bezel either side — and 24px round it. How wide
    is a sanity bound: what stops it is the editor's least. Unset, it is
    as narrow as it goes. */
export const DESIGNER_PREVIEW_MIN = 448;
export const DESIGNER_PREVIEW_MAX = 1200;

/** How narrow the designer's details may be dragged, px: an address row's
    label beside a short address; their width until dragged — a whole
    address on one line — and a sanity bound. */
export const DESIGNER_DETAILS_MIN = 320;
export const DESIGNER_DETAILS_MAX = 1200;
export const DESIGNER_DETAILS_DEFAULT = 420;

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

  /** The colours picked outside the palette — every picker's "Custom …
      color" row — newest first, offered again as swatches. Unset reads as
      none. */
  readonly customSwatches = this.#storage.pairSignal(`${PREFIX}custom-swatches`, swatchLists());

  /** Whether a composer opens with its formatting toolbar — the writer
      bar's formatting button and the settings' Formatting toolbar. Unset
      reads as off: a message is written first, its marks have their keys. */
  readonly formattingToolbar = this.#storage.pairSignal(
    `${PREFIX}formatting-toolbar`,
    onOff(false),
  );

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

  /** Whether the mailbox aside shows its Designer run — the templates.
      Unset reads as shown. */
  readonly asideDesignerOpen = this.#storage.pairSignal(
    `${PREFIX}aside-designer-open`,
    onOff(true),
  );

  /** Whether the mailbox aside shows its Developers run, the API
      reference's pages under its row, the styling reference's, the
      components' and the utilities' — each folds its own. Unset reads as
      shown. */
  readonly asideDevelopersOpen = this.#storage.pairSignal(
    `${PREFIX}aside-developers-open`,
    onOff(true),
  );
  readonly asideApiOpen = this.#storage.pairSignal(`${PREFIX}aside-api-open`, onOff(true));
  readonly asideStylingOpen = this.#storage.pairSignal(`${PREFIX}aside-styling-open`, onOff(true));
  readonly asideComponentsOpen = this.#storage.pairSignal(
    `${PREFIX}aside-components-open`,
    onOff(true),
  );
  readonly asideUtilitiesOpen = this.#storage.pairSignal(
    `${PREFIX}aside-utilities-open`,
    onOff(true),
  );

  /** How wide the inbox's list is, px — its divider, dragged. Unset — or
      kept from before the least grew — reads as {@link INBOX_LIST_DEFAULT}. */
  readonly inboxListWidth = this.#storage.pairSignal(
    `${PREFIX}inbox-list-width`,
    wholeIn(INBOX_LIST_MIN, INBOX_LIST_MAX, INBOX_LIST_DEFAULT),
  );

  /** How wide the template designer's preview is, px — its divider,
      dragged. */
  readonly designerPreviewWidth = this.#storage.pairSignal(
    `${PREFIX}designer-preview-width`,
    wholeIn(DESIGNER_PREVIEW_MIN, DESIGNER_PREVIEW_MAX, DESIGNER_PREVIEW_MIN),
  );

  /** How wide the template designer's details are, px — their divider,
      dragged. */
  readonly designerDetailsWidth = this.#storage.pairSignal(
    `${PREFIX}designer-details-width`,
    wholeIn(DESIGNER_DETAILS_MIN, DESIGNER_DETAILS_MAX, DESIGNER_DETAILS_DEFAULT),
  );

  /** How wide the snippets' list is, px — its divider, dragged. */
  readonly snippetListWidth = this.#storage.pairSignal(
    `${PREFIX}snippet-list-width`,
    wholeIn(SNIPPET_LIST_MIN, INBOX_LIST_MAX, INBOX_LIST_DEFAULT),
  );
}

/** The custom swatches as storage keeps them: JSON of two lists of
    `#rrggbb` — anything else reads as none, and none is no key. */
function swatchLists(): StorageCodec<CustomSwatches> {
  const NONE: CustomSwatches = { text: [], background: [] };
  const hexes = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v))
      : [];
  return {
    read: (raw) => {
      if (!raw) return NONE;
      try {
        const value = JSON.parse(raw) as Partial<CustomSwatches>;
        return { text: hexes(value.text), background: hexes(value.background) };
      } catch {
        return NONE;
      }
    },
    write: (value) =>
      value.text.length || value.background.length ? JSON.stringify(value) : null,
  };
}
