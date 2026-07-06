import { EditorState, TextSelection } from 'prosemirror-state';
import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { emailExtensions } from './kits';
import { ClearFormatting } from './clear-formatting';

const schema = createSchema(emailExtensions);
const command = ClearFormatting.commands!({ schema, extensions: emailExtensions })[
  'clearFormatting'
]();

describe('clear formatting', () => {
  it('strips every mark from the selection but keeps block structure', () => {
    const doc = parseHTML(
      '<blockquote><div><strong>bold</strong> <em>italic</em> <a href="https://x.io">link</a></div></blockquote>',
      schema,
    );
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2, doc.content.size - 2),
    });
    expect(command(state, (tr) => (state = state.apply(tr)))).toBe(true);
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<blockquote><div>bold italic link</div></blockquote>',
    );
  });

  it('reports unavailable for an empty selection', () => {
    const doc = parseHTML('<div>plain</div>', schema);
    expect(command(EditorState.create({ doc }))).toBe(false);
  });
});
