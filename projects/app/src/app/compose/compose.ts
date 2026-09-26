import {
  Component,
  ElementRef,
  Injector,

  // Signals
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';

// Angular CDK
import { DomPortal } from '@angular/cdk/portal';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Angular File Drop
import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import { HtmlDiagnostic, InlineImages, emailSizeBudget } from 'angular-email-editor';

import { SourceView } from './email-compose/email-compose';
import { releaseEditingSurface } from './is-typing';
import { DropHint } from './drop-hint/drop-hint';
import { HtmlEmailCompose } from './html-email-compose/html-email-compose';
import { EmailPreview } from './email-preview/email-preview';
import { KeepDraft } from './message-form/keep-draft';
import { MessageForm } from './message-form/message-form';
import { Viewport } from '../../services/viewport';

/** A status-strip note and the document it is about. */
interface StatusNote {
  text: string;
  html: string;
}

/**
 * The composer page: the one message this app keeps as its draft, on the
 * sheet every message is written on (`message-form`), with the desk around
 * it — the preview docked to its left, the HTML source to its right or in
 * the editor's place, the status strip under all three, and the page itself
 * as the zone an .eml is opened by.
 */
@Component({
  selector: 'app-compose',
  imports: [
    // Angular CDK

    // Components
    MessageForm,
    KeepDraft,
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
  /** The message's sheet. */
  protected readonly sheet = viewChild.required(MessageForm);

  /** Canonical email HTML — the sheet's, which the panes bind to. */
  protected readonly html = computed(() => this.sheet().html());

  /** Lint results streamed up from the source pane's language service. */
  protected diagnostics = signal<HtmlDiagnostic[]>([]);

  /** Below the docking breakpoint the composer shows one pane at a time: the
      dock toggles leave the writer bar, and a pane already docked beside the
      editor collapses. Code view is in place, so it stays — down to a
      phone's width, where the bar has no </> and code view folds too.
      The two pane signals below are linked to the breakpoints for it: state
      that resets when its source changes, not an effect writing into a
      signal. */
  protected readonly viewport = inject(Viewport);

  /** Where the HTML source shows (the writer bar's </> and detach
      buttons). Owned here because revealing a finding has to
      switch to a view that can show it. Going narrow folds a detached pane
      back to hidden, going compact folds code view as well — neither has a
      button left to leave it by; going wide again leaves whatever the user
      has. */
  protected sourceView = linkedSignal({
    source: () => ({ narrow: this.viewport.narrow(), compact: this.viewport.compact() }),
    computation: ({ narrow, compact }, previous): SourceView => {
      const view = previous?.value ?? 'hidden';
      if (narrow && view === 'detached') return 'hidden';
      if (compact && view === 'code') return 'hidden';
      return view;
    },
  });

  /** Whether the preview pane shows, docked to the left (the writer bar's
      preview button). Hidden by default, like the source, and closed by the
      breakpoint going narrow. */
  protected previewOpen = linkedSignal({
    source: this.viewport.narrow,
    computation: (narrow, previous): boolean => !narrow && (previous?.value ?? false),
  });

  /** The writer bar's </>: the source in the editor's place, or gone. From
      the docked view it moves the source in. */
  protected toggleCodeView(): void {
    releaseEditingSurface();
    this.sourceView.update((view) => (view === 'code' ? 'hidden' : 'code'));
  }

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

  readonly #injector = inject(Injector);
  protected sourcePane = viewChild.required(HtmlEmailCompose);

  /** Live word/line counter, measured mathematically by the email pane. */
  protected metrics = computed(() => this.sheet().metrics());

  /** Errors: the source pane's lint errors plus the body's expression
      syntax problems (the dialect the editor pane opts into). */
  protected errors = computed(
    () =>
      this.diagnostics().filter((d) => d.severity === 'error').length +
      this.sheet().emailPane().expressionDiagnostics().length,
  );

  protected warnings = computed(
    () => this.diagnostics().filter((d) => d.severity === 'warning').length,
  );

  /** The canonical HTML measured against Gmail's 102 KB clipping limit. */
  protected size = computed(() => emailSizeBudget(this.html()));
  protected sizeLabel = computed(
    () =>
      `${(this.size().bytes / 1024).toFixed(1)} kB of ${Math.round(this.size().limit / 1024)} kB`,
  );

  /** The form's first complaint, for the status strip. */
  protected problem = computed(() => this.sheet().problem());

  /** Jumps to the first diagnostic of the given severity: the source pane
      for a lint finding, the editor pane for an expression problem. */
  protected reveal(severity: 'error' | 'warning'): void {
    const diagnostic = this.diagnostics().find((d) => d.severity === severity);
    if (diagnostic) {
      this.#inView(true, () => this.sourcePane().reveal(diagnostic));
      return;
    }
    const pane = this.sheet().emailPane();
    const expression = pane.expressionDiagnostics()[0];
    if (severity === 'error' && expression) {
      this.#inView(false, () => pane.revealExpression(expression));
    }
  }

  /** Runs `show` with the pane it needs on screen — the source (either
      view of it) or the editor — switching first when it is not, and only
      after the switch has rendered: selecting and focusing inside a hidden
      surface is a no-op. A hidden source opens in code view; a source
      standing in the editor's place steps aside for it. */
  #inView(source: boolean, show: () => void): void {
    const view = this.sourceView();
    const visible = source ? view !== 'hidden' : view !== 'code';
    if (visible) {
      show();
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.sourceView.set(source ? 'code' : 'hidden');
    // No phase: `show` selects and focuses inside ProseMirror, which reads
    // and writes the DOM in one go.
    afterNextRender(show, { injector: this.#injector });
  }

  /** A status note describes *one* document: it is stamped with the html it
      was made for and shown only while that is still the document — a note
      outliving its document ("1 inline image as cid: part" after the image
      was deleted) is a status desync. */
  readonly #importNote = signal<StatusNote | null>(null);
  protected importNote = computed(() => this.#current(this.#importNote()));

  #current(note: StatusNote | null): string | null {
    return note && note.html === this.html() ? note.text : null;
  }

  /** The page's gesture, one zone out from the message: an .eml dropped
      anywhere but on the sheet opens as the message. On the sheet it is an
      attachment instead — the sheet's own zone. */
  protected async onEmlDrop(event: FileDropEvent): Promise<void> {
    const dropped = event.files[0]?.file;
    if (!dropped) return;
    const text = await this.sheet().importEml(dropped);
    this.#importNote.set({ text, html: this.html() });
  }

  /** What the transport accepted, for the footer: the receipt, and what a
      real host would have handed its mailer — envelope and body alike. A
      send clears the sheet, so the note stays until the next message is
      under way. */
  protected readonly sentNote = signal<string | null>(null);
  protected lastSend = computed(() => {
    const note = this.sentNote();
    return note && this.sheet().blank() ? note : null;
  });
}
