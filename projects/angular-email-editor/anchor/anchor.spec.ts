import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Anchor, AnchorRect } from './anchor';

@Component({
  imports: [Anchor],
  template: `<span class="anchor" [emailAnchor]="rect()" #anchor="emailAnchor"></span>`,
})
class Host {
  readonly rect = signal<AnchorRect | null>(null);
  readonly anchor = viewChild.required<Anchor>('anchor');
}

describe('Anchor', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let element: HTMLElement;

  const place = async (rect: AnchorRect | null) => {
    host.rect.set(rect);
    await fixture.whenStable();
  };

  const box = () => {
    const { left, top, width, height } = element.style;
    return { left, top, width, height };
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    element = (fixture.nativeElement as HTMLElement).querySelector('.anchor')!;
  });

  it('stands fixed over the box it is given, out of the pointer’s way', async () => {
    await place({ left: 120, top: 48, width: 64, height: 18 });
    expect(element.style.position).toBe('fixed');
    expect(element.style.pointerEvents).toBe('none');
    expect(box()).toEqual({ left: '120px', top: '48px', width: '64px', height: '18px' });
  });

  it('is a point when the box has no size — a caret', async () => {
    await place({ left: 10, top: 20 });
    expect(box()).toEqual({ left: '10px', top: '20px', width: '0px', height: '0px' });
  });

  it('takes a DOMRect as it is', async () => {
    await place(new DOMRect(5, 6, 7, 8));
    expect(box()).toEqual({ left: '5px', top: '6px', width: '7px', height: '8px' });
  });

  it('stays where it was while there is no box, so what it holds can close in place', async () => {
    await place({ left: 120, top: 48, width: 64, height: 18 });
    await place(null);
    expect(box()).toEqual({ left: '120px', top: '48px', width: '64px', height: '18px' });

    await place({ left: 1, top: 2, width: 3, height: 4 });
    expect(box()).toEqual({ left: '1px', top: '2px', width: '3px', height: '4px' });
  });

  it('starts in the corner before any box', () => {
    expect(box()).toEqual({ left: '0px', top: '0px', width: '0px', height: '0px' });
  });

  it('hands out its element, for what takes an element', () => {
    expect(host.anchor().element).toBe(element);
  });
});
