import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { EventColor } from '../../../../../core/calendar/calendar-event';
import { ColorMarker } from './color-marker';

@Component({
  imports: [ColorMarker],
  template: `<calendar-color-marker
    [color]="color()"
    [readonly]="fixed()"
    (picked)="picked = $event"
  />`,
})
class Host {
  readonly color = signal<EventColor>('peacock');
  readonly fixed = signal(false);
  picked: EventColor | null = null;
}

describe('ColorMarker', () => {
  const start = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  };

  it('is a button named for the colour that opens the colour menu, the colour ticked', async () => {
    const { fixture, root } = await start();
    const button = root.querySelector<HTMLButtonElement>('button.color-marker')!;
    expect(button.getAttribute('aria-label')).toBe('Color: Peacock');

    button.click();
    await fixture.whenStable();
    const checked = document.querySelector('.toolbar-menu [aria-checked="true"]');
    expect(checked?.textContent).toContain('Peacock');
  });

  it('says the colour picked from the menu', async () => {
    const { fixture, root } = await start();
    root.querySelector<HTMLButtonElement>('button.color-marker')!.click();
    await fixture.whenStable();
    const tomato = [
      ...document.querySelectorAll<HTMLElement>('.toolbar-menu [role="menuitemradio"]'),
    ].find((item) => item.textContent?.includes('Tomato'))!;
    tomato.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.picked).toBe('tomato');
  });

  it('is the dot alone, named, where the colour cannot be changed', async () => {
    const { fixture, root } = await start();
    fixture.componentInstance.fixed.set(true);
    await fixture.whenStable();
    expect(root.querySelector('button')).toBeNull();
    expect(root.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Color: Peacock');
  });
});
