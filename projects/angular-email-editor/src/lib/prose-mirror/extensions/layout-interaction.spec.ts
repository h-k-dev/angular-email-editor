import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { BlockMenuState, createBlockMenu } from './block-menu';
import { TableHandleTarget, createTableHandles } from './table-handles';
import {
  LAYOUT_INTERACTIVE,
  LAYOUT_STATIC_ATTRIBUTE,
  layoutInteractive,
  layoutInteractivity,
} from './layout-interaction';

/** A press on a `+` pill released in place: its click (a drag is the
    render spec's). */
const tap = (pill: HTMLElement) => {
  pill.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
};

describe('layout interaction', () => {
  let host: HTMLElement;
  let editor: Editor;
  let menu: BlockMenuState;
  let opened: (TableHandleTarget | null)[];

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    menu = { isOpen: false, boundingBox: null, block: null };
    opened = [];
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createBlockMenu({ onStateChange: (next) => (menu = next) }),
        createTableHandles({ onOpen: (target) => opened.push(target) }),
      ],
      content: '<div>intro</div>',
    });
    editor.focus();
    editor.exec((s, dispatch) => {
      dispatch?.(s.tr.setSelection(TextSelection.create(s.doc, s.doc.content.size - 1)));
      return true;
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  const off = (types: Partial<Record<'section' | 'columns' | 'table', boolean>>) =>
    editor.commands['setLayoutInteraction'](types);

  it('is on for every layout block by default, and says nothing on the root', () => {
    expect(layoutInteractivity(editor.state)).toEqual(LAYOUT_INTERACTIVE);
    expect(editor.view.dom.hasAttribute(LAYOUT_STATIC_ATTRIBUTE)).toBe(false);
  });

  it('switches by type, the others keeping theirs, named on the editor root', () => {
    off({ table: false });
    off({ columns: false });
    expect(layoutInteractive(editor.state, 'table')).toBe(false);
    expect(layoutInteractive(editor.state, 'columns')).toBe(false);
    expect(layoutInteractive(editor.state, 'section')).toBe(true);
    expect(editor.view.dom.getAttribute(LAYOUT_STATIC_ATTRIBUTE)).toBe('columns table');

    off({ table: true, columns: true });
    expect(editor.view.dom.hasAttribute(LAYOUT_STATIC_ATTRIBUTE)).toBe(false);
  });

  it('is no edit: the document and its undo stay as they were', () => {
    const html = editor.getHTML();
    off({ section: false });
    expect(editor.getHTML()).toBe(html);
    expect(editor.commands['undo']?.() ?? false).toBe(false);
  });

  it('closes the block menu of a static block, and opens it again when switched back', () => {
    editor.commands['insertSection']();
    expect(menu.isOpen).toBe(true);
    expect(menu.block).toBe('section');

    off({ section: false });
    expect(menu.isOpen).toBe(false);

    off({ section: true });
    expect(menu.isOpen).toBe(true);
  });

  it('takes a static layout table’s grips away, telling an open menu it has none', () => {
    editor.commands['insertTable'](2, 2, 'layout');
    expect(host.querySelectorAll('.aee-grip').length).toBeGreaterThan(0);

    off({ table: false });
    expect(host.querySelectorAll('.aee-grip').length).toBe(0);
    expect(opened.at(-1)).toBeNull();

    off({ table: true });
    expect(host.querySelectorAll('.aee-grip').length).toBeGreaterThan(0);
  });

  it('leaves a static layout table’s pills doing nothing, and says which wrap is one', () => {
    editor.commands['insertTable'](2, 2, 'layout');
    off({ table: false, columns: false });
    expect(host.querySelector('.aee-table-wrap')!.classList).toContain('aee-table-wrap--layout');
    const rows = () => host.querySelectorAll('tr').length;
    const before = rows();
    tap(host.querySelector<HTMLElement>('.aee-add-pill--row')!);
    expect(rows()).toBe(before);

    off({ table: true });
    tap(host.querySelector<HTMLElement>('.aee-add-pill--row')!);
    expect(rows()).toBe(before + 1);
  });

  for (const kind of ['bordered', 'borderless'] as const) {
    it(`leaves a ${kind} table its grips and pills: content, not layout`, () => {
      editor.commands['insertTable'](2, 2, kind);
      off({ table: false });
      expect(host.querySelector('.aee-table-wrap')!.classList).not.toContain(
        'aee-table-wrap--layout',
      );
      // Row and column grips, the caret cell's, and the table's ring.
      expect(host.querySelectorAll('.aee-grip').length).toBe(6);
      const before = host.querySelectorAll('tr').length;
      tap(host.querySelector<HTMLElement>('.aee-add-pill--row')!);
      expect(host.querySelectorAll('tr').length).toBe(before + 1);
    });
  }

  it('keeps a bordered table its grips beside a static layout table', () => {
    editor.commands['insertTable'](1, 1, 'layout');
    editor.exec((s, dispatch) => {
      dispatch?.(s.tr.setSelection(TextSelection.create(s.doc, s.doc.content.size - 1)));
      return true;
    });
    editor.commands['insertTable'](2, 2, 'bordered');
    off({ table: false });
    const [layout, bordered] = Array.from(host.querySelectorAll('.aee-table-wrap'));
    expect(layout.querySelectorAll('.aee-grip').length).toBe(0);
    expect(bordered.querySelectorAll('.aee-grip').length).toBeGreaterThan(0);
  });
});
