import { emailDocument } from '../../email-document';
import { fitEmailImages } from './image';

const IMG = 'style="max-width: 100%; height: auto;"';

describe('fitEmailImages — the images as sent', () => {
  it('takes the border off every image, a linked one too: the attribute for Outlook, the style for the rest', () => {
    const out = fitEmailImages(
      `<div>a <a href="https://example.com"><img src="x.png" ${IMG}></a> b</div>`,
    );
    expect(out).toContain(
      '<img src="x.png" style="max-width: 100%; height: auto; border: 0;" border="0">',
    );
  });

  it('makes a centred image alone on its line a block, centred by auto margins — no gap under a logo', () => {
    const out = fitEmailImages(
      `<div style="text-align: center;"><img src="{{ company.logoUrl }}" alt="Logo" width="120" ${IMG}></div>`,
    );
    expect(out).toContain(
      'style="max-width: 100%; height: auto; border: 0; display: block; margin-left: auto; margin-right: auto;"',
    );
  });

  it('reads a linked image alone on its line as alone, and a right-aligned one keeps the right', () => {
    const linked = fitEmailImages(
      `<div style="text-align: right;"><a href="https://example.com"><img src="x.png" ${IMG}></a></div>`,
    );
    expect(linked).toContain('display: block; margin-left: auto;"');
    expect(linked).not.toContain('margin-right: auto');
  });

  it('leaves an image among words inline: a block would break the line', () => {
    const out = fitEmailImages(`<div>Hello <img src="x.png" ${IMG}> there</div>`);
    expect(out).not.toContain('display: block');
  });

  it('keeps what an image already says, and changes nothing the second time', () => {
    const once = fitEmailImages(
      `<div style="text-align: center;"><img src="x.png" border="1" style="display: inline-block; border: 2px solid red;"></div>`,
    );
    expect(once).toContain('border="1"');
    expect(once).toContain('display: inline-block; border: 2px solid red;');
    expect(fitEmailImages(once)).toBe(once);
  });

  it('runs in the email document, and only there: the editor’s HTML is not touched', () => {
    const html = `<div style="text-align: center;"><img src="x.png" ${IMG}></div>`;
    const doc = emailDocument(html, { darkMode: false });
    expect(doc).toContain('display: block; margin-left: auto; margin-right: auto;');
    expect(html).not.toContain('display: block');
  });
});
