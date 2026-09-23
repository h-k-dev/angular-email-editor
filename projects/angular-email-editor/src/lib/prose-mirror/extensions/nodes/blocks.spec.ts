import { NodeSelection, TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailPlainText } from '../../plain-text';
import { createEditor } from '../../editor';
import { emailExtensions } from '../kits';
import { isActionEnabled } from '../../extension';
import { createButtonEdit, selectedButton } from './button';

const schema = createSchema(emailExtensions);
const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

const DIVIDER =
  '<hr style="height: 1px; width: 100%; background-color: rgb(224, 224, 224); ' +
  'margin-top: 12px; margin-bottom: 12px;">';
const BUTTON_STYLE =
  'display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); ' +
  'font-weight: bold; text-decoration: none; border-width: 14px 28px; border-style: solid; ' +
  'border-color: rgb(26, 115, 232);';

describe('divider block', () => {
  it('round-trips to a full-width rule', () => {
    expect(roundTrip('<hr>')).toBe(DIVIDER);
    expect(roundTrip(DIVIDER)).toBe(DIVIDER);
  });

  it('renders as --- in plain text', () => {
    expect(emailPlainText('<div>above</div><hr><div>below</div>')).toBe('above\n---\nbelow');
  });
});

describe('button', () => {
  it('serializes as a bordered inline-block anchor — the Outlook-safe button', () => {
    expect(
      roundTrip(
        `<a href="https://x.io" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">Shop now</a>`,
      ),
    ).toBe(
      `<div><a href="https://x.io" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">Shop now</a></div>`,
    );
  });

  it('sits on a line of text, or in a table cell', () => {
    expect(
      roundTrip(
        `<div>Click <a href="https://x.io" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">here</a></div>`,
      ),
    ).toBe(
      `<div>Click <a href="https://x.io" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">here</a></div>`,
    );
    const inCell = roundTrip(
      `<table><tbody><tr><td><a href="https://x.io" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">Shop</a></td></tr></tbody></table>`,
    );
    expect(inCell).toContain(
      `<a href="https://x.io" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">Shop</a>`,
    );
    expect(inCell).toContain('<td');
    expect(roundTrip(inCell)).toBe(inCell);
  });

  it('is distinct from a plain link — no display:inline-block, stays a link', () => {
    const link = roundTrip('<div><a href="https://x.io">plain</a></div>');
    expect(link).toBe(
      '<div><a href="https://x.io" target="_blank" rel="noopener noreferrer">plain</a></div>',
    );
    // And an inline-block anchor is NOT read as a link inside a paragraph:
    // both carry target and rel now, but only a link is a bare anchor.
    const button = roundTrip(`<a href="https://x.io" style="${BUTTON_STYLE}">CTA</a>`);
    expect(button).toContain(`style="${BUTTON_STYLE}">CTA</a>`);
    expect(button).not.toContain('rel="noopener noreferrer">');
  });

  it('refuses a script URL — the button is dropped, as the link mark drops it', () => {
    const out = roundTrip(
      `<div><a href="javascript:alert(1)" style="${BUTTON_STYLE}">Go</a></div>`,
    );
    // No anchor at all: neither a button nor a link. The words stay, with
    // what the parser reads off any styled inline (its bold).
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<a');
    expect(out).toContain('Go');
  });

  it('flattens the label to plain text (atom reads textContent)', () => {
    expect(
      roundTrip(
        `<a href="#" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}"><strong>bold?</strong></a>`,
      ),
    ).toBe(
      `<div><a href="#" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">bold?</a></div>`,
    );
  });

  it('produces lint-clean output', () => {
    expect(
      lintHTML(
        `<a href="https://x.io" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">Go</a>`,
      ),
    ).toEqual([]);
    expect(lintHTML(DIVIDER)).toEqual([]);
  });

  it('renders its label in plain text', () => {
    expect(
      emailPlainText(
        `<a href="https://x.io" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">Shop now</a>`,
      ),
    ).toBe('Shop now');
  });

  it('insertButton drops a default button as an inert atom', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>hi</div>',
    });
    try {
      editor.exec((state, dispatch) => {
        dispatch?.(
          state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
        );
        return true;
      });
      editor.commands['insertButton']();
      expect(editor.getHTML()).toBe(
        `<div>hi<a href="#" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">Button</a></div>`,
      );
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  describe('selected like a character, as an image is', () => {
    const mount = () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({
        parent: host,
        extensions: emailExtensions,
        content: `<div>Go <a href="https://x.io" style="${BUTTON_STYLE}">Shop</a> now</div>`,
      });
      const pos = 4; // <div>(0) G o ␣ → the button at 4
      return {
        editor,
        pos,
        anchor: editor.view.nodeDOM(pos) as HTMLElement,
        unmount: () => (editor.destroy(), host.remove()),
      };
    };

    it('a drag that ends inside it covers it — ProseMirror alone would stop short', () => {
      const { editor, pos, anchor, unmount } = mount();
      const { view } = editor;
      const before = anchor.previousSibling!;
      document.getSelection()!.setBaseAndExtent(before, 3, anchor, 0);
      const $anchor = view.state.doc.resolve(view.posAtDOM(before, 3));
      const $head = view.state.doc.resolve(view.posAtDOM(anchor, 0));
      const selection = view.someProp('createSelectionBetween', (f) => f(view, $anchor, $head));
      expect([selection?.anchor, selection?.head]).toEqual([pos, pos + 1]);
      unmount();
    });

    it('a range over it paints it as selected; a click selects it as a node', () => {
      const { editor, pos, anchor, unmount } = mount();
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, pos + 2)),
      );
      expect(anchor.classList.contains('aee-atom--in-selection')).toBe(true);
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
      );
      expect(anchor.classList.contains('ProseMirror-selectednode')).toBe(true);
      expect(anchor.classList.contains('aee-atom--in-selection')).toBe(false);
      unmount();
    });

    it('selected, Delete takes it out — as it does an image', () => {
      const { editor, pos, unmount } = mount();
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
      );
      const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(editor.getHTML()).toBe('<div>Go  now</div>');
      unmount();
    });
  });

  describe('a click on a button edits it, never follows it', () => {
    const mount = (extensions = emailExtensions) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({
        parent: host,
        extensions,
        content: `<div>Go <a href="https://x.io" style="${BUTTON_STYLE}">Shop</a></div>`,
      });
      const pos = 4; // <div>(0) G o ␣ → the button at 4
      const anchor = editor.view.nodeDOM(pos) as HTMLAnchorElement;
      // ProseMirror's click path, as its mouseup runs it on a direct click.
      const click = (init: MouseEventInit = {}) => {
        const event = new MouseEvent('mouseup', init);
        const node = editor.state.doc.nodeAt(pos)!;
        return editor.view.someProp('handleClickOn', (f) =>
          f(editor.view, pos, node, pos, event, true),
        );
      };
      return { editor, pos, anchor, click, unmount: () => (editor.destroy(), host.remove()) };
    };

    it('the browser never follows the anchor — a click or a middle click', () => {
      const { anchor, unmount } = mount();
      for (const type of ['click', 'auxclick']) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 1 });
        anchor.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
      unmount();
    });

    it('selects the button, and Ctrl/Cmd+click does not open it either', () => {
      const { editor, pos, click, unmount } = mount();
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      expect(click({ ctrlKey: true })).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(selectedButton(editor.state)?.pos).toBe(pos);
      open.mockRestore();
      unmount();
    });

    it('is no stop in the Tab order in the editor — and the email never says so', () => {
      const { editor, anchor, unmount } = mount();
      expect(anchor.getAttribute('tabindex')).toBe('-1');
      expect(editor.getHTML()).not.toContain('tabindex');
      unmount();
    });

    it('a click hands the caret to the editor, not the anchor', () => {
      const { editor, click, unmount } = mount();
      const focus = vi.spyOn(editor.view, 'focus');
      click();
      expect(focus).toHaveBeenCalled();
      unmount();
    });

    it('tells a host that asked, so it can open its link editor on it', () => {
      const onEdit = vi.fn();
      const { pos, click, unmount } = mount([...emailExtensions, createButtonEdit({ onEdit })]);
      click();
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ pos }));
      unmount();
    });
  });

  describe('button-link: selected text ⇄ a button', () => {
    const mount = (content: string) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({ parent: host, extensions: emailExtensions, content });
      const select = (from: number, to: number) =>
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
        );
      const action = editor.actions.find((a) => a.id === 'button-link')!;
      return {
        editor,
        select,
        enabled: () => isActionEnabled(action, editor.state),
        pressed: () => action.isActive!(editor.state),
        unmount: () => (editor.destroy(), host.remove()),
      };
    };

    it('turns selected text into a button — the text its label — and selects it', () => {
      const { editor, select, pressed, unmount } = mount('<div>Go to the shop now</div>');
      select(4, 15); // "to the shop"
      expect(editor.commands['toggleButtonLink']()).toBe(true);
      expect(editor.getHTML()).toBe(
        `<div>Go <a href="#" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">to the shop</a> now</div>`,
      );
      expect(selectedButton(editor.state)?.node.attrs['label']).toBe('to the shop');
      expect(pressed()).toBe(true);
      unmount();
    });

    it('leaves the spaces around the words where they are — a double-click takes the trailing one', () => {
      const { editor, select, unmount } = mount('<div>Go to the shop now</div>');
      select(3, 16); // " to the shop "
      editor.commands['toggleButtonLink']();
      expect(editor.getHTML()).toBe(
        `<div>Go <a href="#" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">to the shop</a> now</div>`,
      );
      unmount();
    });

    it('keeps the link the text carried, and gives it back when toggled off', () => {
      const { editor, select, unmount } = mount(
        '<div>Read <a href="https://example.com/r">the report</a></div>',
      );
      select(6, 16);
      editor.commands['toggleButtonLink']();
      expect(selectedButton(editor.state)?.node.attrs['href']).toBe('https://example.com/r');

      editor.commands['toggleButtonLink']();
      expect(selectedButton(editor.state)).toBeNull();
      expect(editor.getHTML()).toContain('href="https://example.com/r"');
      expect(editor.getHTML()).toContain('>the report</a>');
      expect(editor.getHTML()).not.toContain('inline-block');
      expect(editor.state.selection.from).toBe(6);
      expect(editor.state.selection.to).toBe(16);
      unmount();
    });

    it('is one undo step of its own — never merged with the typing just before', () => {
      const { editor, select, unmount } = mount('<div>Buy <b>now</b></div>');
      editor.view.dispatch(editor.state.tr.insertText('!', 8)); // typed a moment ago
      select(5, 8);
      editor.commands['toggleButtonLink']();
      editor.exec(undo);
      // The typed "!" is still there (it took the bold); only the button went.
      expect(editor.getHTML()).toBe(
        '<div>Buy <strong style="font-weight: bold;">now!</strong></div>',
      );
      unmount();
    });

    it('a placeholder button goes back to plain text, with no link', () => {
      const { editor, select, unmount } = mount('<div>Buy now</div>');
      select(1, 8);
      editor.commands['toggleButtonLink']();
      editor.commands['toggleButtonLink']();
      expect(editor.getHTML()).toBe('<div>Buy now</div>');
      unmount();
    });

    it('sets a selected button’s link, keeping it selected; empty is the placeholder', () => {
      const { editor, select, unmount } = mount('<div>Buy now</div>');
      select(1, 8);
      editor.commands['toggleButtonLink']();
      expect(editor.commands['setButtonHref'](' https://shop.example ')).toBe(true);
      expect(selectedButton(editor.state)?.node.attrs['href']).toBe('https://shop.example');
      editor.commands['setButtonHref']('');
      expect(selectedButton(editor.state)?.node.attrs['href']).toBe('#');
      expect(editor.commands['setButtonHref']('javascript:alert(1)')).toBe(false);
      expect(selectedButton(editor.state)?.node.attrs['href']).toBe('#');
      unmount();
    });

    it('is only there for a text-only range in one line, or a button — never at a caret', () => {
      const { editor, select, enabled, unmount } = mount(
        '<div>one</div><div>two<br>three {{ name }}</div>',
      );
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
      expect(enabled()).toBe(false); // a caret
      select(2, 8);
      expect(enabled()).toBe(false); // across two lines
      select(6, 12);
      expect(enabled()).toBe(false); // a line break inside
      select(6, 9);
      expect(enabled()).toBe(true); // "two"
      select(10, editor.state.doc.content.size - 1);
      expect(enabled()).toBe(true); // "three {{ name }}" — a token is text
      unmount();
    });
  });

  it('insertButton drops a button into a table cell', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<table><tbody><tr><td></td></tr></tbody></table>',
    });
    try {
      editor.exec((state, dispatch) => {
        let cell = 0;
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'tableCell') cell = pos;
          return true;
        });
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, cell + 1)));
        return true;
      });
      expect(editor.commands['insertButton']()).toBe(true);
      const html = editor.getHTML();
      expect(html).toContain(
        `<a href="#" target="_blank" rel="noopener noreferrer" style="${BUTTON_STYLE}">Button</a>`,
      );
      expect(html).toContain('<td');
      expect(html).not.toContain('</table><a');
      expect(roundTrip(html)).toBe(html);
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
