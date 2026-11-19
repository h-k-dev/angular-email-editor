import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import {
  GUIDES_ACTIVE_CLASS,
  GUIDES_PEEK_CLASS,
  GUIDES_PEEK_DELAY_MS,
  guidesPeekKey,
} from './layout-guides';

describe('layout guides', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>intro</div>',
    });
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
      );
      return true;
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('marks the table the cursor is in', () => {
    editor.commands['insertTable']();
    // The class lands on the table's NodeView root (the `ColumnResize`
    // wrapper), which is the block's DOM as far as decorations go.
    const active = editor.view.dom.querySelector(`.${GUIDES_ACTIVE_CLASS}`);
    expect(active).not.toBeNull();
    expect(active!.querySelector('table')).not.toBeNull();
  });

  it('marks the columns block the cursor is in — the same class, one mechanism', () => {
    editor.commands['insertColumns'](2);
    // The class lands on the block's NodeView wrapper (the `ColumnsResize`
    // extension), which contains the `.aee-columns` container.
    const active = editor.view.dom.querySelector(`.${GUIDES_ACTIVE_CLASS}`);
    expect(active).not.toBeNull();
    expect(active!.querySelector('.aee-columns')).not.toBeNull();
  });

  it('marks nothing while the cursor is in ordinary text', () => {
    expect(editor.view.dom.querySelector(`.${GUIDES_ACTIVE_CLASS}`)).toBeNull();
  });

  it('renders the editor-only CSS hooks in the view', () => {
    editor.commands['insertColumns'](2);
    expect(editor.view.dom.querySelector('.aee-columns')).not.toBeNull();
    expect(editor.view.dom.querySelectorAll('.aee-column').length).toBe(2);
  });

  it('never leaks the editor-only hooks into the email — only the layout markers', () => {
    editor.commands['insertColumns'](2);
    const html = editor.getHTML();
    // emitDOM drops the editor's classes: the email is inline-block divs
    // carrying their marker (layout-marker.ts) and nothing else of ours.
    expect(html.match(/aee-[\w-]+/g)?.every((name) => name.startsWith('aee-layout-'))).toBe(true);
    expect(html).not.toContain('aee-columns');
    expect(html).not.toContain('class="aee-column ');
    expect(html).toContain('display: inline-block');
  });
});

describe('layout guides — the peek key', () => {
  let host: HTMLElement;
  let editor: Editor;

  /** An editor made on `platform` — the key is read as the editor is made. */
  const on = (platform: string) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: '<div>a</div>' });
  };
  const key = (type: 'keydown' | 'keyup', name: string) =>
    document.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true }));
  const hold = (name: string) => {
    key('keydown', name);
    vi.advanceTimersByTime(GUIDES_PEEK_DELAY_MS + 1);
  };
  const peeking = () => editor.view.dom.classList.contains(GUIDES_PEEK_CLASS);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    editor.destroy();
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is ⌘ on a Mac — Ctrl held there shows nothing', () => {
    on('MacIntel');
    expect(guidesPeekKey()).toBe('Meta');

    hold('Control');
    expect(peeking()).toBe(false);
    key('keyup', 'Control');

    hold('Meta');
    expect(peeking()).toBe(true);
    key('keyup', 'Meta');
    expect(peeking()).toBe(false);
  });

  it('is Ctrl everywhere else — the Windows key shows nothing', () => {
    on('Win32');
    expect(guidesPeekKey()).toBe('Control');

    hold('Meta');
    expect(peeking()).toBe(false);
    key('keyup', 'Meta');

    hold('Control');
    expect(peeking()).toBe(true);
    key('keyup', 'Control');
    expect(peeking()).toBe(false);
  });

  it('is no peek when it starts a shortcut: ⌘-B within the delay', () => {
    on('MacIntel');
    key('keydown', 'Meta');
    key('keydown', 'b');
    vi.advanceTimersByTime(GUIDES_PEEK_DELAY_MS + 1);
    expect(peeking()).toBe(false);
  });
});
