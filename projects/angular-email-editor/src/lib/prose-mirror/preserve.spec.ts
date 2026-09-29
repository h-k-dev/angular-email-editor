import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { formatHTML, lintHTML } from './html-source';
import { emailExtensions } from './extensions/kits';
import { createEditor } from './editor';
import { hasDocumentEnvelope } from './envelope';
import { createDOMParser } from './preserve';
import { scopedDocumentCss } from './extensions/document-styles';
import { MJML_WORLDLY_HTML } from './fixtures/mjml-worldly';
import { GOLDEN_HTML } from './fixtures/golden';

const schema = createSchema(emailExtensions);
const preserve = (html: string) =>
  serializeToHTML(parseHTML(html, schema, { mode: 'preserve' }), schema);
const repair = (html: string) => serializeToHTML(parseHTML(html, schema), schema);
const email = (html: string) => serializeToHTML(parseHTML(html, schema, { mode: 'email' }), schema);
const emailDoc = (html: string) => parseHTML(html, schema, { mode: 'email' });

/**
 * A rendering-relevant outline of markup: every element with its attributes
 * (styles compared declaration-wise, order-insensitive), every comment, every
 * text run — the things a browser paints from. Two documents with the same
 * outline render the same. Tolerated differences, by design:
 *   - a bare `<div>` (no attributes) is unwrapped: the parser wraps loose
 *     inline runs next to blocks in one, which lays out like the anonymous
 *     block box the browser would have used;
 *   - `target`/`rel` on links: the link mark adds `_blank` + `noopener`.
 */
