import { createEditor } from './editor';
import { emailExtensions } from './extensions/kits';
import {
  dropHidden,
  inheritTextStyles,
  inlineStyles,
  mediaMatches,
  parseRules,
  unwrapLayoutTables,
} from './import-html';

const document = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('inlineStyles', () => {
  it('folds the sheet into the elements it matches and drops the block', () => {
    const doc = document(
      '<style>.a { color: red; } p { margin: 0 } .a { font-size: 12px; color: blue }</style>' +
        '<p class="a" style="color: green">x</p><p>y</p>',
    );
    inlineStyles(doc);
    const [a, b] = Array.from(doc.querySelectorAll('p'));
    // Inline stands over the sheet; later rules replace earlier sheet values.
    expect(a.style.color).toBe('green');
    expect(a.style.fontSize).toBe('12px');
    expect(a.style.margin).toBe('0px');
    expect(b.style.margin).toBe('0px');
    expect(doc.querySelector('style')).toBeNull();
  });

  it('lets !important beat an inline declaration, as a mobile-first export relies on', () => {
    const doc = document(
      '<style>@media only screen and (min-width:480px) { .col { width: 50% !important; max-width: 50%; } }' +
        '@media only screen and (max-width:479px) { .col { width: 100% !important; } }</style>' +
        '<div class="col" style="width: 100%">c</div>',
    );
    inlineStyles(doc);
    const col = doc.querySelector<HTMLElement>('.col')!;
    expect(col.style.getPropertyValue('width')).toBe('50%');
    expect(col.style.getPropertyPriority('width')).toBe('important');
    expect(col.style.maxWidth).toBe('50%');
  });

  it('skips what the document cannot match, and other at-rules', () => {
    const rules = parseRules(
      'a:hover { color: red } a::before { content: "" } @font-face { font-family: x } b { font-weight: bold }',
      600,
    );
    expect(rules.map((rule) => rule.selector)).toEqual(['b']);
  });

  it('answers a media query for the import width', () => {
    expect(mediaMatches('only screen and (min-width:480px)', 600)).toBe(true);
    expect(mediaMatches('only screen and (max-width:479px)', 600)).toBe(false);
    expect(mediaMatches('screen and (min-width: 480px) and (max-width: 700px)', 600)).toBe(true);
    expect(mediaMatches('print', 600)).toBe(false);
    expect(mediaMatches('not screen', 600)).toBe(false);
    expect(mediaMatches('screen', 600)).toBe(true);
    expect(mediaMatches('(prefers-color-scheme: dark)', 600)).toBe(false);
  });
});

describe('dropHidden', () => {
  it('drops what a builder hides — a hamburger trigger with its glyphs, a preview text', () => {
    const doc = document(
      '<div style="display:none;font-size:1px;max-height:0">Preview text</div>' +
        '<div class="mj-menu-trigger" style="display:none;max-height:0px;font-size:0px;"><label>&#9776;</label></div>' +
        '<div style="display: block">Kept</div><p style="color: red">Text</p>',
    );
    dropHidden(doc.body);
    expect(doc.body.textContent).toBe('KeptText');
  });

  it('drops the comments too — a builder’s Outlook conditionals — so a wrapper’s cell reads as elements alone', () => {
    const doc = document(
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation"><tbody><tr><td align="center">' +
        '<!--[if !mso]><!--><input type="checkbox" style="display:none !important"><!--<![endif]-->' +
        '<div class="links"><a href="https://x.io">home</a></div>' +
        '<!--[if mso | IE]></td></tr></table><![endif]--></td></tr></tbody></table>',
    );
    dropHidden(doc.body);
    unwrapLayoutTables(doc.body);
    expect(doc.body.querySelector('table')).toBeNull();
    expect(doc.body.querySelector('input')).toBeNull();
    expect(doc.body.innerHTML).not.toContain('<!--');
    expect((doc.body.querySelector('.links') as HTMLElement).style.textAlign).toBe('center');
  });

  it('reads a hidden rule the sheet folded in, and leaves visibility to the client', () => {
    const doc = document(
      '<style>.desktop-only { display: none !important; }</style>' +
        '<p class="desktop-only">Gone</p><p style="visibility:hidden;mso-hide:all">Stays</p>',
    );
    inlineStyles(doc);
    dropHidden(doc.body);
    expect(doc.body.textContent).toBe('Stays');
  });
});

