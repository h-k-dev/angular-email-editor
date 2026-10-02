import { DomPortal } from '@angular/cdk/portal';
import {
  Component,
  ElementRef,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Library
import {
  CLIENT_LABELS,
  InlineImages,
  RENDERING_CLIENTS,
  RenderingClient,
  renderForClient,
} from 'angular-email-editor';

import { EmailCompose, SourceView } from '../compose/email-compose/email-compose';
import { HtmlEmailCompose } from '../compose/html-email-compose/html-email-compose';
import { releaseEditingSurface } from '../compose/is-typing';
import { Examples } from '../../services/examples';
import { I18n } from '../../services/i18n';

/** Appended to the drawn original: the frame scrolls, without a bar. */
const NO_SCROLLBAR = '<style>html { scrollbar-width: none; }</style>';

/** One MJML example beside the replica the builder import makes of it. */
interface RenderPair {
  name: string;
  /** The compiled MJML, as the example file holds it. */
  original: string;
  /** Our own blocks: `examples/mjml-induce/`, the same file name. */
  replica: string;
}

/**
 * The render bench: each MJML example's replica in our editor on the left,
 * the original as a client draws it on the right — each in a 600px box, the
 * email's own width, their tops on one line, so the two read line for line.
 * The client (Apple Mail, Gmail, Outlook) and its light or dark surface are
 * chosen above both; the examples are stepped through on the far right.
 */
@Component({
  selector: 'app-render',
  imports: [EmailCompose, HtmlEmailCompose, MatIconButton, MatIcon],
  templateUrl: './render.html',
  styleUrl: './render.scss',
  providers: [InlineImages],
})
export class Render {
  readonly #examples = inject(Examples);
  readonly #sanitizer = inject(DomSanitizer);
  protected readonly i18n = inject(I18n);

  /** Every MJML example that has a replica, paired by file name, in the
      catalogue's order. */
  protected readonly pairs = computed<RenderPair[]>(() => {
    const documents = this.#examples.documents();
    const fileName = (file: string) => file.split('/').pop();
    const replicas = new Map(
      documents
        .filter((doc) => doc.set.key === 'mjml-induce')
        .map((doc) => [fileName(doc.entry.file), doc.html]),
    );
    return documents
      .filter((doc) => doc.set.key === 'mjml' && replicas.has(fileName(doc.entry.file)))
      .map((doc) => ({
        name: doc.entry.name.replace(/ \(compiled MJML[^)]*\)/, ''),
        original: doc.html,
        replica: replicas.get(fileName(doc.entry.file))!,
      }));
  });

  protected readonly index = signal(0);

  protected readonly pair = computed<RenderPair | undefined>(() => this.pairs()[this.index()]);

  /** The editor's text: the replica, until it is edited; the next example
      starts from its own. */
  protected readonly replica = linkedSignal(() => this.pair()?.replica ?? '');

  /** The left box as the editor reads the replica, or as its HTML — the
      source pane in the editor's place, as the composer's </> puts it. */
  protected readonly sourceView = signal<SourceView>('hidden');

  /** The source pane: its own node moves into the editor's box in HTML view
      (a DomPortal) and back — the editor inside it is never re-created, so
      its undo history carries across. */
  protected readonly sourceEl = viewChild('sourceEl', { read: ElementRef });
  protected readonly sourcePane = viewChild(HtmlEmailCompose);
  protected readonly codePortal = computed(() => {
    const el = this.sourceEl();
    return this.sourceView() === 'code' && el ? new DomPortal(el) : null;
  });

  protected showSource(code: boolean): void {
    releaseEditingSurface();
    this.sourceView.set(code ? 'code' : 'hidden');
  }

  /** The client the original is drawn for, and its surface. */
  protected readonly client = signal<RenderingClient>('apple-mail');
  protected readonly dark = signal(false);

  /** The reading pane both boxes stand for: a desktop client's 600px — the
      email's own width — or a phone's 375px. The editor and the frame narrow
      together, so they stay line for line. */
  protected readonly device = signal<'desktop' | 'phone'>('desktop');
  protected readonly boxWidth = computed(() => (this.device() === 'phone' ? 375 : 600));
  protected readonly clients = RENDERING_CLIENTS;
  protected readonly clientLabels = CLIENT_LABELS;

  /** The original as the client draws it, at a desktop pane, in a fully
      sandboxed frame (no scripts, no same-origin) — so bypassing the
      sanitizer is safe here. */
  protected readonly original = computed<SafeHtml | null>(() => {
    const pair = this.pair();
    if (!pair) return null;
    // Edge to edge at either width (the client's phone pane, no margin):
    // the box is the email's own, as the editor beside has it — a desktop
    // pane's margin would set the original 16px off the replica.
    const html = renderForClient(pair.original, this.client(), {
      dark: this.dark(),
      pane: 'phone',
    });
    // No scrollbar taking width out of the frame — the editor beside has
    // none either, so both boxes give the email their full width.
    return this.#sanitizer.bypassSecurityTrustHtml(html + NO_SCROLLBAR);
  });

  /** One example up (-1) or down (+1), wrapping round. */
  protected step(by: -1 | 1): void {
    const count = this.pairs().length;
    if (count) this.index.update((index) => (index + by + count) % count);
  }
}