function outline(html: string): string[] {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const events: string[] = [];
  const normalizeStyle = (style: string) =>
    style
      .split(';')
      .map((d) =>
        d
          .trim()
          .toLowerCase()
          .replace(/\s*:\s*/, ':')
          .replace(/\s+/g, ' '),
      )
      .filter(Boolean)
      .sort()
      .join(';');
  const walk = (node: Node): void => {
    if (node.nodeType === Node.COMMENT_NODE) {
      events.push(`<!--${(node.nodeValue ?? '').replace(/\s*\n\s*/g, '\n')}-->`);
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (text) events.push(`"${text}"`);
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    const bare = tag === 'div' && node.attributes.length === 0;
    if (!bare) {
      const attrs = Array.from(node.attributes)
        .filter(({ name }) => !(tag === 'a' && (name === 'target' || name === 'rel')))
        .map(({ name, value }) => `${name}=${name === 'style' ? normalizeStyle(value) : value}`)
        .sort();
      events.push(`<${tag} ${attrs.join(' ')}>`);
    }
    for (const child of Array.from(node.childNodes)) walk(child);
    if (!bare) events.push(`</${tag}>`);
  };
  for (const child of Array.from(dom.body.childNodes)) walk(child);
  return events;
}

describe('email parse — the MJML target', () => {
  const canonical = email(MJML_WORLDLY_HTML);

  it('keeps the whole document envelope: doctype, html attributes, body attributes', () => {
    expect(canonical.startsWith('<!doctype html>\n<html lang="und" dir="auto" xmlns=')).toBe(true);
    expect(canonical).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(canonical).toContain('<body style="word-spacing:normal;background-color:#d2eeff;">');
    expect(canonical.endsWith('</body>\n</html>')).toBe(true);
  });

  it('keeps the head — styles, media queries, links, and its Outlook conditionals', () => {
    expect(canonical).toContain('@media only screen and (min-width:480px) {');
    expect(canonical).toContain('.mj-column-per-50 {');
    expect(canonical).toContain('<style media="screen and (min-width:480px)">');
    expect(canonical).toContain(
      '<link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">',
    );
    expect(canonical).toContain('<!--[if mso]>\n<noscript>\n<xml>\n<o:OfficeDocumentSettings>');
    expect(canonical).toContain('<!--[if !mso]><!-->');
    expect(canonical).toContain('<!--<![endif]-->');
    expect(canonical).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
  });

  it('keeps every body conditional comment, VML included', () => {
    const conditionals = (html: string) => html.match(/<!--\[if mso \| IE\]>/g)?.length ?? 0;
    expect(conditionals(canonical)).toBe(conditionals(MJML_WORLDLY_HTML));
    expect(canonical).toContain('<v:rect style="width:600px;"');
    expect(canonical).toContain('<!--[if mso | IE]></v:textbox></v:rect></td></tr></table>');
    expect(canonical).toContain(
      '<!--[if !mso]><!--><input type="checkbox" id="29f3f9bba1fb0a37" class="mj-menu-checkbox" style="display:none !important; max-height:0; visibility:hidden;"><!--<![endif]-->',
    );
  });

  it('renders the same as the input — same elements, attributes, comments and text', () => {
    expect(outline(canonical)).toEqual(outline(MJML_WORLDLY_HTML));
  });

  it('keeps the legacy table attributes and classes MJML relies on', () => {
    expect(canonical).toContain(
      '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">',
    );
    expect(canonical).toContain(
      '<div class="mj-column-per-50 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:50%;">',
    );
    expect(canonical).toContain('<td align="center" bgcolor="#bd8714" role="presentation"');
    expect(canonical).toContain(
      '<img alt="Worldly logo" src="https://static.mailjet.com/mjml-website/templates/worldly-logo.png" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="105" height="auto">',
    );
    expect(canonical).toContain('<p>SUNNIEST DESTINATIONS</p>');
  });

  it('keeps a styled link as designed — class, style and target ride along', () => {
    expect(canonical).toContain(
      '<a href="https://mjml.iohttps://mjml.io" target="_blank" rel="noopener noreferrer" class="mj-link" style="display: inline-block; color: #000000;',
    );
  });

  it('drops the edge whitespace inside boxed links — a client drops it, the editor would not', () => {
    // `<a style="display: inline-block"> home </a>` → `home`: the spaces never
    // rendered in a client, and in the editor's pre-wrap view they would.
    expect(canonical).toContain('padding: 0 35px;">home</a>');
    expect(canonical).toContain('border-radius: 3px;">BOOK NOW</a>');
    // Ordinary inline whitespace follows the same rules as the repair parse.
    const inline = '<div>a <b> b </b> c</div>';
    expect(email(inline)).toBe(repair(inline));
  });

  it('drops nothing: MJML emits only what floor clients apply, so email mode == preserve mode', () => {
    expect(canonical).toBe(
      serializeToHTML(parseHTML(MJML_WORLDLY_HTML, schema, { mode: 'preserve' }), schema),
    );
    expect(
      lintHTML(MJML_WORLDLY_HTML, undefined, { mode: 'email' }).some((d) =>
        d.message.includes('dropped on parse'),
      ),
    ).toBe(false);
  });

  it('parses into the composer’s own nodes — text lines, images, links — not opaque markup', () => {
    const doc = emailDoc(MJML_WORLDLY_HTML);
    const counts = new Map<string, number>();
    const htmlOf: Record<string, unknown> = {};
    doc.descendants((node) => {
      counts.set(node.type.name, (counts.get(node.type.name) ?? 0) + 1);
      if (node.attrs['html'] && !htmlOf[node.type.name])
        htmlOf[node.type.name] = node.attrs['html'];
      return true;
    });
    // Every MJML text div and <p> is a paragraph, every picture an image node.
    // 4 text divs, the navbar's trigger and links divs, 7 <p>, and the
    // footer's loose "[[DELIVERY_INFO]]" run.
    expect(counts.get('paragraph')).toBe(14);
    expect(counts.get('image')).toBe(13);
    // The navbar's <input> checkbox, between blocks.
    expect(counts.get('htmlVoidBlock')).toBe(1);
    expect(counts.get('htmlVoid') ?? 0).toBe(0);
    expect(htmlOf['paragraph']).toEqual({
      tag: 'div',
      attrs: [
        [
          'style',
          'font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:11px;line-height:1;text-align:left;color:#000000;',
        ],
      ],
    });
    expect((htmlOf['image'] as { attrs: [string, string][] }).attrs.map(([name]) => name)).toEqual([
      'alt',
      'src',
      'style',
      'width',
      'height',
    ]);
    // The navbar entries and the buttons are links over editable text.
    const links: string[] = [];
    doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'link'))
        links.push(node.text!);
      return true;
    });
    expect(links).toEqual(
      expect.arrayContaining(['home', 'Summer deals', 'BOOK NOW', '[[HEADLINE]]']),
    );
  });

  it('is a fixpoint: parsing its own output changes nothing', () => {
    expect(email(canonical)).toBe(canonical);
  });

  it('formats as a document, and formatting is presentation only', () => {
    const format = (html: string) => formatHTML(html, undefined, undefined, { mode: 'email' });
    const formatted = format(MJML_WORLDLY_HTML);
    expect(formatted.split('\n').slice(0, 4)).toEqual([
      '<!doctype html>',
      '<html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
      '  <head>',
      '    <title></title>',
    ]);
    expect(formatted).toContain('  <body style="word-spacing:normal;background-color:#d2eeff;">');
    // Same canonical document from the pretty source and from the raw one;
    // formatting is idempotent; and the source pane's own view of the
    // canonical document (what it shows after a sync) canonicalizes back.
    expect(email(formatted)).toBe(canonical);
    expect(format(formatted)).toBe(formatted);
    expect(email(format(canonical))).toBe(canonical);
  });

  it('lints clean of errors — the envelope, comments and conditionals are all legal', () => {
    const diagnostics = lintHTML(MJML_WORLDLY_HTML, undefined, { mode: 'email' });
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagnostics.some((d) => d.message.includes('<html>'))).toBe(false);
    expect(diagnostics.some((d) => d.message.includes('<style>'))).toBe(false);
  });

  it('round-trips through the editor: setContent → getHTML is the canonical document', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditor({ parent, extensions: emailExtensions, parseMode: 'email' });
    editor.setContent(MJML_WORLDLY_HTML);
    expect(editor.getHTML()).toBe(canonical);
    expect(editor.state.doc.attrs['envelope']).not.toBeNull();

    // A second sync of the same document is a no-op; a body fragment drops
    // the envelope again through a doc-attribute step.
    editor.setContent(canonical);
    expect(editor.getHTML()).toBe(canonical);
    editor.setContent('<div>plain</div>');
    expect(editor.getHTML()).toBe('<div>plain</div>');
    expect(editor.state.doc.attrs['envelope']).toBeNull();
    editor.destroy();
    parent.remove();
  });

  it('scopes the head styles to the editor and hoists imports for the visual pane', () => {
    const doc = parseHTML(MJML_WORLDLY_HTML, schema, { mode: 'preserve' });
    const css = scopedDocumentCss(doc, 'aee-doc-1');
    const lines = css.split('\n');
    expect(lines[0]).toBe(
      '@import url("https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700");',
    );
    expect(lines[1]).toBe(
      '@import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);',
    );
    expect(lines[2]).toBe('@scope (.aee-doc-1) {');
    expect(css).toContain('@media screen and (min-width:480px) {\n');
    expect(css).toContain('.mj-column-per-50 {');
    expect(css.endsWith('\n}')).toBe(true);
  });

  it('repair mode still imports the same input into canonical blocks', () => {
    const repaired = repair(MJML_WORLDLY_HTML);
    expect(repaired.startsWith('<!doctype')).toBe(false);
    expect(repaired).not.toContain('[if mso | IE]');
    expect(repaired).not.toContain('mj-column');
    expect(repaired).toContain('BOOK NOW');
  });
});

