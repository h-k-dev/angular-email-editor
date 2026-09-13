import type { FormattingCommands } from './formatting-commands';

/** The pickers a formatting button can open instead of running a command.
    The toolbar owns them; it opens them at the button, or at the ⋯ when the
    button has moved there. */
export type FormattingPicker = 'textColor' | 'highlight' | 'table';

export type FormattingItemId =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'textColor'
  | 'highlight'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'quote'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'clearFormatting'
  | 'table';

/** One formatting button, whatever renders it: the toolbar, the ⋯ menu it
    moves into, the bubble menu. Defined once, here — a surface only decides
    which items it shows, and in which groups. */
export interface FormattingItem {
  id: FormattingItemId;
  label: string;
  icon: string;
  /** Wide screens only. A phone keeps what the text cannot do by itself:
      lists and quotes start from a line's first keys ("- ", "1. ", "> " —
      the extensions' input rules), a table from /table in the slash menu,
      and alignment needs a screen with room for it. Colour needs room too:
      a palette of touch-sized swatches is a sheet, not a popover over the
      keyboard — and on a phone it is rarely reached for. */
  wide?: boolean;
  /** Toggles: whether the format is on at the selection (`aria-pressed`). */
  pressed?: () => boolean;
  /** Pickers: whether the selection carries what the picker sets. */
  applied?: () => boolean;
  disabled?: () => boolean;
  /** What pressing it does: a command, or a picker to open. */
  run?: () => void;
  picker?: FormattingPicker;
}

/** A surface's buttons, in groups: dividers stand between the groups on a
    bar, separators in a menu. */
export type FormattingLayout = readonly (readonly FormattingItemId[])[];

/** Every formatting item, bound to one composer's commands — built once,
    by `FormattingCommands` (`commands.items`). `link` opens the link editor,
    which the composer anchors at the text. */
export function formattingItems(
  commands: FormattingCommands,
  actions: { link: () => void },
): Record<FormattingItemId, FormattingItem> {
  const blockLocked = () => commands.codeView();
  return {
    bold: {
      id: 'bold',
      label: 'Bold',
      icon: 'format_bold',
      pressed: () => commands.isActive('bold'),
      run: () => commands.run('toggleBold'),
    },
    italic: {
      id: 'italic',
      label: 'Italic',
      icon: 'format_italic',
      pressed: () => commands.isActive('italic'),
      run: () => commands.run('toggleItalic'),
    },
    underline: {
      id: 'underline',
      label: 'Underline',
      icon: 'format_underlined',
      pressed: () => commands.isActive('underline'),
      run: () => commands.run('toggleUnderline'),
    },
    strike: {
      id: 'strike',
      label: 'Strikethrough',
      icon: 'format_strikethrough',
      pressed: () => commands.isActive('strike'),
      run: () => commands.run('toggleStrike'),
    },
    textColor: {
      id: 'textColor',
      label: 'Text color',
      icon: 'format_color_text',
      wide: true,
      // The textStyle mark also carries font and size: ask for the colour.
      applied: () => !!commands.markAttrs('textStyle')?.['color'],
      picker: 'textColor',
    },
    // Routes to text, table cell, or column by cursor.
    highlight: {
      id: 'highlight',
      label: 'Highlight color',
      icon: 'format_color_fill',
      wide: true,
      picker: 'highlight',
    },
    link: {
      id: 'link',
      label: 'Link',
      icon: 'link',
      pressed: () => commands.isActive('link'),
      run: actions.link,
    },
    bulletList: {
      id: 'bulletList',
      label: 'Bulleted list',
      icon: 'format_list_bulleted',
      wide: true,
      pressed: () => commands.isActive('bulletList'),
      disabled: blockLocked,
      run: () => commands.run('toggleBulletList'),
    },
    orderedList: {
      id: 'orderedList',
      label: 'Numbered list',
      icon: 'format_list_numbered',
      wide: true,
      pressed: () => commands.isActive('orderedList'),
      disabled: blockLocked,
      run: () => commands.run('toggleOrderedList'),
    },
    quote: {
      id: 'quote',
      label: 'Quote',
      icon: 'format_quote',
      wide: true,
      pressed: () => commands.isActive('blockquote'),
      disabled: blockLocked,
      run: () => commands.toggleBlockquote(),
    },
    alignLeft: {
      id: 'alignLeft',
      label: 'Align left',
      icon: 'format_align_left',
      wide: true,
      pressed: () => commands.isActive('paragraph', { align: null }),
      disabled: blockLocked,
      run: () => commands.align(null),
    },
    alignCenter: {
      id: 'alignCenter',
      label: 'Align center',
      icon: 'format_align_center',
      wide: true,
      pressed: () => commands.isActive('paragraph', { align: 'center' }),
      disabled: blockLocked,
      run: () => commands.align('center'),
    },
    alignRight: {
      id: 'alignRight',
      label: 'Align right',
      icon: 'format_align_right',
      wide: true,
      pressed: () => commands.isActive('paragraph', { align: 'right' }),
      disabled: blockLocked,
      run: () => commands.align('right'),
    },
    clearFormatting: {
      id: 'clearFormatting',
      label: 'Clear formatting',
      icon: 'format_clear',
      disabled: blockLocked,
      run: () => commands.run('clearFormatting'),
    },
    table: {
      id: 'table',
      label: 'Insert table',
      icon: 'table_chart',
      wide: true,
      disabled: blockLocked,
      picker: 'table',
    },
  };
}

/** A layout as a flat run of buttons, each knowing whether a new group
    starts with it (`separated`) and whether that group is wide-only
    through and through — then its divider goes with it on a phone, so two
    gone groups never leave a doubled divider. */
export function layoutEntries(
  items: Record<FormattingItemId, FormattingItem>,
  layout: FormattingLayout,
): { item: FormattingItem; separated: boolean; groupWide: boolean }[] {
  return layout.flatMap((group, g) =>
    group.map((id, i) => ({
      item: items[id],
      separated: g > 0 && i === 0,
      groupWide: group.every((member) => items[member].wide),
    })),
  );
}
