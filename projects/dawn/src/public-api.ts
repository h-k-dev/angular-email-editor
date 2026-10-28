/*
 * Public API Surface of @h-k-dev/dawn — the email render engine, with no
 * framework in it: every function needs only a DOM (a browser's, or on a
 * server linkedom / happy-dom / jsdom set as the globals).
 */

export type { DawnScheme, Rgba } from './lib/color';
export {
  DAWN_SURFACE,
  dawnDarkColor,
  invertLightness,
  parseCssColor,
  rgbaToCss,
  rgbaToHex,
} from './lib/color';
export * from './lib/css';
export * from './lib/render';
export * from './lib/client-rendering';
export * from './lib/client-support';
export * from './lib/sent';
export * from './lib/style-text';
export * from './lib/envelope';
