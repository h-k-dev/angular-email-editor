import { NodeSelection, TextSelection } from 'prosemirror-state';
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { lintHTML } from './html-source';
import { emailExtensions } from './extensions/kits';
import { createEditor } from './editor';
import {
  filterEmailStyle,
  isEmailAttribute,
  isEmailCssProperty,
  isEmailTag,
  splitDeclarations,
} from './email-vocabulary';

const schema = createSchema(emailExtensions);
const email = (html: string) => serializeToHTML(parseHTML(html, schema, { mode: 'email' }), schema);
const preserve = (html: string) =>
  serializeToHTML(parseHTML(html, schema, { mode: 'preserve' }), schema);

describe('the email vocabulary — what Apple Mail, Outlook or Gmail applies', () => {
  it('knows the tags MJML and table templates are built from', () => {
    for (const tag of [
      'table',
      'td',
      'center',
      'font',
      'input',
      'label',
      'video',
      'v:rect',
      'o:p',
    ]) {
      expect(isEmailTag(tag)).toBe(true);
    }
    for (const tag of ['my-widget', 'canvas', 'dialog', 'slot', 'script', 'iframe']) {
      expect(isEmailTag(tag)).toBe(false);
    }
  });

  it('knows legacy presentational attributes, ARIA and namespaces — not data-* or framework bindings', () => {
    for (const name of [
      'bgcolor',
      'cellpadding',
      'valign',
      'role',
      'aria-roledescription',
      'xmlns:v',
    ]) {
      expect(isEmailAttribute(name)).toBe(true);
    }
    for (const name of ['data-id', 'ng-click', 'v-if', '@click', ':prop', 'x-data', 'onclick']) {
      expect(isEmailAttribute(name)).toBe(false);
    }
    // Outlook's own elements keep every attribute — VML is its own vocabulary.
    expect(isEmailAttribute('fillcolor', 'v:roundrect')).toBe(true);
  });

  it('knows real CSS, vendor prefixes of it, mso-* and custom properties — not inventions', () => {
    for (const property of [
      'mso-line-height-rule',
      '-webkit-text-size-adjust',
      '-ms-interpolation-mode',
      '-moz-user-select',
      '--brand',
      'Font-Size',
    ]) {
      expect(isEmailCssProperty(property)).toBe(true);
    }
    for (const property of ['colr', 'font-sizee', '-webkit-madeup', 'mso', 'foo']) {
      expect(isEmailCssProperty(property)).toBe(false);
    }
  });

  it('splits declarations at top-level semicolons only', () => {
    expect(splitDeclarations("a:1;background:url(data:image/png;base64,xyz);c:'x;y'")).toEqual([
      'a:1',
      'background:url(data:image/png;base64,xyz)',
      "c:'x;y'",
    ]);
  });

  it('filters a style byte-identically when nothing is dropped', () => {
    const mjml =
      'border:none;border-radius:3px;cursor:auto;mso-padding-alt:10px 25px;background:#bd8714;';
    expect(filterEmailStyle(mjml)).toEqual({ style: mjml, dropped: [] });
    expect(filterEmailStyle('color: red; colr: blue; font-size: 12px')).toEqual({
      style: 'color: red; font-size: 12px',
      dropped: ['colr'],
    });
  });
});

describe('email parse — drops what no floor client applies; preserve keeps it', () => {
  it('drops unknown attributes and CSS, keeps the rest exactly as written', () => {
    const source =
      '<div class="k" data-id="7" ng-click="go()" style="color:red;colr:blue;--brand:#f00">x</div>';
    expect(email(source)).toBe('<div class="k" style="color:red;--brand:#f00">x</div>');
    expect(preserve(source)).toBe(
      '<div class="k" data-id="7" ng-click="go()" style="color:red;colr:blue;--brand:#f00">x</div>',
    );
  });

  it('unwraps custom elements, keeping their content', () => {
    const source = '<my-card class="c"><div style="color:red">in</div></my-card>';
    expect(email(source)).toBe('<div style="color:red">in</div>');
    expect(preserve(source)).toBe(source);
  });

  it('never leaks executable content as text, in any mode', () => {
    const source = '<div>a</div><script>evil()</script><my-x><script>worse()</script>b</my-x>';
    for (const html of [email(source), preserve(source)]) {
      expect(html).not.toContain('evil');
      expect(html).not.toContain('worse');
    }
  });

  it('keeps data URIs whole', () => {
    const source = '<div style="background:url(data:image/png;base64,AAAA);padding:4px">x</div>';
    expect(email(source)).toBe(source);
  });

  it('applies the vocabulary to the envelope too', () => {
    const source =
      '<!doctype html><html lang="en" data-app="1"><head><title>t</title></head>' +
      '<body style="margin:0" v-cloak><div>x</div></body></html>';
    const html = email(source);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<body style="margin:0">');
  });
});

