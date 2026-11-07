import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StickerIcon } from './sticker-icon';

@Component({
  imports: [StickerIcon],
  template: `<sticker-icon [icon]="icon()" />`,
})
class Host {
  readonly icon = signal('note_stack_add');
}

describe('StickerIcon', () => {
  let fixture: ComponentFixture<Host>;
  const sticker = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('sticker-icon')!;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('draws its symbol, decoration only', () => {
    expect(sticker().querySelector('mat-icon')?.textContent?.trim()).toBe('note_stack_add');
    expect(sticker().getAttribute('aria-hidden')).toBe('true');
  });

  it('follows the symbol as it changes', async () => {
    fixture.componentInstance.icon.set('inbox');
    await fixture.whenStable();
    expect(sticker().querySelector('mat-icon')?.textContent?.trim()).toBe('inbox');
  });
});
