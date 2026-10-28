/**
 * Dawn's colours: reading every colour CSS writes, and drawing one dark.
 *
 * Dawn draws a colour dark as a WebKit-based mail client does, with
 * WebKit's invert-lightness filter (`InvertLightnessFilterOperation::
 * transformColor`, Source/WebCore/platform/graphics/filters/
 * FilterOperation.cpp, safari-7614-branch): the hue turned half a turn in
 * HSL, then a 5×3 colour matrix. White comes out #333333, black white, a
 * hue stays its hue. Its constants are WebKit's, used under WebKit's BSD
 * licence (Copyright © Apple Inc.). Dawn is our own code; it is not made,
 * approved or endorsed by Apple.
 */

/** An sRGB colour, components 0–1. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

/** The surfaces a message lies on: the light reading pane, and the dark one
    — the editor's papers too. */
export const DAWN_SURFACE = { light: '#ffffff', dark: '#1e1e1e' } as const;

/** Light or dark: the paper an email is drawn on. */
export type DawnScheme = keyof typeof DAWN_SURFACE;

/** The CSS named colours, as rrggbb. */
const NAMED: Readonly<Record<string, string>> = Object.fromEntries(
  (
    'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,' +
    'bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,' +
    'burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,' +
    'cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
    'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,' +
    'darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,' +
    'darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,' +
    'darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,' +
    'darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,' +
    'dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,' +
    'gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,' +
    'greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,' +
    'ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,' +
    'lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
    'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,' +
    'lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,' +
    'lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,' +
    'lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,' +
    'mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,' +
    'mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,' +
    'mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,' +
    'mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,' +
    'olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,' +
    'palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,' +
    'peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,' +
    'rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,' +
    'salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,' +
    'skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,' +
    'springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,' +
    'turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,' +
    'yellowgreen:9acd32'
  )
    .split(',')
    .map((pair) => pair.split(':') as [string, string]),
);

const HEX_TOKEN = '#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])';
const FUNCTION_TOKEN = '(?:rgba?|hsla?)\\([^()]*\\)';
const NAME_TOKEN = `\\b(?:${Object.keys(NAMED).join('|')})\\b`;

/** In a colour-painting value: a `url(…)` (kept as it is) or a colour. */
export const VALUE_TOKEN = new RegExp(
  `url\\([^)]*\\)|${HEX_TOKEN}|${FUNCTION_TOKEN}|${NAME_TOKEN}`,
  'gi',
);

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** A number of a colour function: plain, or a percentage of `full`. */
function component(text: string, full: number): number {
  const value = parseFloat(text);
  return text.trim().endsWith('%') ? (value / 100) * full : value;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** A colour token — a name, a hex, `rgb()`/`hsl()` — as an sRGB colour, or
    null where it is none this reads. */
export function parseCssColor(token: string): Rgba | null {
  const text = token.trim().toLowerCase();
  const named = NAMED[text];
  if (named) return parseCssColor(`#${named}`);
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text)) {
    const hex = text.slice(1);
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const [r, g, b, a = 255] = (full.match(/../g) ?? []).map((pair) => parseInt(pair, 16));
    return [r / 255, g / 255, b / 255, a / 255];
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts[3] === undefined ? 1 : component(parts[3], 1);
  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((part) => component(part, 255) / 255);
    return [r, g, b, alpha];
  }
  const [r, g, b] = hslToRgb(parseFloat(parts[0]), component(parts[1], 1), component(parts[2], 1));
  return [r, g, b, alpha];
}

const byte = (value: number): number => Math.round(clamp(value) * 255);

/** A colour as CSS: `rgb()`, or `rgba()` where it is not opaque. */
export function rgbaToCss([r, g, b, a]: Rgba): string {
  return a >= 1
    ? `rgb(${byte(r)}, ${byte(g)}, ${byte(b)})`
    : `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${Math.round(a * 1000) / 1000})`;
}

/** A colour as #rrggbb, for the legacy attributes that read no CSS. */
export function rgbaToHex([r, g, b]: Rgba): string {
  return `#${[r, g, b].map((c) => byte(c).toString(16).padStart(2, '0')).join('')}`;
}

// ————————————————————————————————————————————————————— Dawn's colour maths

/** WebKit's `toDarkModeMatrix`: per channel, r, g, b, a and an offset. */
const TO_DARK_MODE: readonly (readonly number[])[] = [
  [-0.77, 0.059, -0.089, 0, 1],
  [0.03, -0.741, -0.089, 0, 1],
  [0.03, 0.059, -0.89, 0, 1],
];

/** WebKit's `hueRotate` helper: to HSL, the hue turned by `amount` of a
    turn, back to RGB. */
function hueRotate([r, g, b, a]: Rgba, amount: number): Rgba {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const chroma = max - min;
  const lightness = 0.5 * (max + min);
  const saturation =
    chroma === 0 ? 0 : lightness <= 0.5 ? chroma / (max + min) : chroma / (2 - (max + min));
  let hue = 0;
  if (chroma !== 0) {
    if (max === r) hue = (g - b) / chroma + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue /= 6;
  }
  hue = (hue + amount) % 1;
  const temp2 =
    lightness <= 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const temp1 = 2 * lightness - temp2;
  const sixths = hue * 6;
  const channel = (at: number): number => {
    const h = at < 0 ? at + 6 : at >= 6 ? at - 6 : at;
    if (h < 1) return temp1 + (temp2 - temp1) * h;
    if (h < 3) return temp2;
    if (h < 4) return temp1 + (temp2 - temp1) * (4 - h);
    return temp1;
  };
  return [channel(sixths + 2), channel(sixths), channel(sixths - 2), a];
}

/** The invert-lightness transform on one colour. */
export function invertLightness(color: Rgba): Rgba {
  const [r, g, b, a] = hueRotate(color, 0.5);
  const [red, green, blue] = TO_DARK_MODE.map((row) =>
    clamp(row[0] * r + row[1] * g + row[2] * b + row[3] * a + row[4]),
  );
  return [red, green, blue, a];
}

/** One CSS colour token as Dawn draws it dark — the light value in, the
    drawn value out; anything that is no colour (a `url(…)`, a keyword) as
    it was. What a swatch on a dark paper shows. */
export function dawnDarkColor(token: string): string {
  const color = parseCssColor(token);
  return color ? rgbaToCss(invertLightness(color)) : token;
}
