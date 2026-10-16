import {
  emailDefaultFont,
  emailFontFaces,
  emailFontFamilies,
  fontClients,
  isEmailFontStack,
  matchEmailFont,
} from './fonts';

describe('email fonts', () => {
  it('is Gmail’s set, in Gmail’s order', () => {
    expect(emailFontFamilies.map((f) => f.name)).toEqual([
      'Sans Serif',
      'Serif',
      'Fixed width',
      'Wide',
      'Narrow',
      'Comic Sans MS',
      'Garamond',
      'Georgia',
      'Tahoma',
      'Trebuchet MS',
      'Verdana',
    ]);
  });

  it('defaults to Sans Serif — Arial, as Gmail does', () => {
    expect(emailDefaultFont.id).toBe('sans-serif');
    expect(emailDefaultFont.face).toBe('Arial');
  });

  it('says which clients draw each face — the safe ones everywhere', () => {
    const everywhere = emailFontFamilies
      .filter((f) => f.clients.length === fontClients.length)
      .map((f) => f.id);
    expect(everywhere).toEqual([
      'sans-serif',
      'serif',
      'fixed-width',
      'georgia',
      'trebuchet-ms',
      'verdana',
    ]);
    // Outlook on Windows brings Office's fonts: it draws every one.
    expect(emailFontFamilies.every((f) => f.clients.includes('outlook-desktop'))).toBe(true);
    expect(fontClients.map((c) => c.letter).join('')).toBe('GAO');
  });

  it('has unique ids and faces', () => {
    expect(new Set(emailFontFamilies.map((f) => f.id)).size).toBe(emailFontFamilies.length);
    expect(new Set(emailFontFaces).size).toBe(emailFontFaces.length);
  });

  it('reads each face back as its own font — what summernote writes', () => {
    for (const f of emailFontFamilies) {
      expect(matchEmailFont(`'${f.face}'`)).toBe(f);
      expect(matchEmailFont(f.face)).toBe(f);
    }
  });

  it('is exact on its own stacks, give or take quotes, case and spacing', () => {
    expect(isEmailFontStack("'comic sans ms',SANS-SERIF")).toBe(true);
    expect(isEmailFontStack('Comic Sans MS, cursive')).toBe(false);
  });

  it('reads a generic as the first font naming it', () => {
    expect(matchEmailFont('sans-serif')?.id).toBe('sans-serif');
    expect(matchEmailFont('serif')?.id).toBe('serif');
    expect(matchEmailFont('monospace')?.id).toBe('fixed-width');
    expect(matchEmailFont('Calibri, sans-serif')?.id).toBe('sans-serif');
    expect(matchEmailFont('Wingdings')).toBe(null);
  });
});
