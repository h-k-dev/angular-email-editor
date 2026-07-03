import { history, redo, undo } from 'prosemirror-history';
import { defineExtension } from '../extension';

export const History = defineExtension({
  name: 'history',
  plugins: () => [history()],
  commands: () => ({
    undo: () => undo,
    redo: () => redo,
  }),
  keymap: () => ({
    'Mod-z': undo,
    'Mod-y': redo,
    'Shift-Mod-z': redo,
  }),
});
