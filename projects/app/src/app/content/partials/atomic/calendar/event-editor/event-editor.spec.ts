import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { DateTime } from 'luxon';

import { isoMoment } from '../../../../../core/calendar/calendar-dates';
import { EventEdit } from '../../../../../core/calendar/calendar-event';
import { EventEditor } from './event-editor';

@Component({
  imports: [EventEditor],
  template: `<calendar-event-editor [(value)]="edit" />`,
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

describe('EventEditor', () => {
  const start = async () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    return { fixture, root, overlay };
  };

  it('picks its days on the app’s mini month, never the browser’s picker', async () => {
    const { root } = await start();
    expect(root.querySelectorAll('date-field')).toHaveLength(2);
    expect(root.querySelector('input[type="date"]')).toBeNull();
  });

  it('carries the end along when the start moves: the event keeps its length', async () => {
    const { fixture, root, overlay } = await start();
    root.querySelector<HTMLButtonElement>('.date-field__trigger')!.click();
    await fixture.whenStable();
    overlay.querySelector<HTMLButtonElement>('[data-day="2026-10-14"]')!.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.edit()).toEqual(
      expect.objectContaining({ start: '2026-10-14T09:00', end: '2026-10-14T10:30' }),
    );
  });

  /** `time` in New York, as the browser's own moment. */
  const newYork = (time: string) =>
    isoMoment(DateTime.fromISO(`2026-10-30T${time}`, { zone: 'America/New_York' }).toLocal());

  it('shows the hours in the event’s own zone', async () => {
    const { fixture, root } = await start();
    fixture.componentInstance.edit.update((edit) => ({
      ...edit,
      start: newYork('09:00'),
      end: newYork('10:30'),
      timeZone: 'America/New_York',
    }));
    await fixture.whenStable();
    const times = [...root.querySelectorAll<HTMLInputElement>('input[type="time"]')];
    expect(times.map((input) => input.value)).toEqual(['09:00', '10:30']);
    expect(root.querySelector<HTMLInputElement>('.zone-picker__field')!.value).toBe('New York');
  });

  /** The band under the times: one button. */
  const band = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.event-editor__more');

  it('brings out all day and the zone from one band under the times — Notion’s', async () => {
    const { fixture, root } = await start();
    expect(root.querySelector('button[toggleSwitch]')).toBeNull();
    expect(root.querySelector('calendar-zone-picker')).toBeNull();
    expect(band(root)!.getAttribute('aria-label')).toBe('calendar.allDay, calendar.timeZone');

    band(root)!.click();
    await fixture.whenStable();
    // Both rows out, nothing changed, the band gone.
    expect(root.querySelector('button[toggleSwitch]')!.getAttribute('aria-checked')).toBe('false');
    expect(root.querySelector('calendar-zone-picker')).not.toBeNull();
    expect(fixture.componentInstance.edit().allDay).toBe(false);
    expect(band(root)).toBeNull();
  });

  it('keeps the place and the note behind their own buttons — out on a press, away when left empty', async () => {
    const { fixture, root } = await start();
    const placeButton = () =>
      root.querySelector<HTMLButtonElement>('[aria-label="calendar.addLocation"]');
    const place = () =>
      root.querySelector<HTMLInputElement>('input[placeholder="calendar.addLocation"]');
    expect(place()).toBeNull();
    expect(root.querySelector('textarea')).toBeNull();

    placeButton()!.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(place());
    expect(placeButton()).toBeNull();
    // Under the buttons' row, which keeps the note's button.
    const tools = root.querySelector('.event-editor__tools')!;
    expect(tools.querySelector('[aria-label="calendar.addDescription"]')).not.toBeNull();
    expect(tools.compareDocumentPosition(place()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Left empty: away again, its button back.
    place()!.blur();
    await fixture.whenStable();
    expect(place()).toBeNull();
    expect(placeButton()).not.toBeNull();

    // Left with something in it: it stays.
    placeButton()!.click();
    await fixture.whenStable();
    place()!.value = 'Alexanderplatz';
    place()!.dispatchEvent(new Event('input', { bubbles: true }));
    place()!.blur();
    await fixture.whenStable();
    expect(place()).not.toBeNull();
    expect(fixture.componentInstance.edit().location).toBe('Alexanderplatz');
  });

  it('adds the sections at the bottom in the order they are brought out — the row stays, each button in its slot', async () => {
    const { fixture, root } = await start();
    const tools = root.querySelector('.event-editor__tools')!;
    const noteButton = () =>
      tools.querySelector<HTMLButtonElement>('[aria-label="calendar.addDescription"]');
    expect(noteButton()!.classList).toContain('event-editor__tool--note');

    // The note first: the place's button stays in its own slot, alone.
    noteButton()!.click();
    await fixture.whenStable();
    root.querySelector('textarea')!.value = 'Agenda';
    root.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
    tools.querySelector<HTMLButtonElement>('.event-editor__tool--place')!.click();
    await fixture.whenStable();

    // The place added under the note; the row still there, empty.
    const note = root.querySelector('textarea')!;
    const place = root.querySelector('input[placeholder="calendar.addLocation"]')!;
    expect(note.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.querySelector('.event-editor__tools')).toBe(tools);
    // No section button left; the colour is the actions' column's, under Save.
    expect(tools.querySelectorAll('.event-editor__tool')).toHaveLength(0);
    const actions = root.querySelector('.event-editor__actions')!;
    const [first, second] = actions.children;
    expect(first.classList).toContain('event-editor__save');
    expect(second.classList).toContain('event-editor__color');
  });

  it('keeps the hours when another zone is picked — now that zone’s', async () => {
    const { fixture, root, overlay } = await start();
    band(root)!.click();
    await fixture.whenStable();
    const field = root.querySelector<HTMLInputElement>('.zone-picker__field')!;
    field.focus();
    field.value = 'new york';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await fixture.whenStable();
    overlay.querySelector<HTMLElement>('[role="option"]')!.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.edit()).toEqual(
      expect.objectContaining({
        timeZone: 'America/New_York',
        start: newYork('09:00'),
        end: newYork('10:30'),
      }),
    );
  });
});
