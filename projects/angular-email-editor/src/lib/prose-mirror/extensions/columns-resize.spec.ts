import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { emailExtensions } from './kits';
import { MIN_COLUMN_CAP, columnCaps, setColumnsBoundary } from './nodes/columns';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

describe('columns resize', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>intro</div>',
    });
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
      );
      return true;
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  const columnsPos = () => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'columns' && found === -1) found = pos;
      return found === -1;
    });
    return found;
  };
  const columnsNode = () => editor.state.doc.nodeAt(columnsPos())!;

  it('renders the wrapper carrying the container style, lines at the px caps', () => {
    editor.commands['insertColumns'](3);
    const wrap = host.querySelector<HTMLElement>('.aee-columns-wrap')!;
    expect(wrap).toBeTruthy();
    // The wrapper is editorial gutter only; the box inside it is the email's
    // container — so gutter padding can never narrow the columns' 600px.
    expect(wrap.getAttribute('style')).toBeNull();
    const box = wrap.querySelector<HTMLElement>('.aee-columns-box')!;
    expect(box.getAttribute('style')).toContain('max-width: 600px');
    expect(box.getAttribute('style')).toContain('margin-left: auto');
    expect(box.querySelector('.aee-columns')).toBeTruthy();

    // Two boundaries for three columns, at the cumulative caps (186, 372).
    const caps = columnCaps(columnsNode());
    const lines = host.querySelectorAll<HTMLElement>('.aee-col-line');
    expect(lines.length).toBe(2);
    expect(lines[0].style.left).toBe(`${caps[0]}px`);
    expect(lines[1].style.left).toBe(`${caps[0] + caps[1]}px`);

    // None of it reaches the email.
    const html = editor.getHTML();
    expect(html).not.toContain('aee-columns-wrap');
    expect(html).not.toContain('aee-col-line');
  });

  it('setColumnsBoundary moves px between neighbours and conserves the budget', () => {
    editor.commands['insertColumns'](2);
    const before = columnCaps(columnsNode());
    const budget = before[0] + before[1];

    expect(editor.exec(setColumnsBoundary(columnsPos(), 0, 200))).toBe(true);
    const after = columnCaps(columnsNode());
    expect(after).toEqual([200, budget - 200]);

    // Serialized as the caps — and a fixpoint.
    const html = editor.getHTML();
    expect(html).toContain('max-width: 200px');
    expect(html).toContain(`max-width: ${budget - 200}px`);
    expect(canonical(html)).toBe(html);

    // The line follows the committed boundary.
    expect(host.querySelector<HTMLElement>('.aee-col-line')!.style.left).toBe('200px');
  });

  it('clamps both sides at the cap floor', () => {
    editor.commands['insertColumns'](2);
    const budget = columnCaps(columnsNode()).reduce((a, b) => a + b, 0);
    editor.exec(setColumnsBoundary(columnsPos(), 0, 10));
    expect(columnCaps(columnsNode())).toEqual([MIN_COLUMN_CAP, budget - MIN_COLUMN_CAP]);
    editor.exec(setColumnsBoundary(columnsPos(), 0, 9999));
    expect(columnCaps(columnsNode())).toEqual([budget - MIN_COLUMN_CAP, MIN_COLUMN_CAP]);
  });

  it('leaves the other columns alone', () => {
    editor.commands['insertColumns'](3);
    const before = columnCaps(columnsNode());
    editor.exec(setColumnsBoundary(columnsPos(), 1, 150));
    const after = columnCaps(columnsNode());
    expect(after[0]).toBe(before[0]);
    expect(after[1] + after[2]).toBe(before[1] + before[2]);
  });

  it('refuses a boundary outside the block', () => {
    editor.commands['insertColumns'](2);
    expect(editor.exec(setColumnsBoundary(columnsPos(), 1, 200))).toBe(false);
    expect(editor.exec(setColumnsBoundary(columnsPos(), -1, 200))).toBe(false);
    expect(editor.exec(setColumnsBoundary(0, 0, 200))).toBe(false); // not a columns block
  });
});
