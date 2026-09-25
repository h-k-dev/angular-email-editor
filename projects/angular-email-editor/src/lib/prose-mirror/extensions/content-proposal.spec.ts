import { TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import { Editor, createEditor } from '../editor';
import { ContentStreamWriter, createContentStream, isStreaming } from './content-stream';
import {
  ContentProposalState,
  acceptProposal,
  createContentProposal,
  discardProposal,
  isProposing,
  proposalRange,
  proposeContent,
} from './content-proposal';
import { richTextExtensions } from './kits';

describe('createContentProposal / proposeContent', () => {
  let host: HTMLElement;
  let editor: Editor;
  let changes: ContentProposalState[];

  const html = () => editor.getHTML();
  /** The kit's canonical form of an HTML — what `getHTML` makes of it. */
  const canon = (content: string) => {
    const other = createEditor({ parent: host, extensions: richTextExtensions, content });
    const out = other.getHTML();
    other.destroy();
    return out;
  };
  const end = () => editor.state.doc.content.size - 1;
  const proposed = () => editor.view.dom.querySelectorAll('.aee-proposal').length;
  const ORIGINAL = '<p>We met last week.</p>';

  /** A proposal the spec drives by hand. */
  const open = (target: Parameters<typeof proposeContent>[1] = end()) => {
    let writer!: ContentStreamWriter;
    let finish!: () => void;
    const run = proposeContent(
      editor.view,
      target,
      (given) => {
        writer = given;
        return new Promise<void>((resolve) => (finish = resolve));
      },
      { format: 'html' },
    );
    return { run, writer, finish: () => finish() };
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    changes = [];
    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createContentStream({ reveal: 'instant' }),
        createContentProposal({ onChange: (state) => changes.push(state) }),
      ],
      content: ORIGINAL,
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end())),
    );
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('needs the extension', () => {
    const bare = createEditor({
      parent: host,
      extensions: [...richTextExtensions, createContentStream()],
    });
    expect(() => proposeContent(bare.view, 1, () => undefined)).toThrow(/createContentProposal/);
    bare.destroy();
  });

  it('writes into the text, marked, and says so — the range following the stream exactly', async () => {
    const { writer, finish, run } = open();
    expect(isProposing(editor.state)).toBe(true);
    expect(changes.at(-1)).toEqual({ range: { from: end(), to: end() }, streaming: true });
    writer.write(' Bitte');
    writer.write(' <strong>lesen Sie</strong> das.');
    expect(html()).toBe(
      canon(
        '<p>We met last week. Bitte <strong style="font-weight: bold;">lesen Sie</strong> das.</p>',
      ),
    );
    expect(proposed()).toBeGreaterThan(0);
    expect(proposalRange(editor.state)).toEqual({ from: 18, to: end() });
    finish();
    expect(await run.done).toBe(true);
    // Written, still proposed: the stream is over, the decision is not.
    expect(isStreaming(editor.state)).toBe(false);
    expect(isProposing(editor.state)).toBe(true);
    expect(changes.at(-1)).toEqual({ range: { from: 18, to: end() }, streaming: false });
  });

  it('stays out of the history: what was typed before undoes as before, the proposal untouched', () => {
    editor.view.dispatch(editor.state.tr.insertText(' Typed.', end()));
    const typed = html();
    const { writer } = open();
    writer.write(' Proposed.');
    expect(html()).toContain('Typed. Proposed.');
    expect(editor.exec(undo)).toBe(true);
    // The typing went; the proposal — remapped — is still there.
    expect(html()).toBe(canon('<p>We met last week. Proposed.</p>'));
    expect(isProposing(editor.state)).toBe(true);
    expect(typed).toContain('Typed.');
  });

  it('accept: the same text, the writer’s own now — one change, one undo', async () => {
    const { writer, finish, run } = open();
    writer.write(' Bitte');
    writer.write(' lesen.');
    finish();
    await run.done;
    expect(acceptProposal(editor.view)).toBe(true);
    expect(isProposing(editor.state)).toBe(false);
    expect(proposed()).toBe(0);
    expect(html()).toBe(canon('<p>We met last week. Bitte lesen.</p>'));
    expect(editor.state.selection.from).toBe(end());
    expect(editor.exec(undo)).toBe(true);
    expect(html()).toBe(canon(ORIGINAL));
    expect(changes.at(-1)).toEqual({ range: null, streaming: false });
  });

  it('accept mid-stream: what has come stays, the rest does not', () => {
    const { writer } = open();
    writer.write(' Bitte');
    expect(acceptProposal(editor.view)).toBe(true);
    expect(isStreaming(editor.state)).toBe(false);
    writer.write(' lesen.');
    expect(html()).toBe(canon('<p>We met last week. Bitte</p>'));
  });

  it('discard: as if never written — the document, its history, the caret', () => {
    const { writer } = open();
    writer.write(' Bitte lesen.');
    expect(discardProposal(editor.view)).toBe(true);
    expect(html()).toBe(canon(ORIGINAL));
    expect(isProposing(editor.state)).toBe(false);
    expect(isStreaming(editor.state)).toBe(false);
    expect(undo(editor.state)).toBe(false);
    expect(editor.state.selection.from).toBe(end());
    expect(discardProposal(editor.view)).toBe(false);
    expect(acceptProposal(editor.view)).toBe(false);
  });

  it('a second proposal takes the first’s place', () => {
    const first = open();
    first.writer.write(' One.');
    const second = open();
    second.writer.write(' Two.');
    expect(html()).toBe(canon('<p>We met last week. Two.</p>'));
    expect(proposalRange(editor.state)).toEqual({ from: 18, to: end() });
  });

  it('a whole email on an empty line: blocks as blocks, then accepted whole', async () => {
    editor.setContent('<p></p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const { writer, finish, run } = open(1);
    writer.write('<p>Hallo,</p><ul><li>eins</li>');
    writer.write('<li>zwei</li></ul>');
    finish();
    await run.done;
    expect(proposed()).toBeGreaterThan(0);
    acceptProposal(editor.view);
    expect(html()).toBe(canon('<p>Hallo,</p><ul><li><p>eins</p></li><li><p>zwei</p></li></ul>'));
    expect(editor.exec(undo)).toBe(true);
    expect(html()).toBe(canon('<p></p>'));
  });

  it('the editor going away stops the writing', () => {
    const { writer } = open();
    writer.write(' Bitte');
    let aborted = false;
    writer.signal.addEventListener('abort', () => (aborted = true));
    editor.destroy();
    expect(aborted).toBe(true);
    editor = createEditor({ parent: host, extensions: richTextExtensions });
  });
});
