import { Component, Signal, WritableSignal, computed, inject } from '@angular/core';

// Angular Material
import { MatButton, MatFabButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, isActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MenuTrigger } from '@angular/aria/menu';

import { ComposeWindows } from '../../../core/email/compose-windows';
import { ReceivedMail } from '../../../core/email/mailbox/received-mail';
import { Preferences } from '../../../core/storages/preferences';
import { I18n } from '../../../core/translations/i18n';
import { MailboxAside } from '../../partials/atomic/mailbox/mailbox-aside';
import { MailboxOpener } from '../../partials/atomic/mailbox/mailbox-opener';
import { LanguageMenu } from '../../partials/common/language-menu/language-menu';
import { PAGE_HEADER_LEAD } from '../../partials/common/page-header/page-header';
import { ThemeToggle } from '../../partials/common/theme-toggle/theme-toggle';
import { HoverCard } from '../../partials/common/hover-card/hover-card';
import { DocPageLink } from '../../partials/common/doc-page/doc';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../partials/shared/email/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import { API_PAGES } from './api-reference/api-pages';
import { COMPONENT_PAGES, UTILITY_PAGES } from './components/component-pages';
import { STYLING_PAGES } from './styling/styling-pages';

/** A place the aside leads to. */
interface MailboxLink {
  readonly kind: 'link';
  readonly path: string;
  readonly icon: string;
  readonly key: string;
  /** What waits there, counted — the inbox's unread — or nothing to say. */
  readonly count?: Signal<number>;
  /** Lit for its places under it too (`/calendar` for `/calendar/week/…`);
      only for its own path otherwise. */
  readonly nested?: boolean;
}

/** Places one level down, behind a row of their own that folds them —
    Linear's team under "Your teams": a reference and its pages. */
interface MailboxGroup {
  readonly kind: 'group';
  readonly id: string;
  readonly icon: string;
  readonly key: string;
  readonly links: readonly MailboxLink[];
  /** Its places as the rail's menu has them: links under the group's
      name, each with its icon, the one you are in ticked. */
  readonly menu: Signal<ToolbarMenuItem<string>[]>;
  /** Whether its places show — kept across reloads. */
  readonly open: WritableSignal<boolean>;
  /** Whether the place you are in is one of its own. */
  readonly current: Signal<boolean>;
}

/** A run of places under a heading of its own, or none (the first). */
interface MailboxSection {
  readonly id: string;
  readonly key: string | null;
  readonly items: readonly (MailboxLink | MailboxGroup)[];
  /** Whether the run shows under its heading — kept across reloads; a
      run without a heading never folds. */
  readonly open: WritableSignal<boolean> | null;
}

/** A reference's pages as links under it: `/api/editor`. */
const pageLinks = (base: string, pages: readonly DocPageLink[]): MailboxLink[] =>
  pages.map((page) => ({
    kind: 'link',
    path: `/${base}/${page.id}`,
    icon: page.icon,
    key: page.key,
  }));

/**
 * The mailbox: the app's pages as a mail client lays them out, Linear's —
 * a quiet aside the viewport's height down the left (the rail toggle and
 * Compose on top, the places — small rows, a heading per run, the place you
 * are in a wash, never a bar — and the settings at its foot), and the page
 * itself beside it on a sheet of its own. No bar across the top: the page
 * has the viewport. The composer is not in here: it is the front page, with
 * chrome of its own, and the way in is one way — nothing here leads back to
 * it (Compose opens a window over the page instead).
 *
 * Collapsed, the aside is a rail of its icons — at once, no motion. On a
 * phone there is no rail: shut, the aside is not there (the opener it lends
 * every page header opens it, `MailboxOpener`); opened, it lies over the
 * page.
 */
@Component({
  selector: 'app-mailbox',
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    MatIcon,
    MatButton,
    MatFabButton,
    MatIconButton,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    LanguageMenu,
    ThemeToggle,
    MenuTrigger,
    ToolbarMenu,
    HoverCard,
  ],
  templateUrl: './mailbox.html',
  styleUrl: './mailbox.scss',
  // The aside's state, shared with the opener every page header leads with
  // — part of the header, so it scrolls away with one that does.
  providers: [MailboxAside, { provide: PAGE_HEADER_LEAD, useValue: MailboxOpener }],
  host: {
    '[attr.data-collapsed]': 'collapsed() || null',
    '[attr.data-over]': 'over() || null',
    '[attr.data-closed]': 'closed() || null',
    '(keydown.escape)': 'close($event)',
  },
})
export class Mailbox {
  readonly #composeWindows = inject(ComposeWindows);
  readonly #mailbox = inject(ReceivedMail);
  /** The inbox's unread, as it goes down. */
  readonly #unread = computed(() => this.#mailbox.unread().size);
  readonly #aside = inject(MailboxAside);

  /** A rail icon's name, in a hover card beside it: after the pointer has
      rested a moment (a pass over the rail shows nothing), gone the moment
      it leaves — there is nothing in it to reach. Along the rail, the next
      comes at once (`HoverCards.warm`). */
  protected readonly railName = { show: 400, hide: 0 } as const;

