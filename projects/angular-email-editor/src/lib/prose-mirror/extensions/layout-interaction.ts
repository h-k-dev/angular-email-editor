import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { defineExtension } from '../extension';
import { LayoutBlockType } from './layout-guides';

/** Which layout blocks take their own interaction — grips, boundary drags,
    add pills, the block menu — by type. */
export type LayoutInteractivity = Readonly<Record<LayoutBlockType, boolean>>;

/** Every layout block interactive: the editor's default. */
export const LAYOUT_INTERACTIVE: LayoutInteractivity = {
  section: true,
  columns: true,
  table: true,
};

/** The attribute on the editor root naming the layout blocks whose
    interaction is off, space-separated (`data-aee-static="table columns"`) —
    what a stylesheet hides their affordances by: `[data-aee-static~=table]`.
    Absent while every block is interactive. */
export const LAYOUT_STATIC_ATTRIBUTE = 'data-aee-static';

const layoutInteractionKey = new PluginKey<LayoutInteractivity>('layoutInteraction');

/** Whether a layout block of `type` takes its interaction in this state —
    true in an editor without the extension. */
export function layoutInteractive(state: EditorState, type: LayoutBlockType): boolean {
  return layoutInteractionKey.getState(state)?.[type] ?? true;
}

/** The interactivity in this state, as a whole. */
export function layoutInteractivity(state: EditorState): LayoutInteractivity {
  return layoutInteractionKey.getState(state) ?? LAYOUT_INTERACTIVE;
}

/** Turns layout blocks' interaction on or off, by type — the types left out
    keep theirs. Not an edit: nothing to undo, nothing in the email. */
export const setLayoutInteraction =
  (interactivity: Partial<LayoutInteractivity>): Command =>
  (state, dispatch) => {
    const current = layoutInteractionKey.getState(state);
    if (!current) return false;
    if (dispatch) {
      dispatch(
        state.tr
          .setMeta(layoutInteractionKey, { ...current, ...interactivity })
          .setMeta('addToHistory', false),
      );
    }
    return true;
  };

/**
 * Layout blocks with their interaction on or off, by type — a section's
 * block menu, a columns block's boundary drags and add pills, a table's
 * grips, drags, pills and menus. Off, a block is laid out as it stands: its
 * words still edit like any other, but its structure takes no gesture, which
 * is what a template whose layout is settled wants (the writer fills it in,
 * the layout is the designer's).
 *
 * Editor state, not the document's: the email is the same either way, and a
 * switch is no undo step. The affordances read it themselves
 * ({@link layoutInteractive}); the editor root names the static types in
 * {@link LAYOUT_STATIC_ATTRIBUTE}, for the stylesheet that draws them.
 */
export const LayoutInteraction = defineExtension({
  name: 'layoutInteraction',
  commands: () => ({
    setLayoutInteraction: (interactivity: Partial<LayoutInteractivity>) =>
      setLayoutInteraction(interactivity),
  }),
  plugins: () => [
    new Plugin<LayoutInteractivity>({
      key: layoutInteractionKey,
      state: {
        init: () => LAYOUT_INTERACTIVE,
        apply: (tr, value) => tr.getMeta(layoutInteractionKey) ?? value,
      },
      props: {
        attributes: (state): Record<string, string> => {
          const interactivity = layoutInteractivity(state);
          const off = (Object.keys(interactivity) as LayoutBlockType[]).filter(
            (type) => !interactivity[type],
          );
          return off.length ? { [LAYOUT_STATIC_ATTRIBUTE]: off.join(' ') } : {};
        },
      },
    }),
  ],
});
