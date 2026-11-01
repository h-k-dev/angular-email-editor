/**
 * The card's motion in real Chromium — `npm run test:render` (jsdom has no
 * layout and no ResizeObserver): a row brought out by its button, or put
 * away again, runs the fields' height ([heightSwitch]) instead of jumping.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { HEIGHT_SWITCH } from '../../../../../core/directives/height-switch/height-switch';
import { EventEdit } from '../../../../../core/calendar/calendar-event';
import { EventEditor } from './event-editor';

@Component({
  imports: [EventEditor],
  template: `<div style="inline-size: 380px"><calendar-event-editor [(value)]="edit" /></div>`,
})
class Host {
  readonly edit = signal<EventEdit>({
    title: '',
    start: '2026-10-30T09:00',
    end: '2026-10-30T10:30',
    allDay: false,
    color: 'peacock',
    location: '',
    description: '',
  });
}

describe('EventEditor (render)', () => {
  let fixture: ComponentFixture<Host>;

  const root = () => fixture.nativeElement as HTMLElement;
  const motion = () => root().querySelector<HTMLElement>('.event-editor__motion')!;
  const height = () => Math.round(motion().getBoundingClientRect().height);
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Heights over a switch, frame by frame, until it has run. The first
      frame's is not read: a frame callback runs before the observer that
      holds the old height, so it would read the new layout no screen ever
      shows (the hold is set before that frame paints). */
  const sampled = async (act: () => void): Promise<number[]> => {
    const heights = [height()];
    act();
    await frame();
    const end = performance.now() + HEIGHT_SWITCH + 120;
    while (performance.now() < end) {
      await frame();
      heights.push(height());
    }
    return heights;
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
    await frame();
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('runs the height out when the place is brought out, and back when it is left empty', async () => {
    const before = height();

    const opening = await sampled(() =>
      root().querySelector<HTMLButtonElement>('[aria-label="calendar.addLocation"]')!.click(),
    );
    const opened = opening.at(-1)!;
    expect(opened).toBeGreaterThan(before);
    // Through heights between the two, never past them.
    expect(opening.some((h) => h > before && h < opened)).toBe(true);
    expect(opening.every((h, i) => i === 0 || h >= opening[i - 1])).toBe(true);

    const closing = await sampled(() =>
      root().querySelector<HTMLInputElement>('input[placeholder="calendar.addLocation"]')!.blur(),
    );
    expect(closing.at(-1)).toBe(before);
    expect(closing.some((h) => h < opened && h > before)).toBe(true);
    expect(closing.every((h, i) => i === 0 || h <= closing[i - 1])).toBe(true);

    await wait(50);
    expect(motion().hasAttribute('data-height-switch')).toBe(false);
  });
});