describe('preserving parse — foreign markup in general', () => {
  it('keeps unknown attributes, classes and tags verbatim', () => {
    expect(preserve('<div class="x" data-id="7">hi</div>')).toBe(
      '<div class="x" data-id="7">hi</div>',
    );
    expect(preserve('<center><p style="margin:0">p stays p</p></center>')).toBe(
      '<center><p style="margin:0">p stays p</p></center>',
    );
    expect(preserve('<table><tr><td bgcolor="#fff">a</td></tr></table>')).toBe(
      '<table><tbody><tr><td bgcolor="#fff">a</td></tr></tbody></table>',
    );
  });

  it('keeps comments where they were — between blocks and inside a line', () => {
    expect(preserve('<div>a</div><!-- between --><div>b</div>')).toBe(
      '<div>a</div><!-- between --><div>b</div>',
    );
    expect(preserve('<div>a<!-- inside -->b</div>')).toBe('<div>a<!-- inside -->b</div>');
    expect(
      preserve(
        '<!--[if mso]><table><tr><td><![endif]--><div>x</div><!--[if mso]></td></tr></table><![endif]-->',
      ),
    ).toBe(
      '<!--[if mso]><table><tr><td><![endif]--><div>x</div><!--[if mso]></td></tr></table><![endif]-->',
    );
  });

  it('keeps a phrasing element that wraps blocks as the container it is', () => {
    const linked = '<a href="https://x.io"><div class="card">card</div></a>';
    expect(preserve(linked)).toBe(linked);
  });

  it('keeps a body <style> raw and re-emits it', () => {
    expect(preserve('<style>p { margin: 0 }</style><div>a</div>')).toBe(
      '<style>p { margin: 0 }</style><div>a</div>',
    );
  });

  it('still refuses what must never be emitted, in either mode', () => {
    const hostile =
      '<div onclick="x()" class="k">a</div><script>evil()</script>' +
      '<a href="javascript:alert(1)">l</a><img src="javascript:x" alt="i">' +
      '<iframe src="https://x"></iframe>';
    const kept = preserve(hostile);
    expect(kept).not.toContain('onclick');
    expect(kept).not.toContain('script');
    expect(kept).not.toContain('javascript:');
    expect(kept).not.toContain('iframe');
    expect(kept).toContain('class="k"');
    expect(repair(hostile)).not.toContain('evil()');
  });

  it('nests generic inline elements outermost-first, as authored', () => {
    const nested = '<div><span class="a"><span class="b">t</span></span></div>';
    expect(preserve(nested)).toBe(nested);
    expect(preserve('<div><label for="i" class="l"><span class="s">x</span></label></div>')).toBe(
      '<div><label for="i" class="l"><span class="s">x</span></label></div>',
    );
  });

  it('does not treat <header> or escaped text as a document envelope', () => {
    expect(hasDocumentEnvelope('<header>x</header>')).toBe(false);
    expect(hasDocumentEnvelope('<div>&lt;html&gt;</div>')).toBe(false);
    expect(hasDocumentEnvelope('<!DOCTYPE html><div>x</div>')).toBe(true);
    expect(hasDocumentEnvelope('<html><body><div>x</div></body></html>')).toBe(true);
  });

  it('wraps a bare fragment with a doctype only when the source carried one', () => {
    expect(preserve('<div>x</div>')).toBe('<div>x</div>');
    expect(preserve('<!doctype html><div>x</div>')).toBe(
      '<!doctype html>\n<html>\n<head>\n</head>\n<body><div>x</div></body>\n</html>',
    );
  });
});

