import { Injector, ValueEqualityFn, WritableSignal, linkedSignal, untracked } from '@angular/core';
import { Command, EditorState } from 'prosemirror-state';
import {
  COLUMNS_GAP_MAX,
  COLUMN_PADDING_MAX,
  Editor,
  PAGE_ROW_PADDING,
  PageLayout,
  PageLayoutKind,
  centeredPageLayout,
  columnPaddingOf,
  columnsGapOf,
  findBandContext,
  pageLayoutOf,
  sectionPaddingOf,
  setColumnPadding,
  setColumnsGap,
  setPageLayout,
  setSectionBackground,
  setSectionPadding,
  tablePageLayout,
  toEmailSafeColor,
} from '@h-k-dev/angular-email-editor';
import { editorState } from './actions';

export interface EditorModelOptions<T> {
  /** What the model says, read from the editor's state — on every change
      of it, so keep it cheap: a look at the caret's block, a document
      attribute. */
  read: (state: EditorState) => T;
  /** The command that makes the document say `value` — one step, so undo
      takes it back; null for nothing to do. `current` is what `read` says
      right now. */
  write: (value: T, current: T) => Command | null;
  /** What the model says while there is no editor. */
  initial: T;
  /** When two readings are the same — a keystroke that leaves the caret's
      block as it was redraws nothing. Default: the same value, or plain
      objects whose own keys hold the same values. */
  equal?: ValueEqualityFn<T>;
  injector?: Injector;
}

/** The default sameness: identity, or a shallow look at plain objects. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) =>
    Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Something the document says — the band's padding, the page's layout — as
 * a writable signal: reading it follows the editor, writing it runs the
 * command that changes the document, as one step of the editor's.
 *
 *     readonly padding = editorModel(() => this.editor(), {
 *       read: (state) => sectionPaddingOf(state) ?? { block: 0, inline: 0 },
 *       write: (value) => setSectionPadding(value),
 *       initial: { block: 0, inline: 0 },
 *     });
 *
 * The signal never holds a value the document does not: a write goes to
 * the editor, and the signal says what the document took — snapped to its
 * grid, clamped to its range, or nothing where the command refused. So it
 * is a model signal forms can stand on:
 *
 *     readonly fields = form(this.padding, (p) => debounce(p, 'blur'));
 *
 *     <input type="number" [formField]="fields.block" emailFieldKeys />
 *
 * — the `debounce`, so a field writes once it is done with (one undo step,
 * no snapping mid-number), and `emailFieldKeys` (`/keyboard`) so the field
 * shows what was taken when that equals what was there.
 *
 * `editor` is read reactively, like {@link editorState}'s. A write that
 * says what the document already does runs nothing. A `.set()` without an
 * editor is dropped. Call in an injection context, or hand it an injector.
 */
export function editorModel<T>(
  editor: () => Editor | undefined,
  options: EditorModelOptions<T>,
): WritableSignal<T> {
  const { read, write, initial, injector } = options;
  const equal = options.equal ?? shallowEqual;
  const state = editorState(editor, { injector });
  return linkedSignal(
    () => {
      const now = state();
      return now ? read(now) : initial;
    },
    {
      equal,
      // Never `rawSet`: the editor's change comes back through `state`,
      // and a refused one leaves the reading as it was.
      set: (value) =>
        untracked(() => {
          const current = editor();
          if (!current) return;
          const before = read(current.state);
          if (equal(value, before)) return;
          const command = write(value, before);
          if (command) current.exec(command);
        }),
    },
  );
}

/** A band's room, px: above and below, and at the sides. */
export interface BandPadding {
  block: number;
  inline: number;
}

const NO_PADDING: BandPadding = { block: 0, inline: 0 };

/**
 * The room of the band the caret is in (`sectionPaddingOf`) as a model:
 * none outside a band. A write snaps to the 4px grid
 * (`setSectionPadding`); outside a band it does nothing.
 */
export function sectionPaddingModel(
  editor: () => Editor | undefined,
  options: { injector?: Injector } = {},
): WritableSignal<BandPadding> {
  return editorModel(editor, {
    read: (state) => sectionPaddingOf(state) ?? NO_PADDING,
    write: (value) => setSectionPadding(value),
    initial: NO_PADDING,
    injector: options.injector,
  });
}

