import type { FormattingCommands } from './formatting-commands';

/** The pickers a formatting button can open instead of running a command.
    The toolbar owns them; it opens them at the button, or at the ⋯ when the
    button has moved there. */
export type FormattingPicker = 'textColor' | 'highlight' | 'table';

/** The ids are the library's action ids wherever an item is one — kebab-case,
    locale-neutral, the key a translation file shares with the `/` menu. */
export type FormattingItemId =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'text-color'
  | 'highlight'
  | 'link'
  | 'bulleted-list'
  | 'numbered-list'
  | 'outdent'
  | 'indent'
  | 'quote'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'clear-formatting'
  | 'table'
  | 'image-alt'
  | 'replace-image'
  | 'remove-image';

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
): Record<FormattingItemId, FormattingItem> {
  /**
   * What the library knows about an action, by id — of whichever editor is
   * visible: when it is on, whether it can run, and running it. The words,
   * the icon and the place on the bar are this composer's.
   *
   * No action while an editor is up means its kit has none — the source
   * pane has the marks and nothing else — and the button locks; no editor
   * at all means not mounted yet, and a tool must not flash disabled for
   * that frame. `steady` keeps a button up whatever the moment says: Gmail's
   * indent pair does not grey out at the margin. `toggle: false` is for what
   * has no "on" — it must not say `aria-pressed`, nor be a checkbox in the ⋯.
   */
  const action = (
    id: FormattingItemId,
    { steady = false, toggle = true } = {},
  ): Pick<FormattingItem, 'pressed' | 'disabled' | 'run'> => ({
    ...(toggle ? { pressed: () => commands.actions.get(id)?.pressed() ?? false } : {}),
    disabled: () => {
      const bound = commands.actions.get(id);
      if (!bound) return commands.actions.state() !== undefined;
      return steady ? false : bound.disabled();
    },
    run: () => commands.act(id),
  });

  return {
    bold: { id: 'bold', label: 'Bold', icon: 'format_bold', ...action('bold') },
    italic: { id: 'italic', label: 'Italic', icon: 'format_italic', ...action('italic') },
    underline: {
      id: 'underline',
      label: 'Underline',
      icon: 'format_underlined',
      ...action('underline'),
    },
    strike: {
      id: 'strike',
      label: 'Strikethrough',
      icon: 'format_strikethrough',
      ...action('strike'),
    },
    // The pickers are this toolbar's own: they open an overlay at the button
    // and show what the selection carries, not an on/off.
    'text-color': {
      id: 'text-color',
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
    // The composer's own action: it opens the link editor (see the commands).
    link: { id: 'link', label: 'Link', icon: 'link', ...action('link') },
    'bulleted-list': {
      id: 'bulleted-list',
      label: 'Bulleted list',
      icon: 'format_list_bulleted',
      wide: true,
      ...action('bulleted-list'),
    },
    'numbered-list': {
      id: 'numbered-list',
      label: 'Numbered list',
      icon: 'format_list_numbered',
      wide: true,
      ...action('numbered-list'),
    },
    // Gmail's pair: a paragraph moves by a step of margin, a list item nests
    // or lifts. In a list the first item cannot nest and a top-level one
    // cannot lift, but that is the moment's state, not the button's.
    outdent: {
      id: 'outdent',
      label: 'Indent less',
      icon: 'format_indent_decrease',
      wide: true,
      ...action('outdent', { steady: true, toggle: false }),
    },
    indent: {
      id: 'indent',
      label: 'Indent more',
      icon: 'format_indent_increase',
      wide: true,
      ...action('indent', { steady: true, toggle: false }),
    },
    quote: { id: 'quote', label: 'Quote', icon: 'format_quote', wide: true, ...action('quote') },
    'align-left': {
      id: 'align-left',
      label: 'Align left',
      icon: 'format_align_left',
      wide: true,
      ...action('align-left'),
    },
    'align-center': {
      id: 'align-center',
      label: 'Align center',
      icon: 'format_align_center',
      wide: true,
      ...action('align-center'),
    },
    'align-right': {
      id: 'align-right',
      label: 'Align right',
      icon: 'format_align_right',
      wide: true,
      ...action('align-right'),
    },
    // Needs a selection: the library's action says so, and the button shows it.
    'clear-formatting': {
      id: 'clear-formatting',
      label: 'Clear formatting',
      icon: 'format_clear',
      ...action('clear-formatting', { toggle: false }),
    },
    // The size picker stands in for the kit's "insert a table" — but whether a
    // table can go here is the kit's answer: not in the source pane, which has
    // no such action.
    table: {
      id: 'table',
      label: 'Insert table',
      icon: 'table_chart',
      wide: true,
      disabled: action('table').disabled,
      picker: 'table',
    },
    // The selected image's own — enabled only while an image is the whole
    // selection. Alt text is the composer's (it opens the alt editor, as
    // link opens the link editor); replace and remove are the kit's.
    'image-alt': {
      id: 'image-alt',
      label: 'Alt text',
      icon: 'short_text',
      ...action('image-alt', { toggle: false }),
    },
    'replace-image': {
      id: 'replace-image',
      label: 'Replace image',
      icon: 'swap_horiz',
      ...action('replace-image', { toggle: false }),
    },
    'remove-image': {
      id: 'remove-image',
      label: 'Remove image',
      icon: 'delete',
      ...action('remove-image', { toggle: false }),
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
