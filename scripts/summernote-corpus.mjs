/**
 * Writes the Summernote corpus: what iusta-core-frontend's Summernote stores
 * for the things its users do, one fixture per scenario, under
 * `projects/angular-email-editor/src/lib/prose-mirror/fixtures/summernote/`.
 *
 * Nothing here is hand-written HTML pretending to be Summernote's. The
 * scenarios drive the real Summernote 0.9.1 (lite) out of core's own
 * `node_modules`, with core's three patches and core's init sequence
 * (`common/wysiwyg-editor/summernote.ts`, `wysiwyg-editor.ts`), in headless
 * Chromium: they type, select, press shortcuts, run the toolbar's commands
 * and paste through the real clipboard. What a fixture holds is
 * `summernote('code')` afterwards — exactly what core saves.
 *
 *   node scripts/summernote-corpus.mjs [path/to/iusta-core-frontend]
 *
 * The default core path is the sibling checkout. Re-run it when core moves to
 * another Summernote or changes its patches; `summernote-corpus.spec.ts`
 * reads the files, it never runs this.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

const core = resolve(process.argv[2] ?? '../../iusta-repo/iusta-core-frontend');
const modules = join(core, 'node_modules');
const jquery = process.env.JQUERY ?? join(modules, 'jquery/dist/jquery.js');
if (!existsSync(jquery)) throw new Error(`no jQuery at ${jquery} — set JQUERY=path/to/jquery.js`);
const out = 'projects/angular-email-editor/src/lib/prose-mirror/fixtures/summernote';

// ── core's patches, as summernote.ts applies them ───────────────────────

/** Runs in the page: `patch($)` from core's summernote.ts, verbatim in
    behaviour (emptyPara and wrap make `<div>` lines, splitTree is lifted
    past the shape that throws on Return after picking a font). */
function patchSummernote() {
  const $ = window.jQuery;
  $.summernote.dom.emptyPara = `<div>${$.summernote.dom.blank}</div>`;

  $.summernote.dom.wrap = (node, wrapperName) => {
    const parent = node.parentNode;
    if (wrapperName === 'p') wrapperName = 'div';
    const wrapper = $('<' + wrapperName + '>')[0];
    parent?.insertBefore(wrapper, node);
    wrapper.appendChild(node);
    return wrapper;
  };

  const nodeLength = (node) =>
    node.nodeType === Node.TEXT_NODE ? (node.nodeValue?.length ?? 0) : node.childNodes.length;
  const ancestorsUpTo = (root, node) => {
    const chain = [];
    for (let current = node; current; current = current.parentNode) {
      chain.push(current);
      if (current === root) break;
    }
    return chain;
  };
  const throwsOnSiblingPrePass = (root, point) => {
    if (point.offset === 0 || point.offset !== nodeLength(point.node)) return false;
    const ancestors = ancestorsUpTo(root, point.node);
    if (ancestors.length <= 2) return false;
    const sibling = ancestors.slice(0, -1).find((node) => node.nextSibling)?.nextSibling;
    return sibling?.nodeType === Node.ELEMENT_NODE && !sibling.firstChild;
  };
  const liftSplitPoint = (root, point) => {
    let lifted = point;
    while (lifted.node !== root && lifted.node.parentNode && throwsOnSiblingPrePass(root, lifted)) {
      const parent = lifted.node.parentNode;
      lifted = { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, lifted.node) + 1 };
    }
    return lifted;
  };
  const splitTree = $.summernote.dom.splitTree;
  $.summernote.dom.splitTree = (root, point, options) => splitTree(root, liftSplitPoint(root, point), options);
}

/** Runs in the page: wysiwyg-editor.ts's settings and ngAfterViewInit. */
function initSummernote() {
  const $ = window.jQuery;
  const editor = $('#summernote').summernote({
    tabsize: 2,
    tabDisable: false,
    fontNames: [
      'Arial', 'Arial Black', 'Calibri', 'Courier New', 'Georgia', 'Helvetica',
      'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Poppins', 'Roboto',
    ],
    disableResizeEditor: false,
    dialogsInBody: false,
  });
  editor.summernote('fontSize', 13);
  editor.summernote('fontName', 'Arial');
  editor.summernote('dialogsInBody', false);
  editor.summernote('code', '');
}