/**
 * The fill of the band the caret is in, as lower-case hex — null for none,
 * and outside a band. A write sets it (`setSectionBackground`); null takes
 * it away.
 */
export function sectionBackgroundModel(
  editor: () => Editor | undefined,
  options: { injector?: Injector } = {},
): WritableSignal<string | null> {
  return editorModel<string | null>(editor, {
    read: (state) => {
      const fill = findBandContext(state)?.node.attrs['background'];
      return typeof fill === 'string' ? (toEmailSafeColor(fill)?.toLowerCase() ?? null) : null;
    },
    write: (value) => setSectionBackground(value),
    initial: null,
    injector: options.injector,
  });
}

/** A layout column's room, px — above and below, and at its sides — and
    the gap between the columns of its block. */
export interface ColumnSpacing {
  block: number;
  inline: number;
  gap: number;
}

const NO_SPACING: ColumnSpacing = { block: 0, inline: 0, gap: 0 };

/**
 * The room inside the layout column the caret is in and its block's gap
 * (`columnPaddingOf`, `columnsGapOf`) as a model: none outside a column.
 * A write changes what it changes — the column's padding
 * (`setColumnPadding`, up to {@link COLUMN_PADDING_MAX}) or every column's
 * gap (`setColumnsGap`, up to {@link COLUMNS_GAP_MAX}) — on the 4px grid.
 */
export function columnSpacingModel(
  editor: () => Editor | undefined,
  options: { injector?: Injector } = {},
): WritableSignal<ColumnSpacing> {
  return editorModel(editor, {
    read: (state) => {
      const padding = columnPaddingOf(state);
      const gap = columnsGapOf(state);
      return padding || gap !== null ? { ...(padding ?? NO_PADDING), gap: gap ?? 0 } : NO_SPACING;
    },
    write: (value, current) =>
      value.gap !== current.gap
        ? setColumnsGap(value.gap)
        : setColumnPadding({ block: value.block, inline: value.inline }),
    initial: NO_SPACING,
    injector: options.injector,
  });
}

/**
 * The page layout as one flat set of settings — what a layout panel binds
 * its fields to. `kind` is `'none'` for no page; the rest is the page's
 * when it has one, else the defaults a new page would take, so turning a
 * page on starts from them.
 */
export interface PageLayoutSettings {
  kind: 'none' | PageLayoutKind;
  /** The column's width, px. */
  width: number;
  /** The page's room above and below the column, px. */
  spacing: number;
  /** A page of rows' room round every row's blocks, px — kept, unused, by
      the other kinds. */
  rowPadding: number;
  background: string | null;
  columnBackground: string | null;
}

function settingsOf(layout: PageLayout | null): PageLayoutSettings {
  const { width, spacing, background, columnBackground } = layout ?? centeredPageLayout();
  return {
    kind: layout?.kind ?? 'none',
    width,
    spacing,
    rowPadding: layout?.kind === 'table' ? layout.rowPadding : PAGE_ROW_PADDING,
    background,
    columnBackground,
  };
}

/**
 * The document's page layout (`pageLayoutOf`) as {@link PageLayoutSettings}:
 * a write sets the layout they describe (`setPageLayout`, one step —
 * turning blocks into rows and back with it), normalised: the width and the
 * room snap to their grid, a colour that is not a safe one is dropped.
 * `kind: 'none'` takes the page away.
 */
export function pageLayoutModel(
  editor: () => Editor | undefined,
  options: { injector?: Injector } = {},
): WritableSignal<PageLayoutSettings> {
  return editorModel(editor, {
    read: (state) => settingsOf(pageLayoutOf(state)),
    write: ({ kind, rowPadding, ...frame }) =>
      setPageLayout(
        kind === 'none'
          ? null
          : kind === 'table'
            ? tablePageLayout({ ...frame, rowPadding })
            : centeredPageLayout(frame),
      ),
    initial: settingsOf(null),
    injector: options.injector,
  });
}

