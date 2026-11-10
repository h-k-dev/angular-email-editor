import {
  correctStoredMistakes,
  dropDeadOfficeClasses,
  inlineBootstrapTableBorders,
  isBlockLink,
  lowerInlinesAroundBlocks,
  repairLinkSchemes,
  unwrapOfficeParagraphMarks,
  fixStoredMistakes,
  storedMistakes,
  videoPage,
} from './corrections';
import { refusedEmbedsAsLinks } from './embeds';
import { parseDocument } from './envelope';
import { createEditor } from './editor';
import { emailExtensions } from './extensions/kits';
import { parseHTML, serializeToHTML } from './html';
import { createSchema } from './schema';

const body = (html: string) => parseDocument(html).body;
const after = (html: string, correct: (root: HTMLElement) => void) => {
  const root = body(html);
  correct(root);
  return root.innerHTML;
};
const afterDocument = (html: string, correct: (dom: Document) => void) => {
  const dom = parseDocument(html);
  correct(dom);
  return dom.body.innerHTML;
};

describe('corrections', () => {
  describe('link schemes', () => {
    it('reads mailto:// and tel:// as the scheme a client knows', () => {
      expect(
        after('<a href="mailto://a@b.de">a</a><a href="TEL://+4930">t</a>', repairLinkSchemes),
      ).toBe('<a href="mailto:a@b.de">a</a><a href="tel:+4930">t</a>');
    });

    it('takes http:// off a link that is one placeholder', () => {
      expect(after('<a href="http://{{portal.link}}">p</a>', repairLinkSchemes)).toBe(
        '<a href="{{portal.link}}">p</a>',
      );
    });

    it('leaves links that already say what they mean', () => {
      const html =
        '<a href="mailto:a@b.de">a</a><a href="https://{{host}}/akte">h</a>' +
        '<a href="http://example.com/{{id}}">e</a><a href="{{link}}">l</a>';
      expect(after(html, repairLinkSchemes)).toBe(html);
    });
  });

  describe('embeds', () => {
    it('names the page a viewer opens', () => {
      expect(videoPage('//www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
      expect(videoPage('https://player.vimeo.com/video/123?h=1')).toBe('https://vimeo.com/123');
      expect(videoPage('https://cdn.example.com/clip.mp4')).toBe(
        'https://cdn.example.com/clip.mp4',
      );
    });

    it('turns a player into a link to its page, titled when it has one', () => {
      expect(
        after(
          '<div>a<iframe src="//www.youtube.com/embed/x1" title="Intro"></iframe></div>',
          refusedEmbedsAsLinks,
        ),
      ).toBe('<div>a<a href="https://www.youtube.com/watch?v=x1">Intro</a></div>');
    });

    it('drops a player with no web address to link', () => {
      expect(after('<div>a<iframe src="about:blank"></iframe></div>', refusedEmbedsAsLinks)).toBe(
        '<div>a</div>',
      );
    });
  });

  describe('Word', () => {
    it('unwraps <o:p>, keeping what it holds', () => {
      expect(after('<p>x<o:p></o:p></p><p><o:p>&nbsp;</o:p></p>', unwrapOfficeParagraphMarks)).toBe(
        '<p>x</p><p>&nbsp;</p>',
      );
    });

    it('leaves VML and the other Office elements alone', () => {
      const html = '<v:roundrect arcsize="10%"><w:anchorlock></w:anchorlock></v:roundrect>';
      expect(after(html, unwrapOfficeParagraphMarks)).toBe(html);
    });

    it('drops Mso classes no stylesheet defines, keeping the others', () => {
      expect(
        afterDocument(
          '<p class="MsoNormal note">x</p><p class="MsoListParagraph">y</p>',
          dropDeadOfficeClasses,
        ),
      ).toBe('<p class="note">x</p><p>y</p>');
    });

    it('keeps an Mso class the document styles', () => {
      const html =
        '<!doctype html><html><head><style>p.MsoNormal{margin:0}</style></head><body><p class="MsoNormal">x</p></body></html>';
      expect(afterDocument(html, dropDeadOfficeClasses)).toBe('<p class="MsoNormal">x</p>');
    });
  });

  describe('Bootstrap tables', () => {
    it('writes the borders inline and drops the dead classes', () => {
      expect(
        afterDocument(
          '<table class="table table-bordered"><tbody><tr><td>a</td></tr></tbody></table>',
          inlineBootstrapTableBorders,
        ),
      ).toBe(
        '<table style="width: 100%; border-collapse: collapse;"><tbody><tr><td style="border: 1px solid #dee2e6; padding: 8px;">a</td></tr></tbody></table>',
      );
    });

    it("lets the author's own declarations win and keeps other classes", () => {
      expect(
        afterDocument(
          '<table class="table table-bordered x" style="width: 50%"><tbody><tr><td style="padding: 2px">a</td></tr></tbody></table>',
          inlineBootstrapTableBorders,
        ),
      ).toBe(
        '<table class="x" style="width: 50%; border-collapse: collapse;"><tbody><tr><td style="padding: 2px; border: 1px solid #dee2e6;">a</td></tr></tbody></table>',
      );
    });

    it("borders only its own cells, not a nested table's", () => {
      const out = afterDocument(
        '<table class="table-bordered"><tbody><tr><td><table><tbody><tr><td>in</td></tr></tbody></table></td></tr></tbody></table>',
        inlineBootstrapTableBorders,
      );
      expect(out.match(/border: 1px/g)).toHaveLength(1);
    });

    it('leaves the class alone where a stylesheet defines it', () => {
      const html =
        '<!doctype html><html><head><style>.table-bordered td{border:1px solid red}</style></head><body><table class="table-bordered"><tbody><tr><td>a</td></tr></tbody></table></body></html>';
      expect(afterDocument(html, inlineBootstrapTableBorders)).toBe(
        '<table class="table-bordered"><tbody><tr><td>a</td></tr></tbody></table>',
      );
    });
  });

  describe('inline around blocks', () => {
    it('pushes the inline into each block and around each inline run', () => {
      expect(
        after('<div><font color="#888">--<br><div>a</div>b</font></div>', lowerInlinesAroundBlocks),
      ).toBe(
        '<div><font color="#888">--<br></font><div><font color="#888">a</font></div><font color="#888">b</font></div>',
      );
    });

    it('hands it on down through a block of blocks', () => {
      expect(
        after(
          '<span style="color:red"><div><div>a</div><div>b</div></div></span>',
          lowerInlinesAroundBlocks,
        ),
      ).toBe(
        '<div><div><span style="color:red">a</span></div><div><span style="color:red">b</span></div></div>',
      );
    });

    it('lowers nested inlines, inner first', () => {
      expect(
        after('<b><span style="color:red"><div>a</div></span></b>', lowerInlinesAroundBlocks),
      ).toBe('<div><b><span style="color:red">a</span></b></div>');
    });

    it('gives an empty block or a rule nothing to wrap', () => {
      expect(after('<i><div></div><hr></i>', lowerInlinesAroundBlocks)).toBe('<div></div><hr>');
    });

    it('leaves inlines that hold no block', () => {
      const html = '<div><b>a <span style="color:red">b</span></b></div><p><a href="x">c</a></p>';
      expect(after(html, lowerInlinesAroundBlocks)).toBe(html);
    });

    // A card that is one link — a promo's tile, as its author coded it.
    const TILE =
      '<a href="https://example.com/pixel-art" target="_blank" style="display:block; text-decoration:none; color:inherit;">' +
      '<table role="presentation" width="100%"><tbody>' +
      '<tr><td><img src="https://example.com/a.png" alt=""></td></tr>' +
      '<tr><td><h2>Pixel art</h2></td></tr>' +
      '</tbody></table></a>';

    for (const [what, html] of [
      ['a link that says it is a block, round a table', TILE],
      [
        'a link round a table, saying nothing',
        '<a href="x"><table><tbody><tr><td>a</td></tr></tbody></table></a>',
      ],
      [
        'a link round a block holding a table',
        '<a href="x"><div><table><tbody><tr><td>a</td></tr></tbody></table></div></a>',
      ],
      [
        'a link drawn as a box of its own',
        '<a href="x" style="padding:8px;display:inline-block"><div>a</div></a>',
      ],
      [
        'a block link whose display is marked important',
        '<a href="x" style="display: block !important"><div>a</div><div>b</div></a>',
      ],
    ]) {
      it(`leaves a block link as written: ${what}`, () => {
        expect(after(html, lowerInlinesAroundBlocks)).toBe(html);
        expect(isBlockLink(body(html).querySelector('a')!)).toBe(true);
        expect(storedMistakes(html)).toEqual([]);
      });
    }

    it('still lowers a link an editor wrapped round lines of text', () => {
      const html = '<a href="x"><div>a</div><div>b</div></a>';
      expect(isBlockLink(body(html).querySelector('a')!)).toBe(false);
      expect(after(html, lowerInlinesAroundBlocks)).toBe(
        '<div><a href="x">a</a></div><div><a href="x">b</a></div>',
      );
      // An inline display is no box of its own.
      expect(
        after('<a href="x" style="display:inline"><div>a</div></a>', lowerInlinesAroundBlocks),
      ).toBe('<div><a href="x" style="display:inline">a</a></div>');
    });

    it('hands a table’s wrapper to its cells — its own, and a nested table’s through them — and reads back the same', () => {
      const out = after(
        '<font color="red"><table><tbody><tr><td>a</td><td><table><tbody><tr><td>b</td></tr></tbody></table></td><td></td></tr></tbody></table></font>',
        lowerInlinesAroundBlocks,
      );
      expect(out).toBe(
        '<table><tbody><tr><td><font color="red">a</font></td><td><table><tbody><tr><td><font color="red">b</font></td></tr></tbody></table></td><td></td></tr></tbody></table>',
      );
      // Between a table and its rows the wrapper would be moved out, empty.
      expect(body(out).innerHTML).toBe(out);
    });
  });

  it('runs every correction over a document', () => {
    const dom = parseDocument(
      '<p class="MsoNormal"><b><span style="color:red">x<o:p></o:p></span></b></p><a href="mailto://a@b.de">m</a>',
    );
    correctStoredMistakes(dom);
    expect(dom.body.innerHTML).toBe(
      '<p><b><span style="color:red">x</span></b></p><a href="mailto:a@b.de">m</a>',
    );
  });
});

describe('stored mistakes — found, offered, never fixed on their own', () => {
  const schema = createSchema(emailExtensions);
  const STORED = '<div><a href="mailto://a@b.de">mail</a></div><p>x<o:p></o:p></p>';

  it('the parse keeps them as written', () => {
    const doc = parseHTML(STORED, schema);
    expect(serializeToHTML(doc, schema)).toContain('mailto://a@b.de');
    expect(serializeToHTML(doc, schema)).toContain('<o:p>');
  });

  it('says what a document holds — off a copy, the document untouched', () => {
    const doc = parseHTML(STORED, schema);
    const before = serializeToHTML(doc, schema);
    expect(storedMistakes(doc)).toEqual([
      { kind: 'link-scheme', count: 1 },
      { kind: 'office-mark', count: 1 },
    ]);
    expect(storedMistakes(before)).toEqual(storedMistakes(doc));
    expect(serializeToHTML(doc, schema)).toBe(before);
  });

  it('finds none in an email that holds none', () => {
    expect(storedMistakes('<div>fine <a href="mailto:a@b.de">mail</a></div>')).toEqual([]);
  });

  it('fixes them all as one undo step', () => {
    const host = document.createElement('div');
    const editor = createEditor({ parent: host, extensions: emailExtensions, content: STORED });
    const before = editor.getHTML();
    expect(editor.exec(fixStoredMistakes)).toBe(true);
    expect(editor.getHTML()).toContain('href="mailto:a@b.de"');
    expect(editor.getHTML()).not.toContain('o:p');
    expect(storedMistakes(editor.state.doc)).toEqual([]);
    expect(editor.exec(fixStoredMistakes)).toBe(false);
    editor.commands['undo']();
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });

  it('keeps a whole document’s head as it was', () => {
    const html =
      '<!DOCTYPE html><html><head><style>.MsoNormal{margin:0}</style></head><body><p class="MsoNormal">x<o:p></o:p></p></body></html>';
    const host = document.createElement('div');
    const editor = createEditor({ parent: host, extensions: emailExtensions, content: html });
    editor.exec(fixStoredMistakes);
    expect(editor.getHTML()).toContain('.MsoNormal{margin:0}');
    // The class is defined by the head: not dead, kept.
    expect(editor.getHTML()).toContain('class="MsoNormal"');
    expect(editor.getHTML()).not.toContain('o:p');
    editor.destroy();
  });
});
