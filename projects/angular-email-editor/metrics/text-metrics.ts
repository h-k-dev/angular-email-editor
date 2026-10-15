import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from 'angular-email-editor';
import { TextMetrics, createBlockMeasureCache, measureDoc, readTypography } from './measurement';

export interface TextMetricsOptions {
  /** Called with fresh metrics after every doc change and width resize. */
  onMetrics: (metrics: TextMetrics) => void;
  /** Called when a measurement fails — no canvas to measure with (a server
      render, jsdom), or a font the browser cannot use. The editor goes on
      unharmed; that measurement reports nothing, and the next change, or
      the web fonts arriving, tries again. */
  onError?: (error: unknown) => void;
}

/**
 * Live document metrics (words, lines, estimated height) computed with
 * `@chenglou/pretext` — pure arithmetic over cached glyph widths, no DOM
 * measurement on the keystroke path. Unchanged blocks are never re-measured:
 * the cache keys on ProseMirror's immutable nodes.
 *
 * Metrics are an extra, never a dependency of the editor: a measurement
 * that throws is reported through `onError` and skipped, and without a
 * `ResizeObserver` the width read at mount stands.
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

function createTextMetricsView(view: EditorView, { onMetrics, onError }: TextMetricsOptions) {
  let typography = readTypography(view.dom);
  let cache = createBlockMeasureCache();
  // One startup read; afterwards the observer reports widths, so resizes
  // and keystrokes alike never force a layout reflow.
  let width = view.dom.clientWidth;
  let destroyed = false;

  const measure = (currentView: EditorView = view) => {
    let metrics: TextMetrics;
    try {
      metrics = measureDoc(currentView.state.doc, width, typography, cache);
    } catch (error) {
      onError?.(error);
      return;
    }
    onMetrics(metrics);
  };

  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          const next = entries[entries.length - 1].contentRect.width;
          if (next === width || next === 0) return;
          width = next;
          // Prepared glyph widths survive a resize; only the line arithmetic reruns.
          measure();
        });
  observer?.observe(view.dom);

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
      observer?.disconnect();
    },
  };
}
