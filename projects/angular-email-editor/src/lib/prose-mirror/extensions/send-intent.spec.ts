import { createEditor, Editor } from '../editor';
import { emailPlainText } from '../plain-text';
import { emailExtensions } from './kits';
import { SendIntent, createSendIntent } from './send-intent';
import { FOLD_WIDTH } from '../fold';

describe('send intent', () => {
  let host: HTMLElement;
  let editor: Editor;
  let sent: SendIntent[];

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    sent = [];
    editor = createEditor({
      parent: host,
      extensions: [...emailExtensions, createSendIntent({ onSend: (intent) => sent.push(intent) })],
      content: '<div>Hello <strong style="font-weight: bold;">world</strong></div>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('requestSend emits the canonical HTML plus its text/plain projection', () => {
    expect(editor.commands['requestSend']()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toBe(editor.getHTML());
    expect(sent[0].text).toBe(emailPlainText(sent[0].html));
    expect(sent[0].text).toBe('Hello world');
  });

  it('folds its HTML for any transport: no line over the width, the same email to every parser', () => {
    const cells = Array.from(
      { length: 60 },
      (_, i) =>
        `<td style="padding: 10px 25px; font-size: 14px; color: rgb(85, 87, 93);">Zelle ${i} — Grüße</td>`,
    ).join('');
    editor.setContent(`<table><tbody><tr>${cells}</tr></tbody></table><div>after</div>`);
    const unfolded = editor.getHTML();
    expect(Math.max(...unfolded.split('\n').map((l) => l.length))).toBeGreaterThan(FOLD_WIDTH);

    editor.commands['requestSend']();
    const { html, text } = sent[0];
    const octets = (line: string) => new TextEncoder().encode(line).length;
    expect(Math.max(...html.split('\n').map(octets))).toBeLessThanOrEqual(FOLD_WIDTH);
    expect(html).not.toBe(unfolded);
    // Only spaces inside tags became breaks: the editor reads the same email,
    // and so does a browser.
    expect(html.replace(/\n/g, ' ')).toBe(unfolded.replace(/\n/g, ' '));
    editor.setContent(html);
    expect(editor.getHTML()).toBe(unfolded);
    const dom = (markup: string) => new DOMParser().parseFromString(markup, 'text/html').body.innerHTML;
    expect(dom(html)).toBe(dom(unfolded));
    expect(text).toBe(emailPlainText(unfolded));
  });

  it('reports the fields the body requires', () => {
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('Hi {{ customer_name }}: {{ cf_70 | formatPrice }} '));
      return true;
    });
    // Promotion is a parse-time repair; simulate the round trip a real
    // document has been through before a send.
    editor.setContent(editor.getHTML());
    editor.commands['requestSend']();
    expect(sent[0].requiredFields).toEqual(['customer_name', 'cf_70']);
  });

  it('promotes data-URL images to cid: parts in the payload, never in the document', () => {
    const dataUrl = 'data:image/png;base64,aGk=';
    editor.setContent(`<div>see</div><img src="${dataUrl}" alt="chart">`);
    editor.commands['requestSend']();

    expect(sent[0].html).toContain('src="cid:image-1@aee"');
    expect(sent[0].html).not.toContain('data:');
    expect(sent[0].text).toBe('see\n[chart]');
    expect(sent[0].inlineImages).toHaveLength(1);
    expect(sent[0].inlineImages[0].cid).toBe('image-1@aee');
    expect(sent[0].inlineImages[0].blob?.type).toBe('image/png');
    expect(sent[0].inlineImages[0].blob?.size).toBe(2);
    // The editor keeps its data URL: the promotion is a payload projection.
    expect(editor.getHTML()).toContain(dataUrl);
  });

  it('reports pre-existing cid: references without bytes — the host owns those parts', () => {
    editor.setContent('<img src="cid:part1@mail" alt="logo">');
    editor.commands['requestSend']();
    expect(sent[0].html).toBe(editor.getHTML());
    expect(sent[0].inlineImages).toEqual([{ cid: 'part1@mail', blob: null }]);
  });

  it('reports no inline images for a plain body', () => {
    editor.commands['requestSend']();
    expect(sent[0].inlineImages).toEqual([]);
  });

  it("Mod-Enter is the keyboard path — Gmail's send shortcut", () => {
    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true })),
    );
    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toBe(editor.getHTML());
  });

  it('emits nothing on a probing call (no dispatch) — menus can test enablement safely', () => {
    const factory = createSendIntent({ onSend: (intent) => sent.push(intent) });
    const command = factory.commands!({ schema: editor.schema, extensions: [] })['requestSend']();
    expect(command(editor.state, undefined)).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('exposes a /send slash item whose payload never contains the query text', () => {
    const factory = createSendIntent({ onSend: (intent) => sent.push(intent) });
    const items = factory.actions!({ schema: editor.schema, extensions: [] });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Send');
    // The slash menu deletes the "/send" text before running the command; the
    // command serializes the state it is *given*, so the payload stays clean.
    items[0].command!(editor.state, editor.view.dispatch, editor.view);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain('/send');
  });
});
