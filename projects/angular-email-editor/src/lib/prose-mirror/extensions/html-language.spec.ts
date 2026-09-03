import { createEditor } from '../editor';
import { htmlSourceExtensions } from './kits';
import { scanMergeTags } from './nodes/merge-tag';

describe('html-language — interpolation highlighting', () => {
  it('scanMergeTags finds each token and the expression inside it', () => {
    expect(scanMergeTags('Hi {{ firstName }} and {{cf_70|formatPrice}} {{#if x}}')).toEqual([
      { from: 3, to: 18, expr: [5, 16] },
      { from: 23, to: 44, expr: [25, 42] },
    ]);
  });

  it('paints the braces muted and the expression set apart, Angular-template style', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({ parent: host, extensions: htmlSourceExtensions, content: '' });
    editor.setText('<div>Hi {{ firstName }}, {{ cf_70 | formatPrice }}!</div>');
    const braces = [...editor.view.dom.querySelectorAll('.aee-tok-brace')].map((el) => el.textContent);
    const expressions = [...editor.view.dom.querySelectorAll('.aee-tok-expression')].map(
      (el) => el.textContent,
    );
    expect(braces).toEqual(['{{', '}}', '{{', '}}']);
    expect(expressions).toEqual([' firstName ', ' cf_70 | formatPrice ']);
    // A token the formatter wrapped over lines is still one token.
    editor.setText("<div>\n  {{\n    a == 'x' ? 'y' : 'z'\n  }}\n</div>");
    expect([...editor.view.dom.querySelectorAll('.aee-tok-brace')].map((el) => el.textContent)).toEqual(['{{', '}}']);
    expect(scanMergeTags("{{\n  a\n}}", { multiline: true })).toEqual([{ from: 0, to: 9, expr: [2, 7] }]);
    // Tag tokens keep their own classes; braces inside a tag are never tokens.
    editor.setText('<div title="{{ notAToken }}">x</div>');
    expect(editor.view.dom.querySelector('.aee-tok-brace')).toBeNull();
    editor.destroy();
    host.remove();
  });
});