describe('the composer’s own output parses back as itself, in every mode', () => {
  const nodeTypes = (html: string, mode: 'email' | 'preserve' | 'repair') => {
    const names: string[] = [];
    parseHTML(html, schema, { mode }).descendants((node) => {
      names.push(node.type.name);
      return true;
    });
    return names;
  };

  for (const html of GOLDEN_HTML) {
    it(`is identity, into the same nodes, on: ${html.slice(0, 60)}`, () => {
      expect(email(html)).toBe(html);
      expect(preserve(html)).toBe(html);
      expect(nodeTypes(html, 'email')).toEqual(nodeTypes(html, 'repair'));
    });
  }

  it('keeps the columns’ own Outlook comments out of the document — the block writes them', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({ parent: host, extensions: emailExtensions, content: '<p>x</p>' });
    editor.commands['insertColumns'](2);
    const out = editor.getHTML();
    editor.destroy();
    host.remove();
    expect(out).toContain('<!--[if mso]>');

    const names: string[] = [];
    parseHTML(out, schema, { mode: 'email' }).descendants((node) => {
      names.push(node.type.name);
      return true;
    });
    expect(names).toContain('columns');
    expect(names).not.toContain('htmlComment');
    expect(email(out)).toBe(out);
  });

  it('a foreign row makes the whole table foreign — no canonical node inside a preserved one', () => {
    const table = GOLDEN_HTML.find((html) => html.startsWith('<table'))!;
    const mixed = table.replace('<tr>', '<tr class="x">');
    expect(preserve(mixed)).toBe(mixed);
    const doc = parseHTML(mixed, schema, { mode: 'preserve' });
    expect(doc.child(0).type.name).toBe('htmlElement');
  });

  it('marks stay lenient: a decorated <b> is still bold', () => {
    const doc = parseHTML('<div><b class="x">bold</b></div>', schema, { mode: 'preserve' });
    expect(
      doc
        .child(0)
        .child(0)
        .marks.map((m) => m.type.name),
    ).toEqual(['bold']);
  });

  it('the clipboard parser repairs — pasted class soup does not survive', () => {
    const clipboard = createDOMParser(schema, 'repair');
    const dom = new DOMParser().parseFromString(
      '<div class="MsoNormal"><b>x</b></div>',
      'text/html',
    );
    const doc = clipboard.parse(dom.body);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(serializeToHTML(doc, schema)).toBe(
      '<div><strong style="font-weight: bold;">x</strong></div>',
    );
  });
});
