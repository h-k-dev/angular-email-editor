import { TextSelection } from 'prosemirror-state';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { createEditor, Editor } from '../../editor';
import { emailExtensions } from '../kits';
import {
  HEADING_LEVELS,
  HEADING_SIZES,
  HEADING_SPACE_ABOVE,
  HEADING_SPACE_BELOW,
  Heading,
  headingStyle,
} from './heading';

const schema = createSchema(emailExtensions);
const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

const SPACED_H2 = '<h2 style="margin: 16px 0px 4px; font-size: 20px;">Title</h2>';
const LAYOUT_H2 = '<h2 class="aee-layout-heading" style="margin: 0px; font-size: 20px;">Title</h2>';

describe('heading', () => {
  it('sits nearer its words than the ones before; Outlook stacking two lands on the size', () => {
    for (const level of HEADING_LEVELS) {
      // A browser collapses a heading after a heading to the space above;
      // Word may add the 4px below the first — at most the size, never more.
      expect(HEADING_SPACE_ABOVE[level] + HEADING_SPACE_BELOW).toBe(HEADING_SIZES[level]);
      expect(HEADING_SPACE_ABOVE[level]).toBeGreaterThanOrEqual(3 * HEADING_SPACE_BELOW);
    }
  });

  it('a margin above and a small one below; a layout heading sits flush', () => {
    expect([1, 2, 3, 4].map((level) => headingStyle(level))).toEqual([
      'margin: 20px 0px 4px; font-size: 24px;',
      'margin: 16px 0px 4px; font-size: 20px;',
      'margin: 14px 0px 4px; font-size: 18px;',
      'margin: 12px 0px 4px; font-size: 16px;',
    ]);
    expect(headingStyle(2, true)).toBe('margin: 0px; font-size: 20px;');
  });

  it('round-trips both kinds byte for byte', () => {
    expect(roundTrip(SPACED_H2)).toBe(SPACED_H2);
    expect(roundTrip(LAYOUT_H2)).toBe(LAYOUT_H2);
  });

  it('reads a flush heading — its top margin said, and zero — as layout; any other as spaced', () => {
    expect(roundTrip('<h2 style="margin:0">Title</h2>')).toBe(LAYOUT_H2);
    expect(roundTrip('<h2 style="margin-top: 0">Title</h2>')).toBe(LAYOUT_H2);
    expect(roundTrip('<h2 style="margin: 0 0 12px">Title</h2>')).toBe(LAYOUT_H2);
    // A bare heading had a client's default space above it, and keeps space.
    expect(roundTrip('<h2>Title</h2>')).toBe(SPACED_H2);
    expect(roundTrip('<h2 style="margin: 8px 0">Title</h2>')).toBe(SPACED_H2);
    expect(roundTrip('<h2 style="margin-bottom: 0">Title</h2>')).toBe(SPACED_H2);
  });

  it('reads an alignment, written or legacy, and writes it after the scale', () => {
    const centred =
      '<h2 style="margin: 16px 0px 4px; font-size: 20px; text-align: center;">Title</h2>';
    expect(roundTrip(centred)).toBe(centred);
    expect(roundTrip('<h2 align="right">Title</h2>')).toContain('text-align: right;');
    // Left is the default: nothing written.
    expect(roundTrip('<h2 style="text-align: left">Title</h2>')).toBe(SPACED_H2);
  });

  it('knows no h5 or h6: they come in as plain lines', () => {
    expect(roundTrip('<h5>Five</h5><h6>Six</h6>')).toBe('<div>Five</div><div>Six</div>');
  });

  describe('in the editor', () => {
    let host: HTMLElement;
    let editor: Editor;

    beforeEach(() => {
      host = document.createElement('div');
      document.body.appendChild(host);
      editor = createEditor({ parent: host, extensions: emailExtensions });
    });

    afterEach(() => {
      editor.destroy();
      host.remove();
    });

    it('aligns a heading as a line: centred or right, left writing nothing', () => {
      editor.setContent(SPACED_H2);
      editor.commands['setAlignment']('center');
      expect(editor.getHTML()).toBe(
        '<h2 style="margin: 16px 0px 4px; font-size: 20px; text-align: center;">Title</h2>',
      );
      editor.commands['setAlignment']('right');
      expect(editor.getHTML()).toContain('text-align: right;');
      editor.commands['setAlignment'](null);
      expect(editor.getHTML()).toBe(
        '<h2 style="margin: 16px 0px 4px; font-size: 20px;">Title</h2>',
      );
    });

    it('keeps a centred line centred as it becomes a heading, a layout one included', () => {
      editor.setContent('<div style="text-align: center;">Title</div>');
      editor.commands['setHeading'](1, true);
      expect(editor.getHTML()).toBe(
        '<h1 class="aee-layout-heading" style="margin: 0px; font-size: 24px; text-align: center;">Title</h1>',
      );
    });

    it('takes a bigger size on its words — a display title is the text’s own size', () => {
      editor.setContent('<h1 style="margin: 20px 0px 4px; font-size: 24px;">Title</h1>');
      editor.exec((state, dispatch) => {
        dispatch?.(
          state.tr.addMark(1, 6, state.schema.marks['textStyle'].create({ fontSize: 32 })),
        );
        return true;
      });
      const html = editor.getHTML();
      expect(html).toContain('<span style="font-size: 32px;">Title</span>');
      expect(roundTrip(html)).toBe(html);
    });

    /** Types `text` then a space at the end of the first line, as the
        keyboard would — the input rules see the space. */
    const typeThenSpace = (text: string) => {
      editor.setContent(`<div>${text}</div>`);
      const end = editor.state.doc.firstChild!.nodeSize - 1;
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
      );
      const handled = editor.view.someProp('handleTextInput', (f) =>
        f(editor.view, end, end, ' ', () => editor.state.tr.insertText(' ', end, end)),
      );
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(' ', end, end));
    };

    it('#### makes a spaced h4; ##### stays the text it is', () => {
      typeThenSpace('####');
      expect(editor.getHTML()).toBe('<h4 style="margin: 12px 0px 4px; font-size: 16px;"></h4>');
      typeThenSpace('#####');
      expect(editor.getHTML()).toBe('<div>##### </div>');
    });

    it('Heading 1–3 (layout) make the line a flush heading of their level, in Layout', () => {
      const actions = Heading.actions!({ schema: editor.schema, extensions: [] });
      const layout = (level: number) =>
        actions.find((action) => action.id === `heading-${level}-layout`)!;
      expect([1, 2, 3].map((level) => layout(level).title)).toEqual([
        'Heading 1 (layout)',
        'Heading 2 (layout)',
        'Heading 3 (layout)',
      ]);
      expect([1, 2, 3].map((level) => layout(level).section)).toEqual([
        'layout',
        'layout',
        'layout',
      ]);

      editor.setContent('<div>Title</div>');
      layout(1).command!(editor.state, editor.view.dispatch, editor.view);
      expect(editor.getHTML()).toBe(
        '<h1 class="aee-layout-heading" style="margin: 0px; font-size: 24px;">Title</h1>',
      );

      layout(2).command!(editor.state, editor.view.dispatch, editor.view);
      expect(editor.getHTML()).toBe(
        '<h2 class="aee-layout-heading" style="margin: 0px; font-size: 20px;">Title</h2>',
      );

      editor.setContent('<h3>Title</h3>');
      layout(3).command!(editor.state, editor.view.dispatch, editor.view);
      expect(editor.getHTML()).toBe(
        '<h3 class="aee-layout-heading" style="margin: 0px; font-size: 18px;">Title</h3>',
      );

      const h3 = actions.find((action) => action.id === 'heading-3')!;
      h3.command!(editor.state, editor.view.dispatch, editor.view);
      expect(editor.getHTML()).toBe(
        '<h3 style="margin: 14px 0px 4px; font-size: 18px;">Title</h3>',
      );

      // The command keeps a heading's level — the API's flush toggle.
      editor.commands['setLayoutHeading']();
      expect(editor.getHTML()).toBe(
        '<h3 class="aee-layout-heading" style="margin: 0px; font-size: 18px;">Title</h3>',
      );
    });
  });
});
