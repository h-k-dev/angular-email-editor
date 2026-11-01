import { Component, ElementRef, afterNextRender, model, output, viewChild } from '@angular/core';

import { TranslatePipe } from '@ngx-translate/core';

import { EventEdit } from '../../../../../core/calendar/calendar-event';

/**
 * A new event, named: the title and nothing else — no colour, no close, no
 * frame. It is the grid's own ground with the grid's lines gone, so it is
 * seen only by that and its placeholder. Enter keeps the event; Escape and
 * a press away are the page's (it holds the overlay).
 *
 * The edit is a two-way `value`, written through as it is typed, as the
 * full card's (`EventEdit`) — the mark in the grid says the title at once.
 */
@Component({
  selector: 'calendar-quick-title',
  imports: [TranslatePipe],
  templateUrl: './quick-title.html',
  styleUrl: './quick-title.scss',
})
export class QuickTitle {
  readonly value = model.required<EventEdit>();

  readonly save = output<EventEdit>();

  private readonly titleInput = viewChild.required<ElementRef<HTMLInputElement>>('title');

  constructor() {
    afterNextRender(() => this.focus());
  }

  /** Back in the title — after the next mark, pressed on the grid. */
  focus(): void {
    this.titleInput().nativeElement.focus({ preventScroll: true });
  }

  protected typed(event: Event): void {
    const title = (event.target as HTMLInputElement).value;
    this.value.update((edit) => ({ ...edit, title }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.save.emit(this.value());
  }
}