// ── what a scenario can do ──────────────────────────────────────────────

const helpers = (page) => ({
  /** Click into the editable, at its end, the way a user starts writing. */
  async focus() {
    await page.click('.note-editable');
    await page.keyboard.press('Control+End');
  },
  /** Click the n-th match of a selector inside the editable, as a user
      clicks into a table cell. */
  click: (selector, nth = 0) => page.locator(`.note-editable ${selector}`).nth(nth).click(),
  type: (text) => page.keyboard.type(text),
  press: (key) => page.keyboard.press(key),
  /** Lines typed with Return between them. */
  async lines(...lines) {
    for (const [i, line] of lines.entries()) {
      if (i) await page.keyboard.press('Enter');
      if (line) await page.keyboard.type(line);
    }
  },
  /** Select the n-th occurrence of `text` in the editable (one text node). */
  select: (text, nth = 0) =>
    page.evaluate(
      ([text, nth]) => {
        const editable = document.querySelector('.note-editable');
        const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
        let seen = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.nodeValue.indexOf(text);
          if (at < 0 || seen++ < nth) continue;
          editable.focus();
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + text.length);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          // Summernote tracks its last range on these.
          editable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          editable.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          return;
        }
        throw new Error(`no text "${text}" (#${nth}) to select`);
      },
      [text, nth],
    ),
  /** Put the caret at the end of the n-th occurrence of `text`. */
  caretAfter: (text, nth = 0) =>
    page.evaluate(
      ([text, nth]) => {
        const editable = document.querySelector('.note-editable');
        const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
        let seen = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.nodeValue.indexOf(text);
          if (at < 0 || seen++ < nth) continue;
          editable.focus();
          const range = document.createRange();
          range.setStart(node, at + text.length);
          range.collapse(true);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          editable.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          return;
        }
        throw new Error(`no text "${text}" (#${nth}) for the caret`);
      },
      [text, nth],
    ),
  /** A toolbar command through Summernote's own API — what its buttons call. */
  cmd: (name, ...args) =>
    page.evaluate(
      ([name, args]) => window.jQuery('#summernote').summernote(name, ...args),
      [name, args],
    ),
  /** `insertImage` resolves after the image loads. */
  image: (src, filename) =>
    page.evaluate(
      ([src, filename]) =>
        new Promise((done) => {
          const $ = window.jQuery;
          const context = $('#summernote').data('summernote');
          context.invoke('editor.insertImage', src, filename);
          setTimeout(done, 300);
        }),
      [src, filename],
    ),
  /** The video dialog's insert, without the dialog. */
  video: (url) =>
    page.evaluate((url) => {
      const $ = window.jQuery;
      const context = $('#summernote').data('summernote');
      const node = context.modules.videoDialog.createVideoNode(url);
      context.invoke('editor.insertNode', node);
    }, url),
  /** Paste through the real clipboard and Chromium's own paste handling. */
  async paste(html, text) {
    await page.evaluate(
      ([html, text]) =>
        navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]),
      [html, text],
    );
    await page.keyboard.press('Control+V');
  },
  /** What the code view or a template seed does: the HTML set as is. */
  code: (html) => page.evaluate((html) => window.jQuery('#summernote').summernote('code', html), html),
});

// ── the scenarios ───────────────────────────────────────────────────────

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAG0lEQVR42mNkYPhfz0AEYBxVSF+FAwMjRgUAAP8iBgEtYn2YAAAAAElFTkSuQmCC';

