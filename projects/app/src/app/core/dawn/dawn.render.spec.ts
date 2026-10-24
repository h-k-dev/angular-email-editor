import { PAPER, messageHtml, dawnDocument } from './dawn.render';
import { DAWN_DARK_SURFACE, dawnDarkColor } from './dawn-dark.render';

describe('dawnDocument', () => {
  // The palette's black, written by hand: a received fragment, as it came.
  const body = '<p style="color: #202124">Hello</p>';

  it('lays the email on the editor’s paper, edge to edge, light or dark', () => {
    expect(PAPER).toEqual({ light: '#ffffff', dark: '#1e1e1e' });
    const light = dawnDocument(body, { scheme: 'light' });
    expect(light).toContain(`background: ${PAPER.light}`);
    expect(light).toContain('<style>body { margin: 0; }</style>');
    const dark = dawnDocument(body, { scheme: 'dark' });
    expect(dark).toContain(`html { background: ${DAWN_DARK_SURFACE}; }`);
    expect(DAWN_DARK_SURFACE).toBe(PAPER.dark);
  });

  it('insets a simple email’s text at its sides, never a whole document', () => {
    expect(dawnDocument(body, { scheme: 'light', inset: 32 })).toContain(
      '<style>body { margin: 0; padding-inline: 32px; }</style>',
    );
    const newsletter = '<!doctype html><html><head></head><body><table><tr><td>Hi</td></tr></table></body></html>';
    expect(dawnDocument(newsletter, { scheme: 'light', inset: 32 })).toContain(
      '<style>body { margin: 0; }</style>',
    );
  });

  it('is a whole document whose links leave for a tab of their own', () => {
    const document = dawnDocument(body, { scheme: 'light' });
    expect(document.startsWith('<!doctype html>')).toBe(true);
    expect(document).toContain('<base target="_blank">');
    expect(document).toContain('Hello');
  });

  it('reads dark in dawn dark: a message that declares nothing has its colours turned', () => {
    const dark = dawnDocument(body, { scheme: 'dark' });
    expect(dark).toContain(`color: ${dawnDarkColor('#202124')}`);
    // Received mail is drawn as it came: none of the editor's own
    // dark-mode classes put in, and no inversion of the page.
    expect(dark).not.toMatch(/aee-dt-/);
    expect(dark).not.toContain('invert(');
  });
});

describe('messageHtml', () => {
  it('reads a text-only message as lines', () => {
    expect(messageHtml({ text: 'One\n\nTwo' })).toBe('<div>One</div><div><br></div><div>Two</div>');
    expect(messageHtml({ html: '<p>x</p>', text: 'x' })).toBe('<p>x</p>');
  });
});
