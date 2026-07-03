import { baseKeymap } from 'prosemirror-commands';
import { defineExtension } from '../extension';

/**
 * Enter, Backspace, Delete, select-all, ... Keep this last in the extension
 * list so node/mark specific bindings take precedence.
 */
export const BaseKeymap = defineExtension({
  name: 'baseKeymap',
  keymap: () => baseKeymap,
});