describe('authored markup on the composer’s own nodes', () => {
  it('keeps the composer’s canonical output canonical — authored markup is only what differs', () => {
    const doc = parseHTML(
      '<div>plain</div><p class="lead">lead</p><h2 style="color:red">t</h2>',
      schema,
      {
        mode: 'email',
      },
    );
    expect(doc.child(0).attrs['html']).toBeNull();
    expect(doc.child(1).type.name).toBe('paragraph');
    expect(doc.child(1).attrs['html'].path).toEqual([{ tag: 'p', attrs: [['class', 'lead']] }]);
    expect(doc.child(2).type.name).toBe('heading');
    expect(doc.child(2).attrs['level']).toBe(2);
    expect(serializeToHTML(doc, schema)).toBe(
      '<div>plain</div><p class="lead">lead</p><h2 style="color:red">t</h2>',
    );
  });

  it('makes every image an image node, carrying its authored markup', () => {
    const doc = parseHTML(
      '<table><tr><td style="width:105px"><img src="a.png" alt="logo" height="auto"></td></tr></table>' +
        '<div>Hi <img src="s.png" alt=":)"> there</div>',
      schema,
      { mode: 'email' },
    );
    const images: unknown[] = [];
    doc.descendants((node) => {
      if (node.type.name === 'image') images.push(node.attrs['html'].path[0]);
      return true;
    });
    expect(images).toEqual([
      {
        tag: 'img',
        attrs: [
          ['src', 'a.png'],
          ['alt', 'logo'],
          ['height', 'auto'],
        ],
      },
      {
        tag: 'img',
        attrs: [
          ['src', 's.png'],
          ['alt', ':)'],
        ],
      },
    ]);
    expect(serializeToHTML(doc, schema)).toBe(
      '<table><tbody><tr><td style="width:105px"><img src="a.png" alt="logo" height="auto"></td></tr></tbody></table>' +
        '<div>Hi <img src="s.png" alt=":)"> there</div>',
    );
  });

  it('a linked image is the image node under a link, the link exactly as written', () => {
    const source =
      '<table><tr><td><a href="https://x.io" target="_blank" style="color:inherit"><img src="a.png" alt="a"></a></td></tr></table>';
    expect(email(source)).toBe(
      '<table><tbody><tr><td><a href="https://x.io" target="_blank" style="color:inherit"><img src="a.png" alt="a"></a></td></tr></tbody></table>',
    );
  });
});

describe('editing authored lines', () => {
  const mount = (html: string) => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditor({ parent, extensions: emailExtensions, parseMode: 'email' });
    editor.setContent(html);
    return {
      editor,
      done: () => {
        editor.destroy();
        parent.remove();
      },
    };
  };
  const cursorIn = (editor: ReturnType<typeof createEditor>, text: string, atEnd = false) => {
    let pos = -1;
    editor.state.doc.descendants((node, offset) => {
      if (pos < 0 && node.isText && node.text!.includes(text)) {
        pos = offset + node.text!.indexOf(text) + (atEnd ? text.length : 0);
      }
      return pos < 0;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  };
  const press = (editor: ReturnType<typeof createEditor>, key: string) => {
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  it('writes alignment into the authored style, in its own punctuation', () => {
    const { editor, done } = mount(
      '<div style="font-size:11px;text-align:left;color:#000">line</div><p align="left">legacy</p>',
    );
    cursorIn(editor, 'line');
    editor.commands['setAlignment']('center');
    cursorIn(editor, 'legacy');
    editor.commands['setAlignment']('right');
    expect(editor.getHTML()).toBe(
      '<div style="font-size:11px;text-align:center;color:#000">line</div><p align="right">legacy</p>',
    );
    // "Left" on an authored line stays explicit — its container may centre.
    cursorIn(editor, 'line');
    editor.commands['setAlignment'](null);
    expect(editor.getHTML()).toContain('text-align:left;');
    done();
  });

  it('Enter at the end of an authored line starts a line with the same markup, minus the id', () => {
    const { editor, done } = mount('<div id="a" style="font-size:11px;color:#000">first</div>');
    cursorIn(editor, 'first', true);
    press(editor, 'Enter');
    editor.view.dispatch(editor.state.tr.insertText('second'));
    expect(editor.getHTML()).toBe(
      '<div id="a" style="font-size:11px;color:#000">first</div><div style="font-size:11px;color:#000">second</div>',
    );
    done();
  });

  it('Enter in a table cell breaks the line instead of adding a cell', () => {
    const { editor, done } = mount('<table><tr><td bgcolor="#fff">one</td></tr></table>');
    cursorIn(editor, 'one', true);
    press(editor, 'Enter');
    editor.view.dispatch(editor.state.tr.insertText('two'));
    expect(editor.getHTML()).toBe(
      '<table><tbody><tr><td bgcolor="#fff">one<br>two</td></tr></tbody></table>',
    );
    done();
  });

  it('marks work on authored text like on any line', () => {
    const { editor, done } = mount('<div style="font-size:11px">make bold</div>');
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && from < 0) from = pos;
      return from < 0;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + 4)),
    );
    editor.commands['toggleBold']();
    expect(editor.getHTML()).toBe(
      '<div style="font-size:11px"><strong style="font-weight: bold;">make</strong> bold</div>',
    );
    done();
  });
});

