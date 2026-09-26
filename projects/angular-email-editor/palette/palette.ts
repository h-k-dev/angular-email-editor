import { InjectionToken, Provider, inject } from '@angular/core';
import {
  ExtensionContext,
  PaletteColor,
  SuggestionCommandItem,
  emailBackgroundPalette,
  emailTextPalette,
} from 'angular-email-editor';

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
  return [
    ...rows(palette.text, 'color', (value) => setColor(value)),
    ...rows(palette.background, 'background', (value) => setBackground(value)),
  ];
}