describe('inheritTextStyles', () => {
  it('hands a wrapping div’s colour, size and face down: onto its blocks, and round its runs as a span', () => {
    const doc = document(
      '<div style="color:#bd8714;font-size:15px;font-family:Ubuntu, Arial;text-align:center"><p>Title</p><p style="color:#000">Own</p>Loose words</div>',
    );
    inheritTextStyles(doc.body);
    const [title, own, span] = Array.from(doc.body.firstElementChild!.children) as HTMLElement[];
    expect(title.style.color).toBe('rgb(189, 135, 20)');
    expect(title.style.fontSize).toBe('15px');
    expect(title.style.textAlign).toBe('center');
    expect(own.style.color).toBe('rgb(0, 0, 0)');
    expect(own.style.fontSize).toBe('15px');
    expect(span.tagName).toBe('SPAN');
    expect(span.style.color).toBe('rgb(189, 135, 20)');
    expect(span.textContent).toBe('Loose words');
  });

  it('shares a plain wrapper div’s padding out among its blocks, and passes text-transform down', () => {
    const doc = document(
      '<div style="padding: 10px 25px; text-transform: uppercase"><p>One</p><p>Two</p></div>',
    );
    inheritTextStyles(doc.body);
    const wrapper = doc.body.firstElementChild as HTMLElement;
    const [one, two] = Array.from(wrapper.children) as HTMLElement[];
    expect(wrapper.style.padding).toBe('');
    expect(one.style.padding).toBe('10px 25px 0px');
    expect(two.style.padding).toBe('0px 25px 10px');
    expect(one.querySelector('span')?.style.textTransform).toBe('uppercase');
  });

  it('keeps an anchor’s own colour, and passes no zero font-size (a builder’s gap killer)', () => {
    const doc = document(
      '<td style="font-size:0px"><div><a href="https://x.io" style="color:#000000;font-size:12px"> home </a></div></td>',
    );
    inheritTextStyles(doc.body);
    const span = doc.body.querySelector('a > span') as HTMLElement;
    expect(span.style.color).toBe('rgb(0, 0, 0)');
    expect(span.style.fontSize).toBe('12px');
    expect(doc.body.querySelectorAll('span')).toHaveLength(1);
  });
});

