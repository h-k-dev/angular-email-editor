import { EditorState, Transaction } from 'prosemirror-state';
import { NodeType, NodeRange } from 'prosemirror-model';

export function chain(state: EditorState, dispatch: (tr: Transaction) => void) {
  let tr = state.tr;

  return {
    wrap(range: NodeRange, wrapping: any) {
      tr = tr.wrap(range, wrapping);
      return this;
    },

    setNodeAttrs(pos: number, type: NodeType, attrs: Record<string, any>) {
      tr = tr.setNodeMarkup(pos, type, attrs);
      return this;
    },

    run() {
      dispatch(tr);
    },
  };
}
