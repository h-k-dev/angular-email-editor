import { NodeSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../../editor';
import { parseHTML, serializeToHTML } from '../../html';
import { createSchema } from '../../schema';
import { emailExtensions } from '../kits';
import { SPACER_MAX, SPACER_MIN, snapSpacerHeight } from './spacer';

const schema = createSchema(emailExtensions);
type Mode = 'repair' | 'email' | 'preserve';
const canonical = (html: string, mode: Mode = 'repair') =>
  serializeToHTML(parseHTML(html, schema, { mode }), schema);

const SPACER = (height: number) =>
  `<div class="aee-layout-spacer" style="height: ${height}px; line-height: ${height}px; font-size: 1px; mso-line-height-rule: exactly;">&nbsp;</div>`;

describe('spacer', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: '<div>a</div>' });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  const spacerPos = (): number => {
    let at = -1;
    editor.state.doc.forEach((node, offset) => {
      if (at < 0 && node.type.name === 'spacer') at = offset;
    });
    return at;
  };

  it('is one email-safe line in the email: marker, height, exact line height, a non-breaking space', () => {
    editor.commands['insertSpacer']();
    expect(editor.getHTML()).toContain(SPACER(24));
  });

  it('comes back as itself, in every parse mode', () => {
    const html = `<div>a</div>${SPACER(32)}<div>b</div>`;
    for (const mode of ['repair', 'email', 'preserve'] as const) {
      expect(canonical(html, mode)).toBe(html);
    }
  });

  it('reads MJML’s spacer, and a builder’s blank px-high div, as a spacer — its height as written', () => {
    expect(canonical('<div style="height:20px;line-height:20px;">&#8202;</div>')).toBe(SPACER(20));
    expect(canonical('<div style="height: 30px"></div>')).toBe(SPACER(30));
    // Words, or a line break, make a line, never a spacer.
    expect(canonical('<div style="height: 30px">a</div>')).not.toContain('aee-layout-spacer');
    expect(canonical('<div><br></div>')).not.toContain('aee-layout-spacer');
  });

  it('reads its marker first: marked, a spacer even without a height (the default)', () => {
    expect(canonical('<div class="aee-layout-spacer">&nbsp;</div>')).toBe(SPACER(24));
    expect(canonical('<div class="x_aee-layout-spacer" style="height: 48px;">&nbsp;</div>')).toBe(
      SPACER(48),
    );
  });

  it('snaps a set height to 4px steps between 4 and 160px', () => {
    expect(snapSpacerHeight(25)).toBe(24);
    expect(snapSpacerHeight(27)).toBe(28);
    expect(snapSpacerHeight(0)).toBe(SPACER_MIN);
    expect(snapSpacerHeight(999)).toBe(SPACER_MAX);
    editor.commands['insertSpacer'](50);
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, spacerPos())),
    );
    expect(editor.commands['setSpacerHeight'](61)).toBe(true);
    expect(editor.getHTML()).toContain(SPACER(60));
  });

  describe('the handle', () => {
    const drag = (dy: number) => {
      const handle = host.querySelector<HTMLElement>('.aee-spacer__handle')!;
      handle.setPointerCapture = () => {};
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, clientY: 100, pointerId: 1, bubbles: true }),
      );
      handle.dispatchEvent(
        new PointerEvent('pointermove', { clientY: 100 + dy, pointerId: 1, bubbles: true }),
      );
      handle.dispatchEvent(
        new PointerEvent('pointerup', { clientY: 100 + dy, pointerId: 1, bubbles: true }),
      );
    };

    it('drags the height in 4px steps, the label with it — one undo step', () => {
      editor.commands['insertSpacer']();
      drag(17);
      expect(editor.getHTML()).toContain(SPACER(40));
      expect(host.querySelector('.aee-spacer__label')?.textContent).toBe('40 px');
      expect(host.querySelector<HTMLElement>('.aee-spacer')!.style.height).toBe('40px');
    });

    it('takes no drag while layout is static (writer mode)', () => {
      editor.commands['insertSpacer']();
      editor.commands['setLayoutInteraction']({ spacer: false });
      expect(editor.view.dom.getAttribute('data-aee-static')).toContain('spacer');
      drag(40);
      expect(editor.getHTML()).toContain(SPACER(24));
    });
  });
});
