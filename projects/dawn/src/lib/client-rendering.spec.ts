import {
  dropMediaQueries,
  keepGmailRules,
  renderForClient,
  resolveColorScheme,
} from './client-rendering';

describe('renderForClient', () => {
  const body = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';

  it('lays the client’s surface under the email and keeps a document’s own head', () => {
    const out = renderForClient(
      '<html><head><style>.a { color: red }</style></head><body><p class="a">x</p></body></html>',
      'apple-mail',
    );
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('-apple-system');
    expect(out).toContain('.a { color: red }');
    expect(body(out)).toContain('<p class="a">x</p>');
  });

  it('draws for Gmail without the comments, the form controls, the unmatched rules and the ignored declarations', () => {
    const out = renderForClient(
      '<style>.a { color: red } .b:hover { color: blue } input[type="checkbox"]:checked ~ .c { display: block } @media (max-width: 479px) { .d { width: 100% } }</style>' +
        '<!--[if mso]><table><tr><td>mso</td></tr></table><![endif]-->' +
        '<input type="checkbox" id="c"><label for="c">☰</label>' +
        '<div style="position: absolute; color: red; display: flex;">x</div>',
      'gmail',
    );
    expect(out).toContain('.a {');
    expect(out).not.toContain(':hover');
    expect(out).not.toContain(':checked');
    expect(out).toContain('@media (max-width: 479px) {.d { width: 100% }');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('<label');
    expect(out).toContain('☰');
    expect(out).not.toContain('mso');
    expect(out).toContain('style="color: red;"');
  });

  it('draws for Outlook on Windows: the conditionals opened, the media queries and ignored declarations gone, columns stacked', () => {
    const out = renderForClient(
      '<style>@media (max-width: 479px) { .d { width: 100% } } .e { color: green }</style>' +
        '<!--[if !mso]><!--><div class="modern">modern</div><!--<![endif]-->' +
        '<!--[if mso | IE]><table><tr><td>word</td></tr></table><![endif]-->' +
        '<div style="max-width: 600px; padding: 10px; background-image: url(a.png); background-color: #123456; border-radius: 3px;">x</div>' +
        '<td style="padding: 10px">cell</td>',
      'outlook-desktop',
    );
    expect(out).not.toContain('modern');
    expect(out).toContain('<td>word</td>');
    expect(out).not.toContain('@media');
    expect(out).toContain('.e { color: green }');
    expect(out).toContain('style="background-color: #123456;"');
    expect(out).toContain('display: block !important');
    // A cell keeps its padding: the Word engine honours that one.
    expect(out).toContain('cell');
  });

  it('draws a phone edge to edge, and a desktop pane with a margin', () => {
    expect(renderForClient('<p>x</p>', 'gmail', { pane: 'phone' })).toContain(
      'body { margin: 0; }',
    );
    expect(renderForClient('<p>x</p>', 'gmail', { pane: 'desktop' })).not.toContain('margin: 0;');
  });

  it('adds the client’s dark mode', () => {
    expect(renderForClient('<p>x</p>', 'gmail', { dark: true })).toContain('invert(1)');
    expect(renderForClient('<p>x</p>', 'apple-mail', { dark: true })).toContain('#1e1e1e');
    expect(renderForClient('<p>x</p>', 'gmail')).not.toContain('invert(1)');
    // Classic Outlook recolours the message onto its own #292929.
    expect(renderForClient('<p>x</p>', 'outlook-desktop', { dark: true })).toContain(
      'invert(0.8392)',
    );
  });

  it('draws a fragment as it is sent: its light colours, no dark of its own', () => {
    const red = '<p><span style="color: #c5221f">x</span></p>';
    const appleDark = renderForClient(red, 'apple-mail', { dark: true });
    expect(appleDark).toContain('<span style="color: #c5221f">');
    expect(appleDark).not.toMatch(/aee-d[btl]-|color-scheme: light dark/);
    // No client drawn here sets Outlook.com’s marker.
    expect(appleDark).not.toContain('data-ogsc');
  });

  it('draws a fragment’s body as it is sent: stacking columns marked under the phone rule, images fitted', () => {
    const column =
      '<div class="aee-layout-column" style="display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;"><div>a</div></div>';
    const fragment =
      `<div class="aee-layout-columns" style="width: 100%; max-width: 600px;">${column}${column}</div>` +
      '<div style="text-align: center;"><img src="x.png"></div>';
    const apple = renderForClient(fragment, 'apple-mail', { pane: 'phone' });
    expect(apple).toContain('class="aee-layout-column aee-stack"');
    expect(apple).toContain('.aee-stack { max-width: 100% !important; }');
    expect(apple).toContain('border="0"');
    // Gmail reads a class rule in a media query; Outlook reads none.
    expect(renderForClient(fragment, 'gmail')).toContain(
      '.aee-stack { max-width: 100% !important; }',
    );
    expect(renderForClient(fragment, 'outlook-desktop')).not.toContain('.aee-stack {');
    // A whole document is drawn as it came.
    const page = `<html><head></head><body>${fragment}</body></html>`;
    expect(renderForClient(page, 'apple-mail')).not.toContain('aee-stack');
  });

  it('answers a document’s own scheme queries for the frame', () => {
    expect(
      resolveColorScheme(
        '@media (prefers-color-scheme: dark) { a {} } @media ( prefers-color-scheme : light ) { b {} }',
        true,
      ),
    ).toBe('@media (min-width: 0px) { a {} } @media (max-width: -1px) { b {} }');
  });
});

describe('the stylesheet rewrites', () => {
  it('keepGmailRules keeps the matchable selectors of a rule and drops a rule with none', () => {
    expect(keepGmailRules('.a, .b:hover { color: red } [x] { color: blue }')).toBe(
      '.a { color: red }\n',
    );
  });

  it('dropMediaQueries takes the media blocks out and leaves the rest', () => {
    expect(
      dropMediaQueries('.a { x: 1 } @media (min-width: 1px) { .b { y: 2 } } .c { z: 3 }'),
    ).toBe('.a { x: 1 }  .c { z: 3 }');
  });
});
