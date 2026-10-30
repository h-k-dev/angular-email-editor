import { Directive, ElementRef, inject, output, signal } from '@angular/core';

import { looksLikeRawMessage } from '../../../../core/email/mailbox/raw-message';

/** A file that is a whole message: by its name, or by its type. */
const isMessageFile = (file: File): boolean =>
  /\.eml$/i.test(file.name) || file.type === 'message/rfc822';

/** Where a paste goes into a field of its own: not ours to take. */
const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches('input, textarea, select'));

/**
 * Whole messages brought in by hand, two ways, one output: an `.eml`
 * dropped on the host, or one pasted anywhere on the page — the file
 * itself, or its raw text (Gmail's "Show original", Ctrl+V). The paste is
 * the page's, not the host's: a list row or nothing at all may have the
 * focus. A paste into a field, or one somebody else took first, is left
 * alone; so is text that is not a message (`looksLikeRawMessage`).
 *
 *     <div messageImport #drop="messageImport" (messageImport)="open($event)">
 *
 * `dragging` says while a file hangs over the host — for a drop hint.
 */
@Directive({
  selector: '[messageImport]',
  exportAs: 'messageImport',
  host: {
    '(dragenter)': 'over($event)',
    '(dragover)': 'over($event)',
    '(dragleave)': 'leave($event)',
    '(drop)': 'drop($event)',
    '(document:paste)': 'paste($event)',
  },
})
export class MessageImport {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** A message brought in: a dropped or pasted `.eml`, or pasted raw text
      as one. */
  readonly messageImport = output<File>();

  /** A file hangs over the host. */
  readonly dragging = signal(false);

  protected over(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragging.set(true);
  }

  protected leave(event: DragEvent): void {
    if (event.relatedTarget instanceof Node && this.#host.contains(event.relatedTarget)) return;
    this.dragging.set(false);
  }

  protected drop(event: DragEvent): void {
    this.dragging.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    files.filter(isMessageFile).forEach((file) => this.messageImport.emit(file));
  }

  protected paste(event: ClipboardEvent): void {
    if (event.defaultPrevented || isEditable(event.target) || !event.clipboardData) return;
    const files = [...event.clipboardData.files].filter(isMessageFile);
    if (files.length) {
      event.preventDefault();
      files.forEach((file) => this.messageImport.emit(file));
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    if (!looksLikeRawMessage(text)) return;
    event.preventDefault();
    this.messageImport.emit(new File([text], 'Pasted message.eml', { type: 'message/rfc822' }));
  }
}
