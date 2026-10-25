import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

// Angular Material
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

// Angular Email Editor
import { ReplyKind } from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

import { PaperScheme } from '../../../../../core/dawn/dawn.render';
import { PHONE_CONTAINER_MAX } from '../../../../../core/layout/viewport';
import { I18n } from '../../../../../core/translations/i18n';
import { EmailViewer } from '../../../common/email-viewer/email-viewer';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';

/** The header's side inset (the stylesheet's `--_inset`), px: wide, and as
    wide as a phone. */
const INSET = { wide: 32, phone: 16 } as const;

/**
 * A received message as the app shows it — one sheet of paper: Gmail's
 * header without its avatar (the subject; who sent it and to whom; at the
 * line's end the date, the paper button, Reply and ⋮), the body as Dawn
 * draws it (`email-viewer`), and the answers written out under it.
 *
 * It lays itself out by the room it is GIVEN, never by the screen: it is a
 * container (`mail-view`), and its phone layout — the 16px inset, the
 * tighter top — is a container query (`bp.phone-container`) at a phone's
 * content width (480px), never the viewport's breakpoint: a narrow pane
 * beside the list on a desk keeps the wide layout. So a phone-wide pane, a phone, and a phone drawn on a desk (the
 * template designer's) all show the very same thing. The one part CSS
 * cannot reach is the inset inside the body's frame: that is the same
 * width read once by a ResizeObserver, its twin.
 *
 *     <article mail-view [subject]="…" [name]="…" [html]="body" (answer)="reply($event)"></article>
 *
 * What a press does is the host's (`answer`, `flipPaper`); a host that only
 * shows a message (a preview) makes it `inert`.
 */
@Component({
  selector: 'article[mail-view]',
  imports: [TranslatePipe, MatButton, MatIconButton, MatIcon, MenuTrigger, ToolbarMenu, EmailViewer],
  templateUrl: './mail-view.html',
  styleUrl: './mail-view.scss',
  host: {
    class: 'mail-view',
    '[attr.aria-label]': 'subject()',
    '[attr.data-width]': "phone() ? 'phone' : 'wide'",
  },
})
export class MailView {
  readonly #i18n = inject(I18n);

  readonly subject = input.required<string>();
  /** The sender's name — or the bare address, where there is no name. */
  readonly name = input.required<string>();
  /** The sender's address, beside the name; none where `name` is it. */
  readonly address = input<string | null>(null);
  /** Who it went to, written out; the line is left out with nobody. */
  readonly to = input('');
  readonly cc = input<string | null>(null);
  /** When, written out — the host formats it. */
  readonly date = input('');
  /** The body; null while it is on its way (a thin bar where it will be). */
  readonly html = input<string | null>(null);
  /** The paper it is read on. */
  readonly scheme = input<PaperScheme>('light');
  /** What the body's frame is, for assistive tech. */
  readonly bodyLabel = input('');

  /** An answer asked for: Reply, Reply all or Forward. */
  readonly answer = output<ReplyKind>();
  /** The paper button: the mail read on the other paper. */
  readonly flipPaper = output<void>();

  /** As wide as a phone — the container query's width, read for the frame. */
  protected readonly phone = signal(false);

  /** The side inset a simple email's text keeps inside its frame, lined up
      under the header; a newsletter runs edge to edge. */
  protected readonly inset = computed(() => (this.phone() ? INSET.phone : INSET.wide));

  /** ⋮: the answers beside Reply, in the app's language. */
  protected readonly moreItems = computed<ToolbarMenuItem<ReplyKind>[]>(() => [
    { value: 'reply-all', label: this.#i18n.t('inbox.replyAll'), icon: 'reply_all' },
    { value: 'forward', label: this.#i18n.t('inbox.forward'), icon: 'forward' },
  ]);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) =>
      this.phone.set(entry.contentRect.width <= PHONE_CONTAINER_MAX),
    );
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}
