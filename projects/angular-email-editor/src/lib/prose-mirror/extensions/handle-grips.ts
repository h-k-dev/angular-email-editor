import { PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

/** The section handles' plugin (section-handles.ts): its state hands a node
    view the grip it wears — here, apart, so a node (the spacer) reaches it
    without importing the extension that imports the node. */
export const sectionHandlesKey = new PluginKey<GripFactory>('sectionHandles');

/** What the section handles make for a node view of their kind. */
export interface GripFactory {
  spacer: (view: EditorView, getPos: () => number | undefined) => HTMLElement;
}

/** The grip a spacer's node view wears on its top edge — or null where no
    host has asked for grips (no `createSectionHandles` in the kit). */
export function spacerGrip(view: EditorView, getPos: () => number | undefined): HTMLElement | null {
  return sectionHandlesKey.getState(view.state)?.spacer(view, getPos) ?? null;
}