describe('unwrapLayoutTables', () => {
  const wrapper = (inner: string, cellStyle = '') =>
    `<table border="0" cellpadding="0" cellspacing="0" role="presentation"><tbody><tr>` +
    `<td style="${cellStyle}">${inner}</td></tr></tbody></table>`;

  it('takes a builder’s one-cell wrapper tables out, innermost included', () => {
    const doc = document(wrapper(wrapper('<img src="a.png">') + '<div>text</div>'));
    unwrapLayoutTables(doc.body);
    expect(doc.body.querySelector('table')).toBeNull();
    expect(doc.body.innerHTML).toBe('<img src="a.png"><div>text</div>');
  });

  it('takes a column’s stack out — one cell a row — carrying each cell’s alignment onto what it held', () => {
    const doc = document(
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tbody>' +
        '<tr><td align="center" style="padding:10px 25px"><div style="text-align:left"><p>Title</p></div><div><p>Sub</p></div></td></tr>' +
        '<tr><td align="center" style="padding:0"><a href="https://x.io" style="display:inline-block">Go</a></td></tr>' +
        '<tr><td style="padding:0"><img src="a.png"></td></tr>' +
        '</tbody></table>',
    );
    unwrapLayoutTables(doc.body);
    expect(doc.body.querySelector('table')).toBeNull();
    const [title, sub, go, img] = Array.from(doc.body.children) as HTMLElement[];
    // A block with an alignment of its own keeps it; one without takes the cell's.
    expect(title.style.textAlign).toBe('left');
    expect(sub.style.textAlign).toBe('center');
    // The cell's padding, shared out: the sides on both, the top on the
    // first, the bottom on the last.
    expect(title.style.padding).toBe('10px 25px 0px');
    expect(sub.style.padding).toBe('0px 25px 10px');
    // An inline run becomes a paragraph of the cell's alignment.
    expect(go.tagName).toBe('DIV');
    expect(go.style.textAlign).toBe('center');
    expect(go.innerHTML).toContain('>Go</a>');
    expect(img.tagName).toBe('IMG');
  });

  it('hands a right-to-left cell’s children over in reverse', () => {
    const doc = document(wrapper('<div id="a">a</div><div id="b">b</div>', 'direction:rtl'));
    unwrapLayoutTables(doc.body);
    expect(Array.from(doc.body.children).map((el) => el.id)).toEqual(['b', 'a']);
  });

  it('keeps a wrapper that is a band — a fill or a padding on it — for the section node', () => {
    const doc = document(
      wrapper('<div style="display:inline-block;width:100%">x</div>', 'padding: 20px 0') +
        wrapper('<div>y</div>', 'background-color: #f1f3f4') +
        '<div style="background-color: #ffffff">' +
        wrapper('<div>z</div>') +
        '</div>',
    );
    unwrapLayoutTables(doc.body);
    expect(doc.body.querySelectorAll('table')).toHaveLength(3);
  });

  it('keeps a table that is a table: text in its cell, or no builder attributes', () => {
    const doc = document(
      wrapper('cell') +
        '<table role="presentation"><tbody><tr><td><img src="a.png"></td></tr></tbody></table>' +
        wrapper('<div>x</div>', '') +
        '<table border="0" cellpadding="0" role="presentation"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    );
    unwrapLayoutTables(doc.body);
    expect(doc.body.querySelectorAll('table')).toHaveLength(3);
  });

  it('brings an MJML section in as one of the kit’s column blocks', () => {
    const mount = document('').body;
    const html =
      '<html><head><style>@media only screen and (min-width:480px) { .mj-column-per-100 { width: 100% !important; max-width: 100%; } .mj-column-per-50 { width: 50% !important; max-width: 50%; } }</style></head><body>' +
      '<div style="margin:0px auto;max-width:600px;">' +
      '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;"><tbody><tr>' +
      '<td style="direction:ltr;font-size:0px;padding:20px 0;text-align:center;">' +
      '<div class="mj-column-per-100" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><p>Wide</p></div>' +
      '</td></tr></tbody></table></div>' +
      '<div style="margin:0px auto;max-width:600px;">' +
      '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;"><tbody><tr>' +
      '<td style="direction:rtl;font-size:0px;padding:20px 0;text-align:center;">' +
      '<div class="mj-column-per-50" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><p>Picture</p></div>' +
      '<div class="mj-column-per-50" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"><p>Words</p></div>' +
      '</td></tr></tbody></table></div></body></html>';
    const editor = createEditor({ parent: mount, extensions: emailExtensions, content: html });
    const out = editor.getHTML();
    // Two sections (the cells carry MJML's padding), no empty grid: inside
    // them the column blocks — two halves of the budget each, and the
    // right-to-left section's words first. The full-width column takes the
    // whole budget — not the two-column default it would fall back to were
    // the sheet not read.
    expect(out.match(/<table role="presentation" width="100%"/g)).toHaveLength(2);
    expect(out.match(/padding: 20px 0px;/g)).toHaveLength(2);
    expect(out.match(/max-width: 560px/g)).toHaveLength(1);
    expect(out.match(/max-width: 280px/g)).toHaveLength(2);
    expect(out.indexOf('Words')).toBeLessThan(out.indexOf('Picture'));
    editor.destroy();
  });

  it('brings an MJML hamburger navbar in as its fallback: a row of links, no glyphs, no buttons', () => {
    const mount = document('').body;
    const link = (text: string) =>
      `<a class="mj-link" href="https://x.io/${text.length}" target="_blank" style="display: inline-block; color: #000000; font-size: 12px; font-weight: bold; line-height: 22px; text-decoration: none; text-transform: uppercase; padding: 0 35px;">${text}</a>`;
    const html =
      '<html><head><style>@media only screen and (max-width:479px) { .mj-menu-checkbox[type="checkbox"]~.mj-inline-links { display: none !important; } }</style></head><body>' +
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation"><tbody><tr><td align="center" style="font-size:0px;padding:0px;">' +
      '<!--[if !mso]><!--><input type="checkbox" id="c" class="mj-menu-checkbox" style="display:none !important; max-height:0; visibility:hidden;"><!--<![endif]-->' +
      '<div class="mj-menu-trigger" style="display:none;max-height:0px;max-width:0px;font-size:0px;overflow:hidden;">' +
      '<label for="c" class="mj-menu-label" style="display:block;cursor:pointer;mso-hide:all;font-size:30px;">' +
      '<span class="mj-menu-icon-open" style="mso-hide:all;"> &#9776; </span><span class="mj-menu-icon-close" style="display:none;mso-hide:all;"> &#8855; </span></label></div>' +
      `<div class="mj-inline-links">${link('home')}${link('Summer deals')}${link('Our blog')}</div>` +
      '</td></tr></tbody></table></body></html>';
    const editor = createEditor({ parent: mount, extensions: emailExtensions, content: html });
    const out = editor.getHTML();
    // The client the import is drawn for shows the links, and nothing of
    // the toggle: no ☰, no ⊗, and the links are links — a builder's
    // inline-block anchor with no fill or border is not a button.
    expect(out).not.toContain('\u2630');
    expect(out).not.toContain('\u2297');
    expect(out).not.toContain('<input');
    expect(out.match(/<a href="https:\/\/x.io\/\d+"[^>]*rel="noopener noreferrer">/g)).toHaveLength(
      3,
    );
    expect(out).not.toContain('background-color: rgb(26, 115, 232)');
    editor.destroy();
  });

  it('brings an MJML column in whole: the centred title in its colour, the button in its own, no band round it', () => {
    const mount = document('').body;
    const html =
      '<div class="mj-column-per-50" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;">' +
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tbody><tr><td style="vertical-align:top;padding:0px;">' +
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tbody>' +
      '<tr><td align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;">' +
      '<div style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:center;color:#BD8714;"><p>SUNNIEST DESTINATIONS</p></div></td></tr>' +
      '<tr><td align="center" style="font-size:0px;padding:20px 25px;word-break:break-word;">' +
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"><tbody><tr>' +
      '<td align="center" bgcolor="#bd8714" role="presentation" style="border:none;border-radius:3px;cursor:auto;mso-padding-alt:10px 25px;background:#bd8714;" valign="middle">' +
      '<a href="https://mjml.io" style="display: inline-block; background: #bd8714; color: #FFFFFF; font-size: 13px; font-weight: normal; line-height: 120%; margin: 0; text-decoration: none; padding: 10px 25px; border-radius: 3px;" target="_blank"> BOOK NOW </a>' +
      '</td></tr></tbody></table></td></tr>' +
      '</tbody></table></td></tr></tbody></table></div>';
    const editor = createEditor({ parent: mount, extensions: emailExtensions, content: html });
    const out = editor.getHTML();
    console.log('MJML COLUMN OUT', out);
    // The title: centred, in the colour its wrapping div declared (its
    // 15px is not one of the kit's sizes, and goes).
    expect(out).toContain(
      '<div style="text-align: center; margin: 10px 25px;"><span style="color: rgb(189, 135, 20);">SUNNIEST DESTINATIONS</span></div>',
    );
    // The button: ours, in MJML's colour, centred — and no section round it.
    expect(out).toContain(
      '<div style="text-align: center; margin: 20px 25px;"><a href="https://mjml.io" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: rgb(189, 135, 20); color: rgb(255, 255, 255); font-weight: normal; text-decoration: none; border-width: 14px 28px; border-style: solid; border-color: rgb(189, 135, 20);">BOOK NOW</a></div>',
    );
    expect(out).not.toContain('bgcolor=');
    expect(out).not.toContain('<table');
    editor.destroy();
  });

  it('centres an MJML navbar and keeps its links’ colour', () => {
    const mount = document('').body;
    const link = (text: string) =>
      `<a class="mj-link" href="https://x.io/${text.length}" target="_blank" style="display: inline-block; color: #000000; font-size: 12px; font-weight: bold; line-height: 22px; text-decoration: none; text-transform: uppercase; padding: 0 35px;"> ${text} </a>`;
    const html =
      '<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tbody><tr><td align="center" style="font-size:0px;padding:0px;">' +
      `<div class="mj-inline-links">${link('home')} ${link('Our blog')}</div></td></tr></tbody></table>`;
    const editor = createEditor({ parent: mount, extensions: emailExtensions, content: html });
    const out = editor.getHTML();
    expect(out).toContain('<div style="text-align: center;">');
    expect(out).toMatch(
      /<span style="color: rgb\(0, 0, 0\); font-size: 12px; text-transform: uppercase;">home ?<\/span>/,
    );
    expect(out).toContain('href="https://x.io/4"');
    editor.destroy();
  });
});
