import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HOVER_LINGER, HoverLinger } from './hover-linger';

@Component({
  imports: [HoverLinger],
  template: `<div class="host" [hoverLinger]="40">
      <button id="one">one</button><button id="two">two</button>
    </div>
    <button id="outside">outside</button>`,
})
class Host {}

describe('HoverLinger', () => {
  let fixture: ComponentFixture<Host>;

  const host = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host')!;
  const shown = () => host().hasAttribute('data-hover-linger');
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = async () => {
    await wait(0);
    await fixture.whenStable();
  };
  const button = (id: string) => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`#${id}`)!;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('lingers a generous second by default', () => {
    expect(HOVER_LINGER).toBe(1000);
  });

  it('shows at once with the pointer, and lingers after it leaves', async () => {
    expect(shown()).toBe(false);
    host().dispatchEvent(new PointerEvent('pointerenter'));
    await settle();
    expect(shown()).toBe(true);

    host().dispatchEvent(new PointerEvent('pointerleave'));
    await settle();
    expect(shown()).toBe(true);
    await vi.waitFor(() => expect((fixture.detectChanges(), shown())).toBe(false), { timeout: 500 });
  });

  it('a pointer back within the linger keeps it, without a flicker', async () => {
    host().dispatchEvent(new PointerEvent('pointerenter'));
    await settle();
    host().dispatchEvent(new PointerEvent('pointerleave'));
    await wait(20);
    host().dispatchEvent(new PointerEvent('pointerenter'));
    await settle();
    await wait(60);
    fixture.detectChanges();
    expect(shown()).toBe(true);
  });

  it('follows focus inside it, and lets go once focus is elsewhere', async () => {
    button('one').focus();
    await settle();
    expect(shown()).toBe(true);

    // From one of its buttons to the other: still inside.
    button('two').focus();
    await wait(60);
    fixture.detectChanges();
    expect(shown()).toBe(true);

    button('outside').focus();
    await vi.waitFor(() => expect((fixture.detectChanges(), shown())).toBe(false), { timeout: 500 });
  });
});
