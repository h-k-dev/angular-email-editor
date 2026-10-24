import { Component } from '@angular/core';

/**
 * A page's header: the 48px block on top of a page, the page's own — each
 * page decides what goes in it, and where (a two-pane page gives each pane
 * one, the same height, so the two line up). Empty, it still keeps its 48px:
 * a page never moves the day a header gets its content.
 *
 *     <header page-header>…</header>
 *
 * A row: what is projected sits on the line, 8px apart; the page places its
 * own controls along it (a spacer, or `margin-inline-start: auto`).
 */
@Component({
  selector: 'header[page-header]',
  template: '<ng-content />',
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
export class PageHeader {}
