import { createEditor, Editor } from '../editor';
import { emailPlainText } from '../plain-text';
import { emailExtensions } from './kits';
import { SendIntent, createSendIntent } from './send-intent';

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
    const items = factory.slashItems!({ schema: editor.schema, extensions: [] });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Send');
    // The slash menu deletes the "/send" text before running the command; the
    // command serializes the state it is *given*, so the payload stays clean.
    items[0].command(editor.state, editor.view.dispatch, editor.view);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain('/send');
  });
});
