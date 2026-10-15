/**
 * Text metrics where nothing can measure — jsdom, like a server render, has
 * no canvas. The editor must not notice: it mounts, takes typing, and the
 * metrics only say why they are missing. Real measurement is the render
 * suite's (`text-metrics.render.spec.ts`, Chromium).
 */
import { createEditor, emailExtensions, Editor } from '@h-k-dev/angular-email-editor';
import { TextMetrics, createTextMetrics } from './public-api';

describe('text metrics without a canvas', () => {
  let host: HTMLElement;
  let editor: Editor | undefined;
  let metrics: TextMetrics[];
  let errors: unknown[];

  const mount = () =>
    createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createTextMetrics({
          onMetrics: (m) => metrics.push(m),
          onError: (error) => errors.push(error),
        }),
      ],
      content: '<div>Hallo Welt</div>',
    });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    metrics = [];
    errors = [];
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it('leaves the editor unharmed: it mounts and takes typing; the metrics say why they are missing', () => {
    editor = mount();
    editor.view.dispatch(editor.state.tr.insertText(' und mehr', editor.state.doc.content.size - 1));
    expect(editor.getText()).toBe('Hallo Welt und mehr');
    expect(metrics).toEqual([]);
    // Once at mount, once for the change: every measurement tries again.
    expect(errors.length).toBe(2);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it('needs no ResizeObserver: without one, the width read at mount stands', () => {
    const observer = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    try {
      expect(() => (editor = mount())).not.toThrow();
      editor!.destroy();
      editor = undefined;
    } finally {
      if (observer) (globalThis as { ResizeObserver?: unknown }).ResizeObserver = observer;
    }
  });
});