  /** Whether the aside is the rail (`MailboxAside`). */
  readonly collapsed = this.#aside.collapsed;

  /** A phone's aside, opened: it lies over the page, under a scrim. */
  protected readonly over = this.#aside.over;

  /** A phone's aside, shut: not there at all — the page headers' opener
      opens it. */
  protected readonly closed = this.#aside.closed;

  /** The toggle: aside ⇄ rail. */
  protected toggle(): void {
    this.#aside.toggle();
  }

  /** Compose: a new message in a window, over the page. */
  protected compose(): void {
    this.went();
    void this.#composeWindows.open();
  }

  /** A place was picked (or Compose pressed): an aside lying over the page
      has done its job and steps back to the rail. */
  protected went(): void {
    if (this.over()) this.collapsed.set(true);
  }

  /** Escape closes an aside that lies over the page — unless something
      inside took the key first (the language menu closing). */
  protected close(event: Event): void {
    if (!this.over() || event.defaultPrevented) return;
    event.preventDefault();
    this.collapsed.set(true);
  }

  /** A heading or a group's row pressed: what it holds folds away, or
      comes back. */
  protected fold(folding: MailboxSection | MailboxGroup): void {
    folding.open?.update((open) => !open);
  }

  readonly #preferences = inject(Preferences);
  readonly #router = inject(Router);
  readonly #i18n = inject(I18n);

  /** A group's pages as the rail's menu has them (`MailboxGroup.menu`). */
  #menu(key: string, links: readonly MailboxLink[]): Signal<ToolbarMenuItem<string>[]> {
    const active = links.map((link) => isActive(link.path, this.#router));
    return computed(() =>
      links.map((link, i) => ({
        value: link.path,
        label: this.#i18n.t(link.key),
        icon: link.icon,
        link: link.path,
        current: active[i](),
        section: i === 0 ? this.#i18n.t(key) : undefined,
      })),
    );
  }

  /** The components and the utilities share `/components/…`: each group
      is lit by its own pages, not by the path they share. */
  readonly #apiLinks = pageLinks('api', API_PAGES);
  readonly #stylingLinks = pageLinks('styling', STYLING_PAGES);
  readonly #componentLinks = pageLinks('components', COMPONENT_PAGES);
  readonly #utilityLinks = pageLinks('components', UTILITY_PAGES);
  #anyActive(links: readonly MailboxLink[]): Signal<boolean> {
    const active = links.map((link) => isActive(link.path, this.#router));
    return computed(() => active.some((one) => one()));
  }

  /** The aside, in reading order: the mail, the designer's places (the
      templates), then the developers' places —
      each reference a group of its pages (Linear's teams), the components
      and the utilities a group each of their playgrounds, and the render
      bench on the first level. */
  protected readonly sections: readonly MailboxSection[] = [
    {
      id: 'mail',
      key: null,
      open: null,
      items: [
        {
          kind: 'link',
          path: '/inbox',
          icon: 'inbox',
          key: 'app.nav.inbox',
          count: this.#unread,
        },
        {
          kind: 'link',
          path: '/calendar',
          icon: 'calendar_month',
          key: 'app.nav.calendar',
          nested: true,
        },
      ],
    },
    {
      id: 'designer',
      key: 'app.nav.designer',
      open: this.#preferences.asideDesignerOpen,
      items: [
        { kind: 'link', path: '/templates', icon: 'grid_view', key: 'app.nav.templates' },
        { kind: 'link', path: '/snippets', icon: 'short_text', key: 'app.nav.snippets' },
      ],
    },
    {
      id: 'developers',
      key: 'app.nav.developers',
      open: this.#preferences.asideDevelopersOpen,
      items: [
        {
          kind: 'group',
          id: 'api',
          icon: 'api',
          key: 'app.nav.api',
          open: this.#preferences.asideApiOpen,
          current: isActive('/api', this.#router),
          links: this.#apiLinks,
          menu: this.#menu('app.nav.api', this.#apiLinks),
        },
        {
          kind: 'group',
          id: 'styling',
          icon: 'palette',
          key: 'app.nav.styling',
          open: this.#preferences.asideStylingOpen,
          current: isActive('/styling', this.#router),
          links: this.#stylingLinks,
          menu: this.#menu('app.nav.styling', this.#stylingLinks),
        },
        {
          kind: 'group',
          id: 'components',
          icon: 'widgets',
          key: 'app.nav.components',
          open: this.#preferences.asideComponentsOpen,
          current: this.#anyActive(this.#componentLinks),
          links: this.#componentLinks,
          menu: this.#menu('app.nav.components', this.#componentLinks),
        },
        {
          kind: 'group',
          id: 'utilities',
          icon: 'build',
          key: 'app.nav.utilities',
          open: this.#preferences.asideUtilitiesOpen,
          current: this.#anyActive(this.#utilityLinks),
          links: this.#utilityLinks,
          menu: this.#menu('app.nav.utilities', this.#utilityLinks),
        },
        { kind: 'link', path: '/render', icon: 'compare', key: 'app.nav.render' },
      ],
    },
  ];
}
