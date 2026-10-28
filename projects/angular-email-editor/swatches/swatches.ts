import { InjectionToken, Provider, WritableSignal, signal } from '@angular/core';
import { parseCssColor, rgbaToHex } from '@h-k-dev/dawn';

/*
 * The user's custom swatches — the colours picked outside the palette,
 * offered again in every picker. Its own entry, with nothing of the editor
 * in it: an app provides the store in its root config
 * (`provideCustomSwatches`), and that must not load the editor at start.
 */

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

/** Remembers a custom colour as a swatch: first in its side, once, the
    oldest dropping past {@link CUSTOM_SWATCHES_MAX}. */
export function rememberSwatch(
  store: WritableSignal<CustomSwatches>,
  raw: string,
  role: 'text' | 'background',
): void {
  const color = parseCssColor(raw);
  const hex = color ? rgbaToHex(color) : null;
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
