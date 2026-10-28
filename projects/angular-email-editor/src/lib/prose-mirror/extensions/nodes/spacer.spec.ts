import { NodeSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../../editor';
import { parseHTML, serializeToHTML } from '../../html';
import { createSchema } from '../../schema';
import { emailExtensions } from '../kits';
import { SPACER_MAX, SPACER_MIN, snapSpacerHeight, spacerOfBand } from './spacer';
import { centeredPageLayout, tablePageLayout } from '../../page-layout';

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

  describe('its fill (a strip)', () => {
    const STRIP = (height: number, fill: string) =>
      SPACER(height).replace('exactly;"', `exactly; background-color: ${fill};"`);
    const select = () =>
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, spacerPos())),
      );

    it('is the same one div with its background-color — and reads back, in every parse', () => {
      editor.commands['insertSpacer'](96);
      select();
      expect(editor.commands['setSpacerBackground']('#EFE9E1')).toBe(true);
      const out = editor.getHTML();
      expect(out).toContain(STRIP(96, '#efe9e1'));
      for (const mode of ['repair', 'email', 'preserve'] as const) {
        expect(canonical(out, mode)).toBe(out);
      }
      // The editor paints it as sent.
      const view = host.querySelector<HTMLElement>('.aee-spacer')!;
      expect(view.style.backgroundColor).toBe('rgb(239, 233, 225)');
      expect(view.hasAttribute('data-fill')).toBe(true);
      editor.commands['setSpacerBackground'](null);
      expect(editor.getHTML()).toContain(SPACER(96));
      expect(view.hasAttribute('data-fill')).toBe(false);
    });

    it('sets nothing without a spacer selected', () => {
      expect(editor.commands['setSpacerBackground']('#efe9e1')).toBe(false);
    });

    it('on a page of rows is a row of its fill with no padding round a plain spacer — and back', () => {
      editor.setContent(`<div>a</div>${STRIP(48, '#efe9e1')}<div>b</div>`);
      editor.commands['setPageLayout'](tablePageLayout());
      const rows: { background: unknown; padding: unknown; inner: string }[] = [];
      editor.state.doc.forEach((row) =>
        rows.push({
          background: row.attrs['background'],
          padding: row.attrs['padding'],
          inner: `${row.firstChild!.type.name}:${row.firstChild!.attrs['background'] ?? ''}`,
        }),
      );
      expect(rows[1]).toEqual({ background: '#efe9e1', padding: '0px', inner: 'spacer:' });
      editor.commands['setPageLayout'](null);
      const back: string[] = [];
      editor.state.doc.forEach((node) => back.push(node.type.name));
      expect(back).toEqual(['paragraph', 'spacer', 'paragraph']);
      expect(editor.getHTML()).toContain(STRIP(48, '#efe9e1'));
    });

    it('in a centred page stands in the column as a band does — never inset in a run — and reads back', () => {
      editor.setContent(`<div>a</div>${STRIP(48, '#efe9e1')}<div>b</div>`);
      editor.commands['setPageLayout'](centeredPageLayout());
      const out = editor.getHTML();
      const column = new DOMParser()
        .parseFromString(out, 'text/html')
        .querySelector('.aee-layout-page-column')!;
      expect(Array.from(column.children, (child) => child.className)).toEqual([
        'aee-layout-page-run',
        'aee-layout-spacer',
        'aee-layout-page-run',
      ]);
      const doc = parseHTML(out, schema, { mode: 'preserve' });
      const names: string[] = [];
      doc.forEach((node) => names.push(node.type.name));
      expect(names).toEqual(['paragraph', 'spacer', 'paragraph']);
      expect(doc.child(1).attrs['background']).toBe('#efe9e1');
    });

    it('stands for a band that holds nothing but room — one spacer, as tall, the band’s fill', () => {
      editor.setContent(
        '<table class="aee-layout-section" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
          '<td bgcolor="#efe9e1" style="padding: 32px 0px; background-color: rgb(239, 233, 225); color: rgb(32, 33, 36);">' +
          `<div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box;">${SPACER(32)}</div>` +
          '</td></tr></tbody></table><div>after</div>',
      );
      // The caret in the band: on its spacer.
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)));
      expect(spacerOfBand(editor.state)).toEqual({ height: 96, background: '#efe9e1' });
      expect(editor.commands['bandToSpacer']()).toBe(true);
      expect(editor.state.doc.firstChild!.type.name).toBe('spacer');
      expect(editor.state.doc.firstChild!.attrs).toMatchObject({
        height: 96,
        background: '#efe9e1',
      });
      expect(editor.getHTML()).toContain(STRIP(96, '#efe9e1'));
    });

    it('stands for no band with words in it', () => {
      editor.commands['insertSection']('#efe9e1');
      expect(spacerOfBand(editor.state)).toBeNull();
      expect(editor.commands['bandToSpacer']()).toBe(false);
    });
  });
});
