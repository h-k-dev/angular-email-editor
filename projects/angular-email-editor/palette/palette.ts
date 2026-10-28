import {
  InjectionToken,
  Provider,
  Signal,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ExtensionContext,
  PaletteColor,
  SuggestionCommandItem,
  cssColorToHex,
  emailBackgroundPalette,
  emailTextPalette,
} from '@h-k-dev/angular-email-editor';

/** The colours a host offers: for text, and for a background. */
export interface EmailPalette {
  readonly text: readonly PaletteColor[];
  readonly background: readonly PaletteColor[];
}

/** The library's own palette — the swatches that pass on both a light and a
    dark client (`emailTextPalette`, `emailBackgroundPalette`). */
export const emailPalette: EmailPalette = {
  text: emailTextPalette,
  background: emailBackgroundPalette,
};

/** A host's palette: either list, the other staying the library's — or a
    function of the library's palette, to mix: keep it and add a brand
    colour, take a few out, replace one side. */
export type EmailPaletteConfig =
  Partial<EmailPalette> | ((defaults: EmailPalette) => Partial<EmailPalette>);

/**
 * The palette in use — the library's unless a host provides its own
 * ({@link providePalette}). What the colour pickers offer and what the `/`
 * menu's colour rows are made of ({@link colorSuggestions}).
 */
export const EMAIL_PALETTE = new InjectionToken<EmailPalette>('EMAIL_PALETTE', {
  providedIn: 'root',
  factory: () => emailPalette,
});

/** The palette a config comes to, over the library's. */
export function resolvePalette(config: EmailPaletteConfig): EmailPalette {
  const given = typeof config === 'function' ? config(emailPalette) : config;
  return {
    text: given.text ?? emailPalette.text,
    background: given.background ?? emailPalette.background,
  };
}

/**
 * Makes a palette the app's — in `appConfig.providers`, or a component's:
 *
 *     providePalette({ text: BRAND_TEXT_COLORS })
 *     providePalette((defaults) => ({
 *       text: [...defaults.text, { name: 'Brand', value: '#0a5c36' }],
 *     }))
 *
 * Every colour goes into an email as written: keep to what a client shows
 * on both a light and a dark page (`passesDualContrast`).
 */
export function providePalette(config: EmailPaletteConfig): Provider {
  return { provide: EMAIL_PALETTE, useFactory: () => resolvePalette(config) };
}

/** The palette in use, in an injection context. */
export function injectPalette(): EmailPalette {
  return inject(EMAIL_PALETTE);
}

/** The word a colour's name becomes in an id: lowercased, spaces as hyphens. */
const slug = (name: string): string => name.trim().toLowerCase().split(/\s+/).join('-');

/**
 * The palette as rows of a `/` menu, the way a chat's slash menu lists
 * colours: "Red text", "Red background" — one row per colour of either
 * side, in the section `color`, each carrying its `swatch`. Picked, a row
 * colours the selection, or what is typed next at a bare caret (the
 * `TextStyle` mark's `setColor` / `setBackgroundColor`); nothing, when the
 * kit has no `TextStyle`.
 *
 *     items: (ctx) => [...extensionSuggestions(ctx), ...colorSuggestions(ctx, palette)]
 */
