import { EditorState, TextSelection } from 'prosemirror-state';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { emailExtensions } from '../kits';
import { EmailParagraph } from './email-paragraph';

const schema = createSchema(emailExtensions);
const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

describe('email paragraph alignment', () => {
  it('round-trips center and right, reads legacy align attributes', () => {
    expect(roundTrip('<div style="text-align: center;">a</div>')).toBe(
      '<div style="text-align: center;">a</div>',
    );
    expect(roundTrip('<p align="right">b</p>')).toBe('<div style="text-align: right;">b</div>');
  });

  it('canonicalizes left away — the default carries no declaration', () => {
    expect(roundTrip('<div style="text-align: left;">c</div>')).toBe('<div>c</div>');
    expect(roundTrip('<div style="text-align: justify;">d</div>')).toBe('<div>d</div>');
  });

  it('keeps alignment on empty lines', () => {
    expect(roundTrip('<div style="text-align: center;"><br></div>')).toBe(
      '<div style="text-align: center;"><br></div>',
    );
  });

  it('setAlignment covers every selected paragraph and toggles back to default', () => {
    const doc = parseHTML('<div>one</div><div>two</div>', schema);
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    const commands = EmailParagraph.commands!({ schema, extensions: emailExtensions });
    const run = (align: 'center' | 'right' | null) =>
      commands['setAlignment'](align)(state, (tr) => (state = state.apply(tr)));

    run('center');
    expect(serializeToHTML(state.doc, schema)).toBe(
      '<div style="text-align: center;">one</div><div style="text-align: center;">two</div>',
    );

    run(null);
    expect(serializeToHTML(state.doc, schema)).toBe('<div>one</div><div>two</div>');
  });
});
