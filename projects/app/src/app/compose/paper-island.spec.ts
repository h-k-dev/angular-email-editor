import { Component, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { EditorColorScheme } from './email-compose/email-compose';
import { MarqueeStart, PaperIslandDirective, PaperIslandScheme } from './paper-island';

/** An island, a part inside it, and a template declared inside but stamped
    outside — the way an overlay's content is drawn on <body>. */
@Component({
  imports: [PaperIslandDirective, PaperIslandScheme, NgTemplateOutlet],
  template: `
    <section class="island" [paperIsland]="scheme()">
      <p class="inside">inside</p>
      <ng-template #away><div class="away" paperIslandScheme></div></ng-template>
    </section>
    <ng-container [ngTemplateOutlet]="away" />
    <div class="off" paperIslandScheme></div>
  `,
})
class Host {
  readonly scheme = signal<EditorColorScheme | null>('dark');
}

describe('PaperIsland', () => {
  it('marks the island, and carries its scheme to what is drawn outside it — not to strangers', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const scheme = (selector: string) =>
      root.querySelector(selector)?.getAttribute('data-paper-scheme') ?? null;

    expect(scheme('.island')).toBe('dark');
    // Drawn outside the island's DOM, owned by it through DI.
    expect(root.querySelector('.island .away')).toBeNull();
    expect(scheme('.away')).toBe('dark');
    // Not the island's: the app's theme.
    expect(scheme('.off')).toBeNull();

    fixture.componentInstance.scheme.set('light');
    await fixture.whenStable();
    expect(scheme('.island')).toBe('light');
    expect(scheme('.away')).toBe('light');

    // No island: nothing marked, every part falls back.
    fixture.componentInstance.scheme.set(null);
    await fixture.whenStable();
    expect(scheme('.island')).toBeNull();
    expect(scheme('.away')).toBeNull();
  });
});

/** A start point on an island, one off it, and a child of the start point. */
@Component({
  imports: [PaperIslandDirective, MarqueeStart],
  template: `
    <section class="island" [paperIsland]="null">
      <form class="zone" marqueeStart><label class="child">From</label></form>
    </section>
    <form class="stray" marqueeStart></form>
  `,
})
class StartHost {}

describe('MarqueeStart', () => {
  it("relays a press on its own empty room to the island's marquee — not a child's, not off an island", async () => {
    const fixture = TestBed.createComponent(StartHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const island = fixture.debugElement
      .query((el) => el.nativeElement.classList?.contains('island'))
      .injector.get(PaperIslandDirective);
    const pressed: EventTarget[] = [];
    const release = island.marquee.register((event) => {
      pressed.push(event.target!);
      return true;
    });
    const press = (selector: string) =>
      root.querySelector(selector)!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    press('.zone');
    press('.child');
    press('.stray');
    expect(pressed).toEqual([root.querySelector('.zone')]);

    // Released: the composer is gone, the start point asks for nothing.
    release();
    press('.zone');
    expect(pressed).toHaveLength(1);
  });
});
