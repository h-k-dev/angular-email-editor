import { TestBed } from '@angular/core/testing';
import { TextSelection } from 'prosemirror-state';
import { Document, Paragraph, Text, createEditor, richTextExtensions } from 'angular-email-editor';
import {
  EMAIL_PALETTE,
  colorSuggestions,
  emailPalette,
  injectPalette,
  providePalette,
} from './palette';

describe('EMAIL_PALETTE', () => {
  it('is the library’s palette unless a host provides one', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(EMAIL_PALETTE)).toBe(emailPalette);
    expect(TestBed.runInInjectionContext(injectPalette)).toBe(emailPalette);
  });

  it('takes a host’s side and keeps the other', () => {
    const text = [{ name: 'Brand', value: '#0a5c36' }];
    TestBed.configureTestingModule({ providers: [providePalette({ text })] });
    const palette = TestBed.inject(EMAIL_PALETTE);
    expect(palette.text).toBe(text);
    expect(palette.background).toBe(emailPalette.background);
  });

  it('lets a host mix with the library’s, by a function of it', () => {
    TestBed.configureTestingModule({
      providers: [
        providePalette((defaults) => ({
          text: [...defaults.text.slice(0, 2), { name: 'Brand', value: '#0a5c36' }],
          background: defaults.background.filter((color) => color.name !== 'Black'),
        })),
      ],
    });
    const palette = TestBed.inject(EMAIL_PALETTE);
    expect(palette.text.map((color) => color.name)).toEqual(['Black', 'Gray', 'Brand']);
    expect(palette.background.some((color) => color.name === 'Black')).toBe(false);
  });
});

describe('colorSuggestions', () => {
  it('lists every colour of both sides as a row that colours the selection', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const editor = createEditor({
      parent: mount,
      extensions: richTextExtensions,
      content: '<p>Hello</p>',
    });
    const ctx = { schema: editor.schema, extensions: richTextExtensions };
    const palette = {
      text: [{ name: 'Red', value: '#c5221f' }],
      background: [{ name: 'Pale blue', value: '#e8f0fe' }],
    };
    const items = colorSuggestions(ctx, palette);
    expect(items.map((item) => [item.id, item.title, item.section, item.swatch])).toEqual([
      ['color-red', 'Red text', 'color', '#c5221f'],
      ['background-pale-blue', 'Pale blue background', 'color', '#e8f0fe'],
    ]);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    );
    editor.exec(items[0].command);
    expect(editor.getHTML()).toContain('color: rgb(197, 34, 31)');
    editor.exec(items[1].command);
    expect(editor.getHTML()).toContain('background-color: rgb(232, 240, 254)');
    editor.destroy();
    mount.remove();
  });

  it('is nothing without the TextStyle mark', () => {
    const extensions = [Document, Paragraph, Text];
    const editor = createEditor({ parent: document.createElement('div'), extensions });
    expect(colorSuggestions({ schema: editor.schema, extensions }, emailPalette)).toEqual([]);
    editor.destroy();
  });
});
