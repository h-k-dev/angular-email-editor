import {
  Component,
  ElementRef,

  // Signals
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

// Angular CDK
import { DomPortal } from '@angular/cdk/portal';

// Angular Material
import { MatIconAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

// Angular File Drop
import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';

// Angular Email Editor
import { InlineImages } from '@h-k-dev/angular-email-editor';

import { SourceView } from '../../partials/shared/email/email-compose/email-compose';
import { DropHint } from '../../partials/common/drop-hint/drop-hint';
import { HtmlEmailCompose } from '../../partials/shared/email/html-email-compose/html-email-compose';
import { KeepDraft } from '../../partials/shared/email/message-form/keep-draft';
import { Examples } from '../../../core/email/examples';
import { MessageForm } from '../../partials/shared/email/message-form/message-form';
import { MobileMessageForm } from '../../partials/shared/email/message-form/mobile-message-form';
import { MessageSheet } from '../../partials/shared/email/message-form/message-sheet';
import { PaperIslandDirective } from '../../partials/shared/email/paper-island';
import { BLANK, Envelope } from '../../../core/email/envelope';
import { Viewport } from '../../../core/layout/viewport';
import { I18n } from '../../../core/translations/i18n';

/** The page's new message: addressed already, so the page opens one
    keystroke from writing — the caret in the text, a friendly recipient in
    To (an example.com address, nobody's inbox). */
const WELCOME: Envelope = { ...BLANK, to: ['pride@example.com'] };

/**
 * The composer page, the app's front page: the one message this app keeps
 * as its draft, on the sheet every message is written on (`message-form`;
 * the phone's, `mobile-message-form`, where the page opens on a phone) —
 * laid out as a document, the zoomed compose window on the whole page — and
 * nothing beside it: its HTML source shows in the editor's place, and the
 * page itself is the zone an .eml is opened by.
 */
@Component({
  selector: 'app-compose',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslatePipe,

    // Angular Material
    MatIconAnchor,
    MatIcon,
    MatTooltip,

    // Components
    MessageForm,
    MobileMessageForm,
    KeepDraft,
    PaperIslandDirective,
    DropHint,
    HtmlEmailCompose,
    AngularFileDrop,
  ],
  // One inline image registry per composer — the sheet hands it to the
  // editor, an import feeds it. Never in root.
  providers: [InlineImages],
  templateUrl: './compose.html',
  styleUrl: './compose.scss',
})
export class Compose {
  /** The message's sheet — the desktop's or the phone's (`mobile`), read
      as either. Optional: the source pane after it in the page binds to it
      before it is created. */
  protected readonly sheet = viewChild(MessageSheet);

  /** What a new message on this page is (`WELCOME`): the one it opens on
      without a draft, and the one Send and Discard start over on. */
  protected readonly welcome = WELCOME;

  /** The sheet's draft keeper. */
  protected readonly draft = viewChild(KeepDraft);

  /** Canonical email HTML — the sheet's, which the source pane binds to. */
  protected readonly html = computed(() => this.sheet()?.html() ?? '');

  /** The source pane's edits: the message's HTML, and its original — the
      source as typed, before the editor reads it. */
  protected onSourceHtml(html: string): void {
    const sheet = this.sheet();
    sheet?.html.set(html);
    sheet?.original.set(html);
  }

  protected readonly viewport = inject(Viewport);

  /** Which sheet the page writes on: the phone's, where it opened on a
      phone — chosen once, as the page opens, and kept: a screen that turns
      or widens later never swaps the sheet (and its editor) mid-message. */
  protected readonly mobile = untracked(() => this.viewport.compact());

  readonly #examples = inject(Examples);

  /** Where the HTML source shows: in the editor's place (code view, the
      settings' View) or nowhere — the page docks nothing beside the sheet.
      Owned here because revealing a finding has to switch to a view that
      can show it. */
  protected sourceView = signal<SourceView>('hidden');

  /** The source pane's element, for the code-view portal. */
  protected sourceEl = viewChild.required('sourceEl', { read: ElementRef });

  /** In code view the source pane's own DOM node moves into the composer's
      editing surface (a DomPortal: attached, the node moves in; detached, it
      returns to the page, hidden). The editor inside is never re-created. */
  protected codePortal = computed(() =>
    this.sourceView() === 'code' ? new DomPortal(this.sourceEl()) : null,
  );

  constructor() {
    // An example loaded whole is the message's original from then on: the
    // file's HTML, kept with the message (and its draft).
    effect(() => {
      const html = this.#examples.loaded();
      if (html) untracked(() => this.sheet()?.original.set(html));
    });
  }
  protected sourcePane = viewChild.required(HtmlEmailCompose);

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
