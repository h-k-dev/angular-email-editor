import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

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
});
