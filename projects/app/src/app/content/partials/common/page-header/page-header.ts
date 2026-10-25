import { NgComponentOutlet } from '@angular/common';
import { Component, InjectionToken, Type, booleanAttribute, inject, input } from '@angular/core';

/**
 * What leads every page header under a frame: a component the frame lends
 * its pages (the mailbox: a phone's aside opener), drawn first on the row —
 * part of the header, so it goes where the header goes, scrolled away with
 * it or not. None outside such a frame.
 */
export const PAGE_HEADER_LEAD = new InjectionToken<Type<unknown>>('PAGE_HEADER_LEAD');

/**
 * A page's header: the 48px block on top of a page, the page's own — each
 * page decides what goes in it, and where (a two-pane page gives each pane
 * one, the same height, so the two line up). Empty, it still keeps its 48px:
 * a page never moves the day a header gets its content.
 *
 *     <header page-header>…</header>
 *
 * A row: the frame's lead (`PAGE_HEADER_LEAD`), then what is projected, 8px
 * apart; the page places its own controls along it (a spacer, or
 * `margin-inline-start: auto`). A header that leads with a control of its
 * own — a phone's back button, out of a message to its list — sets
 * `[frameLead]="false"`: the back arrow stands where the opener stood, as
 * a mail app's message view has it.
 */
@Component({
  selector: 'header[page-header]',
  imports: [NgComponentOutlet],
  template: `
    @if (lead && frameLead()) {
      <ng-container *ngComponentOutlet="lead" />
    }
    <ng-content />
  `,
  styles: `
    :host {
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      block-size: 48px;
      padding-inline: 8px;
      box-sizing: border-box;
    }
  `,
})
export class PageHeader {
  protected readonly lead = inject(PAGE_HEADER_LEAD, { optional: true });

  /** Whether the frame's lead heads this header. */
  readonly frameLead = input(true, { transform: booleanAttribute });
}
