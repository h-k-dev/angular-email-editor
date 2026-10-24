import {
  Component,
  ElementRef,

  // Signals
  computed,
  effect,
  inject,
  linkedSignal,
  untracked,
  viewChild,
} from '@angular/core';

// Angular CDK
import { DomPortal } from '@angular/cdk/portal';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

// Angular File Drop
import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import { InlineImages, withQuotedHistory } from '@h-k-dev/angular-email-editor';

import { SourceView } from './email-compose/email-compose';
import { releaseEditingSurface } from './is-typing';
import { DropHint } from './drop-hint/drop-hint';
import { HtmlEmailCompose } from './html-email-compose/html-email-compose';
import { EmailPreview } from './email-preview/email-preview';
import { KeepDraft } from './message-form/keep-draft';
import { Examples } from '../../services/examples';
import { MessageForm } from './message-form/message-form';
import { MobileMessageForm } from './message-form/mobile-message-form';
import { MessageSheet } from './message-form/message-sheet';
import { PaperIslandDirective } from './paper-island';
import { Viewport } from '../../services/viewport';
import { I18n } from '../../services/i18n';

/**
 * The composer page, the app's front page: the one message this app keeps
 * as its draft, on the sheet every message is written on (`message-form`;
 * the phone's, `mobile-message-form`, where the page opens on a phone) —
 * laid out as a document, the zoomed compose window on the whole page — with
 * the desk around it: the preview docked to its left, the HTML source to its
 * right or in the editor's place, and the page itself as the zone an .eml is
 * opened by.
 */
@Component({
  selector: 'app-compose',
  imports: [
    // Angular CDK

    // Components
    MessageForm,
    MobileMessageForm,
    KeepDraft,
    PaperIslandDirective,
    MatIcon,
    MatIconButton,
    DropHint,
    HtmlEmailCompose,
    EmailPreview,
    AngularFileDrop,
  ],
  // One inline image registry per composer — the sheet hands it to the
  // editor, the preview resolves from it, an import feeds it. Never in root.
  providers: [InlineImages],
  templateUrl: './compose.html',
  styleUrl: './compose.scss',
  host: {
    '[class.compose--detached]': "sourceView() === 'detached'",
    '[class.compose--preview]': 'previewOpen()',
    '[class.compose--compact]': 'viewport.compact()',
  },
})
export class Compose {
  /** The message's sheet — the desktop's or the phone's (`mobile`), read
      as either. Optional: the panes ahead of it in the page bind to it
      before it is created. */
  protected readonly sheet = viewChild(MessageSheet);

  /** The sheet's draft keeper. */
  protected readonly draft = viewChild(KeepDraft);

  /** The paper the sheet is on (its Appearance), for chrome the page's
      host lays over it to stand on the same paper — the landing's bar. */
  readonly scheme = computed(() => this.sheet()?.editorScheme() ?? null);

  /** Canonical email HTML — the sheet's, which the panes bind to. */
  protected readonly html = computed(() => this.sheet()?.html() ?? '');

  /** The source pane's edits: the message's HTML, and its original — the
      source as typed, before the editor reads it. */
  protected onSourceHtml(html: string): void {
    const sheet = this.sheet();
    sheet?.html.set(html);
    sheet?.original.set(html);
  }

  /** Below the docking breakpoint the composer shows one pane at a time: the
      dock toggles leave the writer bar, and a pane already docked beside the
      editor collapses. Code view is in place, so it stays — down to a
      phone's width, where the bar has no </> and code view folds too.
      The two pane signals below are linked to the breakpoints for it: state
      that resets when its source changes, not an effect writing into a
      signal. */
  protected readonly viewport = inject(Viewport);

  /** Which sheet the page writes on: the phone's, where it opened on a
      phone — chosen once, as the page opens, and kept: a screen that turns
      or widens later never swaps the sheet (and its editor) mid-message. */
  protected readonly mobile = untracked(() => this.viewport.compact());

  readonly #examples = inject(Examples);

  /** Where the HTML source shows (the writer bar's </> and detach
      buttons). Owned here because revealing a finding has to
      switch to a view that can show it. Going narrow folds a detached pane
      back to hidden — it has no button left to leave it by; going wide
      again leaves whatever the user has. */
  protected sourceView = linkedSignal({
    source: this.viewport.narrow,
    computation: (narrow, previous): SourceView => {
      const view = previous?.value ?? 'hidden';
      return narrow && view === 'detached' ? 'hidden' : view;
    },
  });

  /** Whether the preview pane shows, docked to the left (the writer bar's
      preview button). Hidden by default, like the source, and closed by the
      breakpoint going narrow. */
  protected previewOpen = linkedSignal({
    source: this.viewport.narrow,
    computation: (narrow, previous): boolean => !narrow && (previous?.value ?? false),
  });

  /** The writer bar's detach button: the source beside the editor, or gone.
      From code view it moves the source out of the editor's place. */
  protected toggleDetached(): void {
    releaseEditingSurface();
    this.sourceView.update((view) => (view === 'detached' ? 'hidden' : 'detached'));
  }

  /** The source pane's element, for the code-view portal. */
  protected sourceEl = viewChild.required('sourceEl', { read: ElementRef });

  /** In code view the source pane's own DOM node moves into the composer's
      editing surface (a DomPortal: attached, the node moves in; detached, it
      returns to its column on the right). The editor inside is never
      re-created. */
  protected codePortal = computed(() =>
    this.sourceView() === 'code' ? new DomPortal(this.sourceEl()) : null,
  );

  constructor() {
    // An example loaded whole is the message's original from then on: the
    // file's HTML, for the preview to draw beside the editor's reading.
    effect(() => {
      const html = this.#examples.loaded();
      if (html) untracked(() => this.sheet()?.original.set(html));
    });
  }
  protected sourcePane = viewChild.required(HtmlEmailCompose);

  /** The message as it goes out, for the preview: the body with its quoted
      history under it. */
  protected previewHtml = computed(() =>
    withQuotedHistory(this.html(), this.sheet()?.quoted() ?? null),
  );

  readonly #snackBar = inject(MatSnackBar);
  readonly #i18n = inject(I18n);

  /** Says something in passing, the way a compose window says it sent. */
  #say(text: string): void {
    this.#snackBar.open(text, undefined, { duration: 4000 });
  }

  /** The page's gesture, one zone out from the message: an .eml dropped
      anywhere but on the sheet opens as the message. On the sheet it is an
      attachment instead — the sheet's own zone. */
  protected async onEmlDrop(event: FileDropEvent): Promise<void> {
    const dropped = event.files[0]?.file;
    if (!dropped) return;
    const sheet = this.sheet();
    if (!sheet) return;
    this.#say(await sheet.importEml(dropped));
  }

  /** The sheet sent its message — and cleared itself for the next one. */
  protected sent(): void {
    this.#say(this.#i18n.t('composeWindow.sent'));
  }
}
