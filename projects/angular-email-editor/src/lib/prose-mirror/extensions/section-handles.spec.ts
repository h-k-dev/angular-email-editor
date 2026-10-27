import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { SectionHandleTarget, createSectionHandles } from './section-handles';
import { tablePageLayout } from '../page-layout';

describe('section handles', () => {
  let host: HTMLElement;
  let editor: Editor;
  let opened: (SectionHandleTarget | null)[];

  const BAND =
    '<table class="aee-layout-section" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
    '<td bgcolor="#e8f0fe" style="padding: 20px 0px; background-color: rgb(232, 240, 254); color: rgb(32, 33, 36);">' +
    '<div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box;"><div>band</div></div>' +
    '</td></tr></tbody></table>';

  const grips = () => host.querySelectorAll<HTMLElement>('.aee-grip--section');
  const caretAt = (text: string) => {
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === text) at = pos + 1;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    opened = [];
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createSectionHandles({ onOpen: (target) => opened.push(target), label: () => 'Band' }),
      ],
      content: `<div>before</div>${BAND}`,
      parseMode: 'preserve',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('shows one grip on the band the caret is in, and none outside a band', () => {
    // Every band has its grip — revealed on hover by the host — and the
    // caret's band wears it always on (`data-caret`).
    caretAt('before');
    expect(grips()).toHaveLength(1);
    expect(grips()[0].hasAttribute('data-caret')).toBe(false);
    caretAt('band');
    expect(grips()).toHaveLength(1);
    expect(grips()[0].hasAttribute('data-caret')).toBe(true);
    const grip = grips()[0];
    expect(grip.closest('.aee-section')).not.toBeNull();
    expect(grip.getAttribute('role')).toBe('button');
    expect(grip.getAttribute('aria-haspopup')).toBe('menu');
    expect(grip.getAttribute('aria-label')).toBe('Band');
  });

  it('opens the menu with the band, the caret staying in it', () => {
    caretAt('band');
    const { from } = editor.state.selection;
    grips()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opened).toHaveLength(1);
    expect(opened[0]!.kind).toBe('section');
    expect(editor.state.doc.nodeAt(opened[0]!.sectionPos)!.type.name).toBe('section');
    expect(editor.state.selection.from).toBe(from);
    expect(grips()[0].getAttribute('aria-expanded')).toBe('true');
  });

  it("puts the caret in the band whose grip is pressed from outside it — hovered, not the caret's", () => {
    caretAt('before');
    const grip = grips()[0];
    // Measured before the caret moves: the pressed grip's own rect, which a
    // re-render would detach.
    const rect = new DOMRect(10, 20, 22, 14);
    grip.getBoundingClientRect = () => rect;
    grip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opened).toHaveLength(1);
    const band = editor.state.doc.nodeAt(opened[0]!.sectionPos)!;
    expect(band.type.name).toBe('section');
    expect(editor.state.selection.$from.node(1)).toBe(band);
    expect(opened[0]!.boundingBox).toBe(rect);
    expect(grips()[0].hasAttribute('data-caret')).toBe(true);
    expect(grips()[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('closes an open menu when the band goes', () => {
    caretAt('band');
    grips()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    editor.commands['removeSection']();
    expect(opened.at(-1)).toBeNull();
    expect(grips()).toHaveLength(0);
  });

  it('has no grip while sections are static (writer mode)', () => {
    caretAt('band');
    editor.commands['setLayoutInteraction']?.({ section: false });
    expect(grips()).toHaveLength(0);
  });

  it("shows on a page of rows' band — a row given a fill — and not on a plain row", () => {
    editor.commands['setPageLayout'](tablePageLayout());
    caretAt('before');
    const row = () => host.querySelector('.aee-page-row')!;
    expect(editor.state.doc.child(0).type.name).toBe('pageRow');
    // The band turned row has its grip; the plain row the caret is in, none.
    expect(row().querySelector('.aee-grip--section')).toBeNull();
    editor.commands['insertSection']('#e6f4ea');
    const grip = row().querySelector<HTMLElement>('.aee-grip--section')!;
    expect(grip.hasAttribute('data-caret')).toBe(true);
    grip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.state.doc.nodeAt(opened.at(-1)!.sectionPos)!.type.name).toBe('pageRow');
    // Remove: a plain row again — the grip goes, the menu closes.
    editor.commands['removeSection']();
    expect(editor.state.doc.child(0).attrs['background']).toBeNull();
    expect(editor.state.doc.child(0).textContent).toBe('before');
    expect(row().querySelector('.aee-grip--section')).toBeNull();
    expect(opened.at(-1)).toBeNull();
  });

  it('never goes into the email', () => {
    caretAt('band');
    expect(editor.getHTML()).not.toContain('aee-grip');
  });
});
