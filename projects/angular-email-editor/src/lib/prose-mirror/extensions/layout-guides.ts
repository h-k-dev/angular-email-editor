import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineExtension } from '../extension';

/** The layout blocks the editor treats as structures in their own right: their
    shape is invisible in the exported email (our tables are borderless; columns
    are bare inline-block divs), so the editor has to reveal it — and they carry
    block-level commands (align, add/remove row…) that need somewhere to live.
    One definition, shared by the guides and the block menu. */
export type LayoutBlockType = 'table' | 'columns';

const LAYOUT_BLOCKS = new Set<string>(['table', 'columns']);

export interface LayoutBlock {
  pos: number;
  node: Node;
  type: LayoutBlockType;
}

/** The innermost `table`/`columns` ancestor of the selection, or null. */
export function layoutBlockAt(state: EditorState): LayoutBlock | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (LAYOUT_BLOCKS.has(node.type.name)) {
      return { pos: $from.before(depth), node, type: node.type.name as LayoutBlockType };
    }
  }
  return null;
}

/** Class on the layout block the cursor is currently inside. */
export const GUIDES_ACTIVE_CLASS = 'aee-guides-active';

/** Class on the editor root while the peek modifier is held — reveals *every*
    layout block's guides at once. */
export const GUIDES_PEEK_CLASS = 'aee-guides-peek';

/**
 * How long Ctrl must be held before guides appear. Ctrl is also the prefix for
 * every shortcut (Ctrl-B, Ctrl-C, Ctrl-Z), so revealing instantly would make the
 * grid flash on every one of them. A hold delay — cancelled by any other key —
 * separates "I'm peeking at the layout" from "I'm running a shortcut".
 *
 * Kept just under the ~100ms that still reads as instant: a real chord presses
 * its letter 30–80ms after the modifier, so this catches shortcuts while a
 * deliberate hold feels immediate. The rest of the debouncing is perceptual —
 * the guides *fade* in (see the `.aee-guides-*` transition in the app's global
 * styles), so anything slipping past this timer is a soft partial fade rather
 * than a hard blink. Longer than this and a deliberate peek just feels laggy.
 */
export const GUIDES_PEEK_DELAY_MS = 100;

/**
 * One shared mechanism for showing the structure of layout blocks (tables and
 * columns alike) while editing — never in the email itself.
 *
 * Three ways in, all resolved in CSS against a border that is *always reserved
 * as transparent*, so revealing a guide never shifts layout:
 *   1. **Cursor inside** — the block being edited is tagged {@link GUIDES_ACTIVE_CLASS}.
 *   2. **Hover** — pure CSS on the block itself; nothing to coordinate here.
 *   3. **Peek** — hold Ctrl ({@link GUIDES_PEEK_DELAY_MS}) to reveal every block
 *      at once via {@link GUIDES_PEEK_CLASS} on the editor root.
 *
 * The app owns the pixels (see the `.aee-guides-*` rules in its global styles);
 * this extension only supplies the state.
 */
export const LayoutGuides = defineExtension({
  name: 'layoutGuides',
  plugins: () => [
    new Plugin({
      key: new PluginKey('layoutGuides'),
      props: {
        decorations(state) {
          const block = layoutBlockAt(state);
          if (!block) return null;
          return DecorationSet.create(state.doc, [
            Decoration.node(block.pos, block.pos + block.node.nodeSize, {
              class: GUIDES_ACTIVE_CLASS,
            }),
          ]);
        },
      },
      view: (view) => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        const clearTimer = () => {
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
        };
        const setPeek = (on: boolean) => {
          clearTimer();
          view.dom.classList.toggle(GUIDES_PEEK_CLASS, on);
        };

        const onKeyDown = (event: KeyboardEvent) => {
          // Any key that isn't the modifier itself means a shortcut is being
          // typed, not a peek — cancel the pending reveal and hide.
          if (event.key !== 'Control') {
            setPeek(false);
            return;
          }
          if (timer !== undefined || view.dom.classList.contains(GUIDES_PEEK_CLASS)) return;
          timer = setTimeout(() => {
            timer = undefined;
            view.dom.classList.add(GUIDES_PEEK_CLASS);
          }, GUIDES_PEEK_DELAY_MS);
        };
        const onKeyUp = (event: KeyboardEvent) => {
          if (event.key === 'Control') setPeek(false);
        };
        // A lost keyup (tabbing away mid-hold) would strand the guides on.
        const onBlur = () => setPeek(false);

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);

        return {
          destroy() {
            clearTimer();
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
          },
        };
      },
    }),
  ],
});
