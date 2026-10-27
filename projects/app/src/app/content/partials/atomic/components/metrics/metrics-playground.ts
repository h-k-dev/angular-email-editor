import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { richTextExtensions } from '@h-k-dev/angular-email-editor';
import { EmailEditor } from '@h-k-dev/angular-email-editor/editor';
import { TextMetrics, createTextMetrics } from '@h-k-dev/angular-email-editor/metrics';

import { Playground, PlaygroundAction } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

const PARAGRAPH =
  'Metrics are pure arithmetic over cached glyph widths: no layout is read on a keystroke, and a block that did not change is never measured again.';

/**
 * The editor's metrics, live — words, characters, wrapped lines and the
 * estimated height — from `createTextMetrics` in the kit. Type, or drag the
 * stage narrower: the lines and the height follow the width (a resize
 * re-runs only the line arithmetic). The editor's measured height sits
 * beside the estimate in the value panel, to see how close it lands.
 */
@Component({
  selector: 'metrics-playground',
  imports: [EmailEditor, PlaygroundFrame],
  templateUrl: './metrics-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './metrics-playground.scss'],
  providers: [Playground],
})
export class MetricsPlayground {
  protected readonly playground = inject(Playground);

  protected readonly metrics = signal<TextMetrics | null>(null);
  protected readonly measured = signal<number | null>(null);

  /** The stage's editor — `[emailEditor]` on the stage, its kit and the
      text it starts with. */
  protected readonly kit = [
    ...richTextExtensions,
    createTextMetrics({
      onMetrics: (metrics) => {
        this.metrics.set(metrics);
        // The real height, read here for the comparison only — the
        // metrics themselves read no layout.
        // The editor fills its box, so the text's own height: from the
        // first block's top to the last one's bottom.
        const dom = this.editor()?.view.dom;
        const first = dom?.firstElementChild?.getBoundingClientRect();
        const last = dom?.lastElementChild?.getBoundingClientRect();
        this.measured.set(first && last ? Math.round(last.bottom - first.top) : null);
      },
      onError: (error) => this.playground.log('onError', String(error)),
    }),
  ];
  protected readonly content = `<p>${PARAGRAPH}</p><p>${PARAGRAPH}</p>`;
  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly stage = viewChild(EmailEditor);
  protected readonly editor = computed(() => this.stage()?.editor());

  protected readonly actions: readonly PlaygroundAction[] = [
    {
      name: 'add a paragraph',
      run: () => {
        const editor = this.editor();
        if (!editor) return;
        const { schema, doc } = editor.state;
        const paragraph = schema.nodes['paragraph'].create(null, schema.text(PARAGRAPH));
        editor.view.dispatch(editor.state.tr.insert(doc.content.size, paragraph));
      },
    },
    { name: 'log the metrics', run: () => this.playground.log('metrics', this.metrics()) },
  ];
}
