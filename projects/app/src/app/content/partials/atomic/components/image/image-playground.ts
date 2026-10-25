import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { richTextExtensions, selectedImage, selectedImageAlt } from '@h-k-dev/angular-email-editor';
import { editorState } from '@h-k-dev/angular-email-editor/actions';
import { ImageAlt } from '@h-k-dev/angular-email-editor/image';
import { NodeSelection } from 'prosemirror-state';

import { Playground, PlaygroundAction, knob, playgroundEditor } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** A picture with no file behind it: a gradient, drawn here. */
const PICTURE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96" viewBox="0 0 160 96"><defs><linearGradient id="g" x2="1" y2="1">' +
      '<stop stop-color="#8C1D40"/><stop offset="1" stop-color="#F2B8B5"/></linearGradient></defs>' +
      '<rect width="160" height="96" rx="8" fill="url(#g)"/></svg>',
  );

const CONTENT =
  `<p>Click the picture to select it, then write its alt text.</p>` +
  `<p><img src="${PICTURE}" alt="A berry gradient" width="160"></p>` +
  `<p>Enter applies, Escape puts it back.</p>`;

/**
 * The alt field as a host builds it: its own `<input>` made the selected
 * image's alt by `[emailImageAlt]`. As a popover (the composer's) it shows
 * while an image is selected, focused with its text selected; as a panel
 * (a side bar's) it is always there and waits. The value panel is the
 * field's draft beside the document's alt.
 */
@Component({
  selector: 'image-playground',
  imports: [PlaygroundFrame, ImageAlt, MatButton],
  templateUrl: './image-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './image-playground.scss'],
  providers: [Playground],
})
export class ImagePlayground {
  protected readonly playground = inject(Playground);

  readonly mode = signal<'popover' | 'panel'>('popover');
  readonly returnFocus = signal(true);

  protected readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  protected readonly editor = playgroundEditor(this.host, {
    extensions: richTextExtensions,
    content: CONTENT,
  });
  readonly #state = editorState(() => this.editor());

  /** Whether an image is selected — the popover's cue. */
  protected readonly selected = computed(() => {
    const state = this.#state();
    return !!state && !!selectedImage(state);
  });

  protected readonly field = viewChild<ImageAlt>('alt');

  protected readonly state = computed(() => {
    const state = this.#state();
    const field = this.field();
    return {
      selected: this.selected(),
      documentAlt: state ? selectedImageAlt(state) : null,
      active: field?.active() ?? false,
      draft: field?.value() ?? null,
    };
  });

  protected readonly knobs = [
    knob.choice('mode', this.mode, ['popover', 'panel']),
    knob.boolean('emailImageAltFocus', this.returnFocus),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'select the image', run: () => this.#selectImage() },
    { name: 'alt.apply()', run: () => this.playground.log('apply()', this.field()?.apply()) },
    { name: 'alt.cancel()', run: () => this.field()?.cancel() },
  ];

  #selectImage(): void {
    const editor = this.editor();
    if (!editor) return;
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === 'image') at = pos;
      return at < 0;
    });
    if (at < 0) return;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)));
    editor.focus();
  }
}
