import { createEditor } from '../editor';
import { dawnDarkColor } from '@h-k-dev/dawn';
import { createDarkRendering, darkRenderingCss } from './dark-rendering';
import { emailExtensions } from './kits';

describe('createDarkRendering', () => {
  function mount(content: string, scope?: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({
      parent: host,
      extensions: [...emailExtensions, createDarkRendering({ scope })],
      content,
    });
    const id = editor.view.dom.getAttribute('data-aee-render');
    const sheet = () => document.head.querySelector<HTMLStyleElement>(`style[data-aee-render="${id}"]`);
    const unmount = () => {
      editor.destroy();
      host.remove();
    };
    return { editor, id, sheet, unmount };
  }

  it('draws each colour spelling of the editor dark by Dawn, the document untouched', () => {
    const { editor, id, sheet, unmount } = mount(
      '<div><span style="color: #000000">ink</span> words</div>',
      '.paper-dark .aee-editor',
    );
    const css = sheet()?.textContent ?? '';
    const root = `.paper-dark .aee-editor[data-aee-render="${id}"]`;
    expect(css).toContain(`${root} { color: rgb(255, 255, 255); background-color: #1e1e1e; }`);
    expect(css).toContain(
      `${root} [style="color: #000000"] { color: rgb(255, 255, 255) !important; }`,
    );
    // The colour written stays the light one.
    expect(editor.getHTML()).toContain('color: #000000');
    unmount();
  });

  it('follows the colours as they are written, and leaves with the editor', () => {
    const { editor, sheet, unmount } = mount('<div>plain</div>');
    expect(sheet()?.textContent).not.toContain('[style=');
    editor.setContent('<div><span style="color: #ff0000">red</span></div>');
    expect(sheet()?.textContent).toContain(`color: ${dawnDarkColor('#ff0000')} !important`);
    unmount();
    expect(sheet()).toBeNull();
  });

  it('draws the legacy colour attributes too — the inline style’s rules after them', () => {
    const dom = document.createElement('div');
    dom.innerHTML =
      '<table bgcolor="#ffffff"><tr><td style="background-color: #000000">x</td></tr></table>' +
      '<font color="#ffffff">y</font>';
    const { css } = darkRenderingCss(dom, '.r');
    const bg = css.indexOf('[bgcolor="#ffffff" i] { background-color: #333333 !important; }');
    const font = css.indexOf('font[color="#ffffff" i] { color: #333333 !important; }');
    const style = css.indexOf('[style="background-color: #000000"]');
    expect(bg).toBeGreaterThan(-1);
    expect(font).toBeGreaterThan(-1);
    expect(style).toBeGreaterThan(bg);
  });

  it('draws the root’s own fill dark, and leaves its custom properties as written', () => {
    // A page layout's root: its fills as custom properties, each already
    // written for both lights, beside the document's body fill.
    const dom = document.createElement('div');
    dom.setAttribute(
      'style',
      '--aee-page-background: #f1f3f4; --aee-page-background-dark: rgb(60, 62, 62); background: #f3f5f8',
    );
    const { css } = darkRenderingCss(dom, '.r');
    const own = css.split('\n').find((rule) => rule.startsWith('.r[style='))!;
    const body = own.slice(own.lastIndexOf('{'));
    expect(body).toContain(`background: ${dawnDarkColor('#f3f5f8')} !important;`);
    // Drawn dark again, the dark fill would come out light.
    expect(body).not.toContain('--aee-page-background');
  });

  it('gives a root of custom properties alone no rule of its own', () => {
    const dom = document.createElement('div');
    dom.setAttribute(
      'style',
      '--aee-page-background: #f1f3f4; --aee-page-background-dark: #3c3e3e',
    );
    const { css } = darkRenderingCss(dom, '.r');
    expect(css).not.toContain('.r[style=');
  });

  it('quotes a style it matches exactly, quotes and all', () => {
    const dom = document.createElement('div');
    dom.innerHTML = `<p style='font-family: "Tan"; color: #000000'>x</p>`;
    const { css } = darkRenderingCss(dom, '.r');
    expect(css).toContain('.r [style="font-family: \\"Tan\\"; color: #000000"]');
  });
});
