import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ScrollOwner } from './scroll-owner';

/** A part that would scroll itself: it asks for an owner above it. */
@Component({ selector: 'test-part', template: '' })
class Part {
  readonly owner = inject(ScrollOwner, { optional: true });
}

@Component({
  imports: [ScrollOwner, Part],
  template: `<main [scrollOwner]="active()"><test-part /></main>`,
})
class Host {
  readonly active = signal(true);
}

describe('ScrollOwner', () => {
  it('scrolls its element, and is the owner every part inside it finds', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const main = fixture.nativeElement.querySelector('main') as HTMLElement;
    expect(main.style.overflowY).toBe('auto');
    expect(main.hasAttribute('data-scroll-owner')).toBe(true);

    const part = fixture.debugElement.children[0].children[0].componentInstance as Part;
    expect(part.owner?.element).toBe(main);
  });

  it('keeps clear at its foot what is stuck there — the tallest — until it lets go', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const main = fixture.nativeElement.querySelector('main') as HTMLElement;
    const owner = fixture.debugElement.children[0].injector.get(ScrollOwner);

    const toolbar = signal(48);
    const release = owner.stickFoot(toolbar);
    owner.stickFoot(signal(20));
    await fixture.whenStable();
    expect(main.style.scrollPaddingBlockEnd).toBe('48px');

    toolbar.set(96);
    await fixture.whenStable();
    expect(main.style.scrollPaddingBlockEnd).toBe('96px');

    release();
    await fixture.whenStable();
    expect(main.style.scrollPaddingBlockEnd).toBe('20px');
  });

  it('is no owner when switched off: nothing scrolls it, and parts scroll themselves', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.active.set(false);
    await fixture.whenStable();
    const main = fixture.nativeElement.querySelector('main') as HTMLElement;
    expect(main.style.overflowY).toBe('');
    expect(main.hasAttribute('data-scroll-owner')).toBe(false);
    const part = fixture.debugElement.children[0].children[0].componentInstance as Part;
    expect(part.owner?.active()).toBe(false);
  });
});