describe('lint names exactly what the email parse drops', () => {
  it('warns on tags, attributes and CSS properties outside the vocabulary', () => {
    const messages = lintHTML(
      '<my-card><div data-id="1" style="colr: red; color: red">x</div></my-card>',
      undefined,
      { mode: 'email' },
    ).map((d) => d.message);
    expect(messages).toEqual([
      expect.stringContaining("<my-card> isn't applied by Apple Mail, Outlook or Gmail"),
      expect.stringContaining('"data-id" isn\'t applied'),
      expect.stringContaining('"colr" isn\'t applied'),
    ]);
  });

  it('accepts what MJML-class markup uses', () => {
    const source =
      '<table align="center" border="0" cellpadding="0" bgcolor="#fff" role="presentation">' +
      '<tr><td style="mso-line-height-rule:exactly;-webkit-text-size-adjust:100%">' +
      '<input type="checkbox" id="m" style="display:none"><label for="m">x</label></td></tr></table>';
    expect(
      lintHTML(source, undefined, { mode: 'email' }).filter((d) =>
        d.message.includes('dropped on parse'),
      ),
    ).toEqual([]);
  });

  it('accepts comments and conditionals, and the document envelope, as content', () => {
    const source =
      '<!doctype html><html lang="en"><head><title></title><meta charset="utf-8">' +
      '<style>p { margin: 0 }</style></head><body><!-- note --><div>a</div>' +
      '<!--[if mso]>ghost<![endif]--></body></html>';
    expect(lintHTML(source, undefined, { mode: 'email' })).toEqual([]);
  });

  it('repair mode keeps its own lint: comments dropped, tags outside the safe set flagged', () => {
    const messages = lintHTML('<!-- note --><video></video>').map((d) => d.message);
    expect(messages.some((m) => m.includes('drops them'))).toBe(true);
    expect(messages.some((m) => m.includes('not email-safe'))).toBe(true);
  });
});

describe('editing authored markup patches the edit in, nothing else', () => {
  const mount = (html: string) => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditor({ parent, extensions: emailExtensions });
    editor.setContent(html);
    return {
      editor,
      done: () => {
        editor.destroy();
        parent.remove();
      },
    };
  };
  const posOf = (editor: ReturnType<typeof createEditor>, name: string) => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.type.name === name) found = pos;
      return found < 0;
    });
    return found;
  };

  it('a cell fill lands in the authored cell’s own style, beside what it had', () => {
    const { editor, done } = mount(
      '<table class="t" cellpadding="0"><tbody><tr><td class="c" style="font-size:0px;padding:10px 25px;">x</td></tr></tbody></table>',
    );
    const cell = posOf(editor, 'tableCell');
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cell + 1)),
    );
    expect(editor.commands['setCellBackground']('#e6f4ea')).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain('<table class="t" cellpadding="0"><tbody><tr><td class="c" style="');
    expect(html).toMatch(
      /font-size:0px;padding:10px 25px;background-color:\s?rgb\(230, 244, 234\);/,
    );
    done();
  });

  it('a new row in an authored table is the composer’s own, the authored rows untouched', () => {
    const { editor, done } = mount(
      '<table class="t"><tbody><tr class="r"><td class="c">a</td></tr></tbody></table>',
    );
    const cell = posOf(editor, 'tableCell');
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cell + 1)),
    );
    expect(editor.commands['addRowAfter']()).toBe(true);
    const html = editor.getHTML();
    expect(
      html.startsWith('<table class="t"><tbody><tr class="r"><td class="c">a</td></tr><tr>'),
    ).toBe(true);
    done();
  });

  it('an image’s alt is written into its authored attributes, in place', () => {
    const { editor, done } = mount(
      '<div><img alt="old" src="a.png" style="border:0;display:block;" height="auto"></div>',
    );
    const image = posOf(editor, 'image');
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, image)),
    );
    expect(editor.commands['setImageAlt']('new')).toBe(true);
    expect(editor.getHTML()).toBe(
      '<div><img alt="new" src="a.png" style="border:0;display:block;" height="auto"></div>',
    );
    done();
  });

  it('an authored <b class> stays itself while bold, and goes when bold is taken off', () => {
    const { editor, done } = mount('<div><b class="k">bold</b> text</div>');
    expect(editor.getHTML()).toBe('<div><b class="k">bold</b> text</div>');
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)),
    );
    editor.commands['toggleBold']();
    expect(editor.getHTML()).toBe('<div>bold text</div>');
    done();
  });

  it('the editor view keeps its editing-only attributes on an authored link', () => {
    const { editor, done } = mount('<div><a class="x" href="https://x.io">go</a></div>');
    const anchor = editor.view.dom.querySelector('a')!;
    expect(anchor.getAttribute('class')).toBe('x');
    expect(anchor.getAttribute('tabindex')).toBe('-1');
    expect(editor.getHTML()).toBe('<div><a class="x" href="https://x.io">go</a></div>');
    done();
  });
});
