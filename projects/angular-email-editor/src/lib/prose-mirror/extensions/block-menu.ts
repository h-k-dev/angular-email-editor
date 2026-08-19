import { Command, Plugin, PluginKey } from 'prosemirror-state';
import { FunctionalExtension, defineExtension } from '../extension';
import { LayoutBlockType, layoutBlockAt } from './layout-guides';

export interface BlockMenuState {
  isOpen: boolean;
  /** The layout block's own rect — the menu anchors to the block, not the caret. */
  boundingBox: DOMRect | null;
  /** Which block the cursor is in, so the app can offer its commands. */
  block: LayoutBlockType | null;
}

export interface BlockMenuOptions {
  onStateChange: (state: BlockMenuState) => void;
  /**
   * Resolves the rendered menu element, lazily — it lives in an overlay, so it
   * only exists while the menu is open.
   *
   * Without it the menu is **mouse-only**: it stays open only while the editor
   * has focus, so Tabbing toward it blurs the editor and closes the very thing
   * you were reaching for. Given this, focus landing inside the menu counts as
   * still-active, which is what makes {@link BLOCK_MENU_FOCUS_KEY} usable.
   */
  menuElement?: () => HTMLElement | null | undefined;
}

/**
 * Moves focus into the menu — the ARIA "jump to toolbar" gesture, and the only
 * way to reach a contextual toolbar that is anchored to the caret's block.
 * Alt-F10 follows CKEditor's convention; bare F10 is out because browsers give
 * it to their own menu bar, and Alt alone would too (a chord is safe).
 */
export const BLOCK_MENU_FOCUS_KEY = 'Alt-F10';

const CLOSED: BlockMenuState = { isOpen: false, boundingBox: null, block: null };

/**
 * The block menu: the bubble menu's sibling for *layout blocks*.
 *
 * The bubble menu answers "what can I do to this text?" and anchors to the
 * selection. This answers "what can I do to this block?" and anchors to the
 * block itself. It exists because block-level commands kept piling up with
 * nowhere to live — the table's structural commands (`addRowAt`, `deleteColumnAt`,
 * …) have been library-only, and column alignment would have been the third
 * feature to hit the same wall.
 *
 * It opens on a **bare cursor** inside a table/columns block, so it never
 * competes with the text bubble menu (which needs a non-empty selection) —
 * the two are mutually exclusive by construction, never stacked.
 *
 * Reachable by keyboard: press {@link BLOCK_MENU_FOCUS_KEY} to move focus into
 * it, Escape (wired by the app) to come back. See {@link BlockMenuOptions.menuElement}
 * for why that needs the element.
 *
 * Deliberately *not* the reverted Notion-style overlay: no pointer tracking, no
 * hover handles, no steppers. It is one calm toolbar, positioned by the app.
 */
export const createBlockMenu = (options: BlockMenuOptions): FunctionalExtension => {
  const menuHasFocus = (): boolean => {
    const el = options.menuElement?.();
    return !!el && el.contains(document.activeElement);
  };

  /** Park focus on the menu's first button. */
  const focusBlockMenu: Command = (_state, dispatch) => {
    const first = options.menuElement?.()?.querySelector<HTMLElement>('button:not([disabled])');
    if (!first) return false;
    if (dispatch) first.focus();
    return true;
  };

  return defineExtension({
    name: 'blockMenu',
    keymap: () => ({ [BLOCK_MENU_FOCUS_KEY]: focusBlockMenu }),
    plugins: () => [
      new Plugin({
        key: new PluginKey('blockMenu'),
        view: (view) => {
          let destroyed = false;

          const refresh = () => {
            if (destroyed) return;

            // A non-empty selection belongs to the text bubble menu.
            const block = view.state.selection.empty ? layoutBlockAt(view.state) : null;
            // Focus inside the menu still counts: otherwise reaching for the
            // menu by keyboard would be what closes it. The selection stays put
            // while the editor is blurred, so the block is still resolvable.
            if (!block || !(view.hasFocus() || menuHasFocus())) {
              options.onStateChange(CLOSED);
              return;
            }

            const dom = view.nodeDOM(block.pos);
            if (!(dom instanceof HTMLElement)) {
              options.onStateChange(CLOSED);
              return;
            }

            options.onStateChange({
              isOpen: true,
              boundingBox: dom.getBoundingClientRect(),
              block: block.type,
            });
          };

          // Clicking a menu button blurs the editor for a tick; re-check on the
          // next frame rather than tearing the overlay down under the click.
          const onBlur = () => requestAnimationFrame(refresh);
          const onFocus = () => refresh();
          // Focus moving anywhere is what decides this menu's fate — into the
          // menu keeps it open, out of both editor and menu closes it.
          const onFocusIn = () => refresh();
          view.dom.addEventListener('blur', onBlur);
          view.dom.addEventListener('focus', onFocus);
          document.addEventListener('focusin', onFocusIn);

          refresh();

          return {
            update(currentView, prevState) {
              const selectionChanged =
                !prevState || !prevState.selection.eq(currentView.state.selection);
              const docChanged = !prevState || !prevState.doc.eq(currentView.state.doc);
              if (selectionChanged || docChanged) refresh();
            },
            destroy() {
              destroyed = true;
              view.dom.removeEventListener('blur', onBlur);
              view.dom.removeEventListener('focus', onFocus);
              document.removeEventListener('focusin', onFocusIn);
              options.onStateChange(CLOSED);
            },
          };
        },
      }),
    ],
  });
};
