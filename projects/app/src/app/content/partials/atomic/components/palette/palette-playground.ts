import { Component, computed, signal } from '@angular/core';
import {
  DAWN_SURFACE,
  DUAL_CONTRAST_DARK,
  DUAL_CONTRAST_LIGHT,
  PaletteColor,
  contrastRatio,
  cssColorToHex,
  dawnDarkColor,
  fillTextColor,
  passesDualBackground,
  passesDualContrast,
} from '@h-k-dev/angular-email-editor';
import { resolvePalette } from '@h-k-dev/angular-email-editor/palette';

import { Playground, PlaygroundAction, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** A swatch as the stage draws it: the colour, as Dawn draws it dark, and
    how it fares against the rule. */
interface Swatch {
  readonly name: string;
  readonly value: string;
  readonly dark: string;
  readonly passes: boolean;
  readonly exception: string | null;
  /** The text a fill is written in, light and dark. */
  readonly ink: string;
  readonly darkInk: string;
}

const ratio = (a: string, b: string) => Math.round(contrastRatio(a, b) * 10) / 10;

/**
 * The palette in use — the library's, or a host's over it (`resolvePalette`,
 * what `providePalette` provides): every text colour on a light and a dark
 * page, every fill under its text — dark as Dawn draws it, the one dark
 * there is — the rule it passes or the exception on record. The brand colour knob adds one of the
 * host's own and says whether it would pass.
 */
@Component({
  selector: 'palette-playground',
  imports: [PlaygroundFrame],
  templateUrl: './palette-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './palette-playground.scss'],
  providers: [Playground],
})
export class PalettePlayground {
  readonly brand = signal('#0a5c36');
  readonly addBrand = signal(true);

  protected readonly light = DUAL_CONTRAST_LIGHT;
  protected readonly darkPage = DAWN_SURFACE.dark;

  /** The brand colour as `#rrggbb`, or null when it is no colour. */
  protected readonly brandHex = computed(() => cssColorToHex(this.brand().trim()));

  protected readonly palette = computed(() => {
    const hex = this.brandHex();
    return resolvePalette((defaults) =>
      this.addBrand() && hex
        ? {
            text: [...defaults.text, { name: 'Brand', value: hex }],
            background: [...defaults.background, { name: 'Brand', value: hex }],
          }
        : {},
    );
  });

  protected readonly text = computed(() =>
    this.palette().text.map((color) => this.#swatch(color, passesDualContrast(color.value))),
  );
  protected readonly background = computed(() =>
    this.palette().background.map((color) =>
      this.#swatch(color, passesDualBackground(color.value)),
    ),
  );

  protected readonly value = computed(() => {
    const hex = this.brandHex();
    return {
      text: this.palette().text.length,
      background: this.palette().background.length,
      brand: hex
        ? {
            hex,
            onLight: ratio(hex, DUAL_CONTRAST_LIGHT),
            onDark: ratio(hex, DUAL_CONTRAST_DARK),
            passesDualContrast: passesDualContrast(hex),
            passesDualBackground: passesDualBackground(hex),
          }
        : 'not a colour',
    };
  });

  protected readonly knobs = [
    knob.text('brand colour', this.brand),
    knob.boolean('providePalette: add brand', this.addBrand),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'a brand that passes', run: () => this.brand.set('#0a7d4f') },
    { name: 'one that fails', run: () => this.brand.set('#00205b') },
  ];

  #swatch(color: PaletteColor, passes: boolean): Swatch {
    const ink = fillTextColor(color.value);
    return {
      name: color.name,
      value: color.value,
      dark: dawnDarkColor(color.value),
      passes,
      exception: color.exception ?? null,
      ink,
      darkInk: dawnDarkColor(ink),
    };
  }
}