export function colorSuggestions(
  ctx: ExtensionContext,
  palette: EmailPalette,
  customs: CustomSwatches = { text: [], background: [] },
): SuggestionCommandItem[] {
  const textStyle = ctx.extensions.find((extension) => extension.name === 'textStyle');
  const commands = textStyle?.commands?.(ctx);
  const setColor = commands?.['setColor'];
  const setBackground = commands?.['setBackgroundColor'];
  if (!setColor || !setBackground) return [];
  const rows = (
    colors: readonly PaletteColor[],
    kind: 'color' | 'background',
    run: (value: string) => SuggestionCommandItem['command'],
  ): SuggestionCommandItem[] =>
    colors.map((color) => ({
      id: `${kind}-${slug(color.name)}`,
      title: kind === 'color' ? `${color.name} text` : `${color.name} background`,
      keywords: ['color', 'colour', kind === 'color' ? 'text' : 'highlight', color.name],
      section: 'color',
      swatch: color.value,
      command: run(color.value),
    }));
  // The user's custom swatches, after the palette's: named for what they
  // are ("Custom text color"), the swatch saying which.
  const custom = (
    hexes: readonly string[],
    kind: 'color' | 'background',
    run: (value: string) => SuggestionCommandItem['command'],
  ): SuggestionCommandItem[] => {
    const known = new Set(
      (kind === 'color' ? palette.text : palette.background).map((c) => c.value.toLowerCase()),
    );
    return hexes
      .filter((hex) => !known.has(hex))
      .map((hex) => ({
        id: `${kind}-custom-${hex.slice(1)}`,
        title: kind === 'color' ? 'Custom text color' : 'Custom background color',
        keywords: ['color', 'colour', 'custom', kind === 'color' ? 'text' : 'highlight', hex],
        section: 'color',
        swatch: hex,
        command: run(hex),
      }));
  };
  return [
    ...rows(palette.text, 'color', (value) => setColor(value)),
    ...custom(customs.text, 'color', (value) => setColor(value)),
    ...rows(palette.background, 'background', (value) => setBackground(value)),
    ...custom(customs.background, 'background', (value) => setBackground(value)),
  ];
}

/** The colours a user picked outside the palette (a "Custom … color" row),
    newest first — offered as swatches after the palette's own, the way a
    document editor keeps its custom row. */
export interface CustomSwatches {
  readonly text: readonly string[];
  readonly background: readonly string[];
}

/** How many custom colours each side keeps — the oldest go first. */
export const CUSTOM_SWATCHES_MAX = 10;

/**
 * Where a user's custom swatches live: in memory by default (gone with the
 * page); a host keeps them — per user, in its preferences — with
 * {@link provideCustomSwatches}.
 */
export const EMAIL_CUSTOM_SWATCHES = new InjectionToken<WritableSignal<CustomSwatches>>(
  'EMAIL_CUSTOM_SWATCHES',
  { providedIn: 'root', factory: () => signal<CustomSwatches>({ text: [], background: [] }) },
);

/** Keeps the custom swatches where the host says — a signal over its own
    storage, made in an injection context:

        provideCustomSwatches(() => inject(Preferences).customSwatches) */
export function provideCustomSwatches(store: () => WritableSignal<CustomSwatches>): Provider {
  return { provide: EMAIL_CUSTOM_SWATCHES, useFactory: store };
}

/**
 * The colours a picker offers: the palette in use, then the user's custom
 * swatches. Live: a colour remembered shows at once.
 */
export function injectSwatches(): Signal<EmailPalette> {
  const palette = injectPalette();
  const customs = inject(EMAIL_CUSTOM_SWATCHES);
  return computed(() => {
    const add = (
      list: readonly PaletteColor[],
      hexes: readonly string[],
      role: 'text' | 'background',
    ): PaletteColor[] => {
      const known = new Set(list.map((color) => color.value.toLowerCase()));
      return [
        ...list,
        ...hexes
          .filter((hex) => !known.has(hex))
          .map((hex) => ({
            name: role === 'text' ? 'Custom text color' : 'Custom background color',
            value: hex,
          })),
      ];
    };
    const { text, background } = customs();
    return {
      ...palette,
      text: add(palette.text, text, 'text'),
      background: add(palette.background, background, 'background'),
    };
  });
}

/** Whether a colour is the palette's own — false for a custom one. */
export function isPaletteColor(
  palette: EmailPalette,
  raw: string,
  role: 'text' | 'background',
): boolean {
  const hex = cssColorToHex(raw);
  const list = role === 'text' ? palette.text : palette.background;
  return !!hex && list.some((color) => color.value.toLowerCase() === hex);
}

/** Remembers a custom colour as a swatch: first in its side, once, the
    oldest dropping past {@link CUSTOM_SWATCHES_MAX}. */
export function rememberSwatch(
  store: WritableSignal<CustomSwatches>,
  raw: string,
  role: 'text' | 'background',
): void {
  const hex = cssColorToHex(raw);
  if (!hex) return;
  store.update((swatches) => {
    const key = role === 'text' ? 'text' : 'background';
    const next = [hex, ...swatches[key].filter((value) => value !== hex)].slice(
      0,
      CUSTOM_SWATCHES_MAX,
    );
    return { ...swatches, [key]: next };
  });
}
