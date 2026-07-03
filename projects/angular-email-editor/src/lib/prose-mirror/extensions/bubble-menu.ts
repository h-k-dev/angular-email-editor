import { EditorState, Plugin, PluginKey, TextSelection, AllSelection } from 'prosemirror-state';
import { FunctionalExtension, defineExtension } from '../extension'; // Adjust path if needed

export interface BubbleMenuState {
  isOpen: boolean;
  boundingBox: DOMRect | null;
}

export interface BubbleMenuOptions {
  updateDelay?: number;
  onStateChange: (state: BubbleMenuState) => void;
  shouldShow?: (state: EditorState) => boolean;
}

const defaultShouldShow = (state: EditorState) =>
  !state.selection.empty &&
  (state.selection instanceof TextSelection || state.selection instanceof AllSelection);

export const createBubbleMenu = (options: BubbleMenuOptions): FunctionalExtension =>
  defineExtension({
    name: 'bubbleMenu',
    plugins: () => [
      new Plugin({
        key: new PluginKey('bubbleMenu'),
        view: (view) => {
          let showTimer: ReturnType<typeof setTimeout> | undefined;
          let mouseSelecting = false;
          let destroyed = false;

          const refresh = () => {
            if (destroyed) return;
            clearTimeout(showTimer);

            // Check if we should show the menu. Also ensure the editor actually has focus
            // to prevent the menu from popping up when clicking outside the editor.
            const canShow =
              !mouseSelecting &&
              (options.shouldShow || defaultShouldShow)(view.state) &&
              view.hasFocus();

            if (!canShow) {
              options.onStateChange({ isOpen: false, boundingBox: null });
              return;
            }

            showTimer = setTimeout(() => {
              const { from, to } = view.state.selection;

              // Get coordinates of the selection boundaries
              const start = view.coordsAtPos(from);
              const end = view.coordsAtPos(to, -1);

              // Construct a virtual DOMRect representing the text selection.
              // Angular CDK uses this to anchor the overlay!
              const top = Math.min(start.top, end.top);
              const bottom = Math.max(start.bottom, end.bottom);
              const left = Math.min(start.left, end.left);
              const right = Math.max(start.right, end.right);

              // Construct a mathematically perfect virtual DOMRect
              const boundingBox = {
                top,
                bottom,
                left,
                right,
                width: right - left,
                height: bottom - top,
                x: left,
                y: top,
                toJSON: () => '',
              } as DOMRect;

              options.onStateChange({ isOpen: true, boundingBox });
            }, options.updateDelay ?? 150);
          };

          // 1. Mouse Tracking: Don't show the menu while the user is actively dragging a selection.
          // Only a mousedown that begins inside the editor starts a text-selection drag. A mousedown
          // elsewhere — above all on the bubble menu itself, which renders in a CDK overlay outside
          // view.dom — must not count, or every button press would hide the menu and tear down the
          // overlay around the very click meant to run the command.
          const onWindowMousedown = (event: MouseEvent) => {
            if (!view.dom.contains(event.target as Node)) return;
            mouseSelecting = true;
            refresh();
          };
          const onMouseup = () => {
            mouseSelecting = false;
            refresh();
          };
          window.addEventListener('mousedown', onWindowMousedown);
          window.addEventListener('mouseup', onMouseup);

          // 2. Focus Tracking: Clean up nicely when blurring
          const onBlur = () => requestAnimationFrame(refresh);
          const onFocus = () => refresh();
          view.dom.addEventListener('blur', onBlur);
          view.dom.addEventListener('focus', onFocus);

          return {
            update(view, prevState) {
              const selectionChanged = !prevState || !prevState.selection.eq(view.state.selection);
              const docChanged = !prevState || !prevState.doc.eq(view.state.doc);

              if (selectionChanged || docChanged) {
                refresh();
              }
            },
            destroy() {
              destroyed = true;
              clearTimeout(showTimer);

              // Cleanup listeners
              window.removeEventListener('mousedown', onWindowMousedown);
              window.removeEventListener('mouseup', onMouseup);
              view.dom.removeEventListener('blur', onBlur);
              view.dom.removeEventListener('focus', onFocus);

              // Close menu
              options.onStateChange({ isOpen: false, boundingBox: null });
            },
          };
        },
      }),
    ],
  });
