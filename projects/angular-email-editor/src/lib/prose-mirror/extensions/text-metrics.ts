import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { TextMetrics, createBlockMeasureCache, measureDoc, readTypography } from '../measurement';

export type { TextMetrics } from '../measurement';

export interface TextMetricsOptions {
  /** Called with fresh metrics after every doc change and width resize. */
  onMetrics: (metrics: TextMetrics) => void;
}

/**
 * Live document metrics (words, lines, estimated height) computed with
 * `@chenglou/pretext` — pure arithmetic over cached glyph widths, no DOM
 * measurement on the keystroke path. Unchanged blocks are never re-measured:
 * the cache keys on ProseMirror's immutable nodes.
 */
export const createTextMetrics = (options: TextMetricsOptions): FunctionalExtension =>
  defineExtension({
    name: 'textMetrics',
    plugins: () => [
      new Plugin({
        key: new PluginKey('textMetrics'),
        view: (view) => createTextMetricsView(view, options),
      }),
    ],
  });

function createTextMetricsView(view: EditorView, { onMetrics }: TextMetricsOptions) {
  let typography = readTypography(view.dom);
  let cache = createBlockMeasureCache();
  // One startup read; afterwards the observer reports widths, so resizes
  // and keystrokes alike never force a layout reflow.
  let width = view.dom.clientWidth;
  let destroyed = false;

  const measure = (currentView: EditorView = view) => {
    onMetrics(measureDoc(currentView.state.doc, width, typography, cache));
  };

  const observer = new ResizeObserver((entries) => {
    const next = entries[entries.length - 1].contentRect.width;
    if (next === width || next === 0) return;
    width = next;
    // Prepared glyph widths survive a resize; only the line arithmetic reruns.
    measure();
  });
  observer.observe(view.dom);

  // Canvas measurements taken before webfonts finish loading are off;
  // re-prepare everything once the real fonts are in.
  document.fonts?.ready.then(() => {
    if (destroyed) return;
    typography = readTypography(view.dom);
    cache = createBlockMeasureCache();
    measure();
  });

  measure();

  return {
    update(currentView: EditorView, prevState?: EditorState) {
      if (prevState && prevState.doc.eq(currentView.state.doc)) return;
      measure(currentView);
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
    },
  };
}