const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"><style><!--
p.MsoNormal{margin:0cm;margin-bottom:.0001pt;font-size:11.0pt;font-family:"Calibri",sans-serif;}
--></style></head><body lang=DE><!--StartFragment--><p class=MsoNormal><b><span style='font-size:12.0pt;font-family:"Calibri",sans-serif;color:#1F3864'>Sehr geehrte Frau {{contact.lastName}},<o:p></o:p></span></b></p>
<p class=MsoNormal><span style='font-family:"Calibri",sans-serif'>in der Sache <i>Müller ./. Schmidt</i> (Az. {{case.reference}}) übersenden wir Ihnen anbei den <u>Schriftsatz</u> vom heutigen Tage.<o:p></o:p></span></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoListParagraph style='margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Klageschrift<o:p></o:p></p>
<p class=MsoListParagraph style='margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Vollmacht<o:p></o:p></p>
<p class=MsoNormal align=right style='text-align:right'><span style='font-size:9.0pt;color:gray'>Stand: {{date.today}}<o:p></o:p></span></p><!--EndFragment--></body></html>`;

const OUTLOOK_SIGNATURE = `<table border=0 cellspacing=0 cellpadding=0 style='border-collapse:collapse'><tr><td width=80 valign=top style='width:60.0pt;padding:0cm 5.4pt 0cm 5.4pt'><p class=MsoNormal><img width=64 height=64 src="https://cdn.example.com/kanzlei/logo.png" alt="Kanzlei"></p></td><td valign=top style='border-left:solid #2E74B5 1.5pt;padding:0cm 5.4pt 0cm 5.4pt'><p class=MsoNormal><b><span style='font-size:10.0pt;color:#2E74B5'>Dr. Anna Beispiel</span></b><br><span style='font-size:9.0pt;color:#595959'>Rechtsanwältin | Fachanwältin für Arbeitsrecht</span></p><p class=MsoNormal><span style='font-size:9.0pt'>T <a href="tel:+4930123456">+49 30 123456</a> · <a href="mailto:anna@kanzlei.example">anna@kanzlei.example</a></span></p></td></tr></table>`;

const GMAIL = `<div dir="ltr"><div>Hallo zusammen,</div><div><br></div><div>wie besprochen der <a href="https://portal.example.com/akte/4711" target="_blank">Link zur Akte</a>.</div><div><br></div><div>Viele Grüße</div><div><font color="#888888">--<br><div dir="ltr" class="gmail_signature"><div><b>Max Mustermann</b></div><div>Kanzlei Beispiel</div></div></font></div></div>`;

const WEB = `<h2 style="font-family: Roboto, sans-serif; color: rgb(32, 33, 36);">Ihre Rechte als Mandant</h2><p style="margin: 0 0 12px; line-height: 1.6;">Sie haben jederzeit das Recht auf <strong>Auskunft</strong>, <em>Berichtigung</em> und <span style="text-decoration: line-through;">Löschung</span> Ihrer Daten.</p><ul><li>Art. 15 DSGVO</li><li>Art. 16 DSGVO<ul><li>mit Frist</li></ul></li></ul><blockquote style="border-left: 3px solid #ccc; padding-left: 8px;">Zitat aus dem Urteil.</blockquote>`;

/** Each scenario: what a core user does, in Summernote, before saving. */
const scenarios = {
  async 'plain-lines'(h) {
    await h.focus();
    await h.lines(
      'Sehr geehrte Damen und Herren,', '',
      'anbei erhalten Sie die angeforderten Unterlagen.', '',
      'Mit freundlichen Grüßen', '{{user.firstName}} {{user.lastName}}',
    );
  },

  async 'inline-marks'(h) {
    await h.focus();
    await h.type('Bitte beachten Sie die Frist bis zum 31.12. und den Hinweis unten.');
    await h.select('beachten');
    await h.press('Control+B');
    await h.select('Frist');
    await h.press('Control+I');
    await h.select('31.12.');
    await h.press('Control+U');
    await h.select('Hinweis');
    await h.cmd('strikethrough');
    await h.select('unten');
    await h.cmd('bold');
    await h.cmd('italic');
    await h.cmd('underline');
  },

  async 'fonts'(h) {
    await h.focus();
    await h.lines('Überschrift in Georgia', 'Kleingedrucktes in Verdana', 'Normaler Text');
    await h.select('Überschrift in Georgia');
    await h.cmd('fontName', 'Georgia');
    await h.cmd('fontSize', 24);
    await h.select('Kleingedrucktes in Verdana');
    await h.cmd('fontName', 'Verdana');
    await h.cmd('fontSize', 10);
  },

  /** Core's bug report: Return after picking a font — the splitTree patch. */
  async 'font-then-return'(h) {
    await h.focus();
    await h.type('Erste Zeile ');
    await h.cmd('fontName', 'Courier New');
    await h.type('in Courier');
    await h.press('Enter');
    await h.type('Zweite Zeile');
    await h.press('Enter');
    await h.press('Enter');
    await h.type('Nach einer Leerzeile');
  },

  async 'colors'(h) {
    await h.focus();
    await h.type('Rot, gelb hinterlegt und blau auf grau.');
    await h.select('Rot');
    await h.cmd('foreColor', '#FF0000');
    await h.select('gelb hinterlegt');
    await h.cmd('backColor', '#FFFF00');
    await h.select('blau auf grau');
    await h.cmd('color', { foreColor: '#0000FF', backColor: '#E7E6E6' });
  },

  async 'lists'(h) {
    await h.focus();
    await h.lines('Unterlagen:');
    await h.press('Enter');
    await h.cmd('insertUnorderedList');
    await h.lines('Personalausweis', 'Vollmacht');
    await h.press('Enter');
    await h.cmd('indent');
    await h.lines('unterschrieben');
    await h.press('Enter');
    await h.cmd('outdent');
    await h.type('Rechnung {{invoice.number}}');
    await h.press('Enter');
    await h.press('Enter');
    await h.lines('Schritte:');
    await h.press('Enter');
    await h.cmd('insertOrderedList');
    await h.lines('Prüfen', 'Unterschreiben', 'Zurücksenden');
  },

  async 'alignment-indent'(h) {
    await h.focus();
    await h.lines('Zentriert', 'Rechts', 'Blocksatz mit etwas mehr Text, damit es umbricht.', 'Eingerückt');
    await h.caretAfter('Zentriert');
    await h.cmd('justifyCenter');
    await h.caretAfter('Rechts');
    await h.cmd('justifyRight');
    await h.caretAfter('umbricht.');
    await h.cmd('justifyFull');
    await h.caretAfter('Eingerückt');
    await h.cmd('indent');
    await h.cmd('indent');
  },

  async 'block-styles'(h) {
    await h.focus();
    await h.lines('Titel', 'Untertitel', 'Ein Zitat', 'Code {{raw}}', 'Normal');
    for (const [text, tag] of [['Titel', 'H1'], ['Untertitel', 'H3'], ['Ein Zitat', 'BLOCKQUOTE'], ['Code', 'PRE']]) {
      await h.caretAfter(text);
      await h.cmd('formatBlock', tag);
    }
  },

  async 'table'(h) {
    await h.focus();
    await h.lines('Kostenübersicht:');
    await h.press('Enter');
    await h.cmd('insertTable', '3x3');
    const cells = ['Posten', 'Betrag', 'Fällig', 'Gebühr', '{{fee.amount}} €', '{{fee.due}}', 'Auslagen', '20,00 €', 'sofort'];
    for (const [i, cell] of cells.entries()) {
      await h.click('td', i);
      await h.type(cell);
    }
    await h.select('Posten');
    await h.cmd('bold');
  },

  async 'links'(h) {
    await h.focus();
    await h.lines('Zum Portal', 'Ihr Termin', 'Schreiben Sie uns', 'Link aus Platzhalter');
    await h.select('Zum Portal');
    await h.cmd('createLink', { text: 'Zum Portal', url: 'https://portal.example.com/akte/{{case.id}}', isNewWindow: true });
    await h.select('Ihr Termin');
    await h.cmd('createLink', { text: 'Ihr Termin', url: 'www.example.com/termin', isNewWindow: false });
    await h.select('Schreiben Sie uns');
    await h.cmd('createLink', { text: 'Schreiben Sie uns', url: 'kanzlei@example.com', isNewWindow: false });
    await h.select('Link aus Platzhalter');
    await h.cmd('createLink', { text: 'Link aus Platzhalter', url: '{{portal.link}}', isNewWindow: true });
  },

  async 'image'(h) {
    await h.focus();
    await h.lines('Logo:', '');
    await h.image(PIXEL, 'logo.png');
    await h.press('Enter');
    await h.type('Unterschrift folgt.');
  },

  async 'hr-and-video'(h) {
    await h.focus();
    await h.lines('Oben', 'Unten', 'Video:');
    await h.caretAfter('Oben');
    await h.cmd('insertHorizontalRule');
    await h.caretAfter('Video:');
    await h.video('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  },

  async 'paste-word'(h) {
    await h.focus();
    await h.paste(WORD, 'Sehr geehrte Frau {{contact.lastName}}, …');
  },

  async 'paste-outlook-signature'(h) {
    await h.focus();
    await h.lines('Mit freundlichen Grüßen', '');
    await h.paste(OUTLOOK_SIGNATURE, 'Dr. Anna Beispiel');
  },

  async 'paste-gmail'(h) {
    await h.focus();
    await h.paste(GMAIL, 'Hallo zusammen, …');
  },

  async 'paste-web'(h) {
    await h.focus();
    await h.paste(WEB, 'Ihre Rechte als Mandant …');
  },

  /** A template body set through the code view, then touched up visually. */
  async 'codeview-template'(h) {
    await h.code(
      '<div style="font-family: Arial; font-size: 13px;">Sehr geehrte{{#if contact.female}} Frau{{else}}r Herr{{/if}} {{contact.lastName}},</div>' +
        '<div><br></div>' +
        '<div>Ihr Aktenzeichen: <b>{{case.reference}}</b></div>' +
        '<table style="width: 100%; border-collapse: collapse;" border="1"><tbody><tr><td style="padding: 4px;">Gericht</td><td style="padding: 4px;">{{court.name}}</td></tr></tbody></table>' +
        '<div><a href="{{portal.link}}" target="_blank">Portal öffnen</a></div>',
    );
    await h.caretAfter('Portal öffnen');
    await h.press('End');
    await h.press('Enter');
    await h.type('Mit freundlichen Grüßen');
  },
};

// ── run ─────────────────────────────────────────────────────────────────

// Served from localhost, not `about:blank`: the clipboard API wants a
// secure context, and a paste must be Chromium's own to be real.
const server = createServer((_, res) =>
  res.end('<!doctype html><html><head></head><body><div id="summernote"></div></body></html>'),
);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });

mkdirSync(out, { recursive: true });
for (const file of readdirSync(out)) if (file.endsWith('.html')) rmSync(join(out, file));

let index = 0;
for (const [name, scenario] of Object.entries(scenarios)) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.addStyleTag({ path: join(modules, 'summernote/dist/summernote-lite.css') });
  await page.addScriptTag({ path: jquery });
  await page.addScriptTag({ path: join(modules, 'summernote/dist/summernote-lite.js') });
  await page.evaluate(patchSummernote);
  await page.evaluate(initSummernote);

  await scenario(helpers(page));
  const code = await page.evaluate(() => window.jQuery('#summernote').summernote('code'));
  if (errors.length) throw new Error(`${name}: Summernote threw — ${errors.join('; ')}`);

  const file = `${String(++index).padStart(2, '0')}-${name}.html`;
  writeFileSync(join(out, file), code);
  console.log(`${file}  ${code.length} chars`);
  await page.close();
}

await browser.close();
