/**
 * The placeholder preview as it is drawn — `npm run test:render`, in real
 * Chromium (jsdom lays nothing out: a hidden token and a shown value are
 * the same there).
 */
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import {
  MERGE_TAG_PREVIEWED_CLASS,
  MERGE_TAG_PREVIEW_CLASS,
  createMergeTagPreview,
} from './merge-tag-preview';

describe('merge tag preview (render)', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createMergeTagPreview({ resolve: async (expressions) => expressions.map(() => 'Müller') }),
      ],
      content: '<div>Sehr geehrte <strong>{{ customer_lastName }}</strong>, guten Tag.</div>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('shows the value and not the token — with no stylesheet of the host’s', async () => {
    editor.commands['previewMergeTags']();
    await new Promise((done) => setTimeout(done));

    const value = editor.view.dom.querySelector<HTMLElement>(`.${MERGE_TAG_PREVIEW_CLASS}`)!;
    const token = editor.view.dom.querySelector<HTMLElement>(`.${MERGE_TAG_PREVIEWED_CLASS}`)!;
    expect(value.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(getComputedStyle(value).fontWeight).toBe('700');
    expect(token.getClientRects()).toHaveLength(0);
    expect(editor.view.dom.innerText.trim()).toBe('Sehr geehrte Müller, guten Tag.');

    editor.commands['previewMergeTags']();
    expect(editor.view.dom.innerText.trim()).toBe(
      'Sehr geehrte {{ customer_lastName }}, guten Tag.',
    );
  });
});
