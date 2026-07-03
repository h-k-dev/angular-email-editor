import { NodeSelection, Plugin, PluginKey } from 'prosemirror-state';
import { defineExtension } from '../extension';

/**
 * Selected text in contenteditable is natively draggable, which is never
 * wanted in a composer. Node drags (e.g. images) stay allowed.
 */
export const NoTextDrag = defineExtension({
  name: 'noTextDrag',
  plugins: () => [
    new Plugin({
      key: new PluginKey('noTextDrag'),
      props: {
        handleDOMEvents: {
          dragstart: (view, event) => {
            if (view.state.selection instanceof NodeSelection) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    }),
  ],
});
