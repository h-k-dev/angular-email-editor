import { Signal, computed } from '@angular/core';

// Library
import { emailFontFamilies, emailFontSizes } from 'angular-email-editor';

import { FormattingCommands } from '../formatting-commands';
import { ToolbarMenuItem } from './toolbar-menu/toolbar-menu';

/** A `font-family` value as a comparison key — lower-cased, quotes dropped,
    spacing around commas collapsed — so a computed style matches the curated
    stack it came from (the library compares stacks the same way). */
function fontKey(stack: string): string {
  return stack
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

/** The curated stack a font is, if it is one. */
function curated(family: string): string | null {
  const key = fontKey(family);
  return emailFontFamilies.find((font) => fontKey(font.stack) === key)?.stack ?? null;
}

const NO_FONT = { own: { family: '', size: null }, family: null, size: null };

/**
 * The font at the caret, as the toolbar's two dropdowns show and offer it —
 * never a "default", but the value in effect: a text style chosen on the
 * text, or else the text's own font (what its block is set in, inherited
 * from the surface). The menus offer the curated, email-safe choices, led by
 * the own font when it is none of them, and tick the one in effect.
 *
 * The own font is a computed style, so reading it costs a style recalc: it
 * is read only while `enabled` (the dropdowns show — wide and not hidden).
 * In code view there is no caret in the rich text: the dropdowns show the
 * surface's own font, and a choice applies to the source selection.
 */
export function createFontState(commands: FormattingCommands, enabled: Signal<boolean>) {
  const font = computed<{
    own: { family: string; size: number | null };
    family: string | null;
    size: number | null;
  }>(() => {
    const state = commands.state();
    const editor = commands.editor();
    if (!enabled() || !editor || !state) return NO_FONT;
    const { view } = editor;
    if (commands.codeView()) {
      const surface = getComputedStyle(view.dom);
      return {
        own: { family: surface.fontFamily, size: Math.round(parseFloat(surface.fontSize)) || null },
        family: null,
        size: null,
      };
    }
    const { $from } = state.selection;
    const style = commands.markAttrs('textStyle');
    const block = $from.depth > 0 ? view.nodeDOM($from.before()) : null;
    const computedStyle = getComputedStyle(block instanceof Element ? block : view.dom);
    return {
      own: {
        family: computedStyle.fontFamily ?? '',
        size: Math.round(parseFloat(computedStyle.fontSize ?? '')) || null,
      },
      family: (style?.['fontFamily'] as string | null) ?? null,
      size: (style?.['fontSize'] as number | null) ?? null,
    };
  });

  /** The text's own font, when it is not a curated stack (the surface's
      Roboto): the font menu's first item. */
  const ownFamily = computed(() => {
    const { family } = font().own;
    return family && !curated(family) ? family.split(',')[0].replace(/["']/g, '').trim() : null;
  });

  /** The curated stack in effect — the chosen one, or the own when curated. */
  const family = computed(() => curated(font().family ?? font().own.family));

  const familyLabel = computed(
    () => emailFontFamilies.find((f) => f.stack === family())?.name ?? ownFamily() ?? '',
  );

  const familyItems = computed<ToolbarMenuItem<string | null>[]>(() => {
    const own = ownFamily();
    const current = family();
    return [
      ...(own
        ? [{ value: null, label: own, kind: 'radio' as const, checked: font().family === null }]
        : []),
      ...emailFontFamilies.map((f, i) => ({
        value: f.stack,
        label: f.name,
        font: f.stack,
        kind: 'radio' as const,
        checked: current === f.stack,
        separated: !!own && i === 0,
      })),
    ];
  });

  /** The text's own size, when it is not a curated one. */
  const ownSize = computed(() => {
    const { size } = font().own;
    return size !== null && !(emailFontSizes as readonly number[]).includes(size) ? size : null;
  });

  /** The size in effect, in px: the chosen one, or the own. */
  const size = computed(() => font().size ?? font().own.size);

  const sizeItems = computed<ToolbarMenuItem<number | null>[]>(() => {
    const own = ownSize();
    const current = size();
    return [
      ...(own !== null
        ? [{ value: null, label: `${own}px`, kind: 'radio' as const, checked: font().size === null }]
        : []),
      ...emailFontSizes.map((s, i) => ({
        value: s as number,
        label: `${s}px`,
        kind: 'radio' as const,
        checked: current === s,
        separated: own !== null && i === 0,
      })),
    ];
  });

  return { familyLabel, familyItems, size, sizeItems };
}
