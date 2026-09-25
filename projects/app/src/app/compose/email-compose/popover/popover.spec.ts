import {
  Component,
  ElementRef,
  TemplateRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { CdkConnectedOverlay } from '@angular/cdk/overlay';
import { AnchorRect } from 'angular-email-editor/anchor';

import { POPOVER_ABOVE, POPOVER_BELOW, Popover } from './popover';
import { PopoverOutlet } from './popover-outlet';

/** A toolbar-layer panel — a bubble or block menu's shape: open and box
    from outside, content with a view query of its own inside. */
@Component({
  selector: 'div[spec-toolbar]',
  template: `<ng-template #panel
    ><div class="toolbar" #menu>{{ name() }} {{ words() }}</div></ng-template
  >`,
})
class ToolbarPanel {
  readonly name = input('toolbar');
  readonly open = signal(false);
  readonly anchor = signal<AnchorRect | null>({ left: 10, top: 20, width: 30, height: 40 });
  readonly words = signal('one');
  readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  constructor() {
    inject(Popover).register({
      layer: 'toolbar',
      open: this.open,
      anchor: this.anchor,
      content: this.panel,
      positions: () => POPOVER_BELOW,
    });
  }
}

/** A dialog-layer panel — the link editor's shape. */
@Component({
  selector: 'div[spec-dialog]',
  template: `<ng-template #panel><div class="dialog">dialog</div></ng-template>`,
})
class DialogPanel {
  readonly open = signal(false);
  readonly anchor = signal<AnchorRect | null>({ left: 50, top: 60 });
  readonly keys: string[] = [];
  readonly outside = vi.fn();
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  constructor() {
    inject(Popover).register({
      layer: 'dialog',
      open: this.open,
      anchor: this.anchor,
      content: this.panel,
      positions: () => POPOVER_ABOVE,
      onKeydown: (event) => this.keys.push(event.key),
      onOutsideClick: this.outside,
    });
  }
}

@Component({
  imports: [ToolbarPanel, DialogPanel, PopoverOutlet],
  providers: [Popover],
  template: `
    <div spec-toolbar name="first" #first></div>
    <div spec-toolbar name="second" #second></div>
    <div spec-dialog #dialog></div>
    <div popover-outlet></div>
  `,
})
class Host {
  readonly first = viewChild.required<ToolbarPanel>('first');
  readonly second = viewChild.required<ToolbarPanel>('second');
  readonly dialog = viewChild.required<DialogPanel>('dialog');
}

describe('Popover', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const box = () => document.querySelector<HTMLElement>('.popover');
  const shows = (selector: string) => !!document.querySelector(`.popover ${selector}`);
  const anchor = () => {
    const span = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[popover-outlet] span',
    )!;
    const { left, top, width, height } = span.style;
    return { left, top, width, height };
  };
  const settle = () => fixture.whenStable();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await settle();
  });

  afterEach(() => fixture.destroy());

  it('is down while no panel is open, and up with an open panel’s content over its box', async () => {
    expect(box()).toBeNull();

    host.first().open.set(true);
    await settle();
    expect(shows('.toolbar')).toBe(true);
    expect(box()!.textContent).toContain('first one');
    expect(anchor()).toEqual({ left: '10px', top: '20px', width: '30px', height: '40px' });

    host.first().open.set(false);
    await settle();
    expect(box()).toBeNull();
  });

  it('a dialog takes the popover from a toolbar in the same box, and hands it back', async () => {
    host.first().open.set(true);
    await settle();
    const before = box();

    host.dialog().open.set(true);
    await settle();
    expect(shows('.dialog')).toBe(true);
    expect(shows('.toolbar')).toBe(false);
    // The same element: no second popover, no second landing.
    expect(box()).toBe(before);
    expect(anchor()).toEqual({ left: '50px', top: '60px', width: '0px', height: '0px' });

    host.dialog().open.set(false);
    await settle();
    expect(shows('.toolbar')).toBe(true);
    expect(box()).toBe(before);
    expect(anchor()).toEqual({ left: '10px', top: '20px', width: '30px', height: '40px' });
  });

  it('within a layer, the panel that opened last is up; one that closes gives way', async () => {
    host.first().open.set(true);
    await settle();
    host.second().open.set(true);
    await settle();
    expect(box()!.textContent).toContain('second');

    host.second().open.set(false);
    await settle();
    expect(box()!.textContent).toContain('first');

    // Both up, the first opened later: it is the one shown.
    host.first().open.set(false);
    host.second().open.set(true);
    await settle();
    host.first().open.set(true);
    await settle();
    expect(box()!.textContent).toContain('first');
  });

  it('follows its panel: the content changes in place, and the box moves with the anchor', async () => {
    host.first().open.set(true);
    await settle();
    const outlet = fixture.debugElement.query(By.directive(PopoverOutlet)).componentInstance;
    const overlay: CdkConnectedOverlay = outlet.overlay();
    const placed = vi.spyOn(overlay.overlayRef!, 'updatePosition');
    const before = box();

    host.first().words.set('two');
    await settle();
    expect(box()).toBe(before);
    expect(box()!.textContent).toContain('first two');

    host.first().anchor.set({ left: 11, top: 22, width: 33, height: 44 });
    await settle();
    expect(anchor()).toEqual({ left: '11px', top: '22px', width: '33px', height: '44px' });
    expect(placed).toHaveBeenCalled();

    // An equal box is no move.
    placed.mockClear();
    host.first().anchor.set({ left: 11, top: 22, width: 33, height: 44 });
    await settle();
    expect(placed).not.toHaveBeenCalled();
  });

  it('a panel’s own view query sees its content while it is up — a menu can hand out its element', async () => {
    expect(host.first().menu()).toBeUndefined();
    host.first().open.set(true);
    await settle();
    expect(host.first().menu()?.nativeElement.textContent).toContain('first');
    expect(document.contains(host.first().menu()!.nativeElement)).toBe(true);
    host.first().open.set(false);
    await settle();
    expect(host.first().menu()).toBeUndefined();
  });

  it('keys and clicks outside reach the panel that is up, and only it', async () => {
    host.first().open.set(true);
    host.dialog().open.set(true);
    await settle();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.dialog().keys).toEqual(['Escape']);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.dialog().outside).toHaveBeenCalledTimes(1);

    // A click inside is no click outside.
    box()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.dialog().outside).toHaveBeenCalledTimes(1);

    // Escape does not detach the popover behind the panel's back.
    expect(shows('.dialog')).toBe(true);
  });

  it('exposes its element while up, for a press-outside test', async () => {
    const popover = fixture.debugElement.query(By.directive(PopoverOutlet)).injector.get(Popover);
    expect(popover.pane()).toBeNull();
    host.dialog().open.set(true);
    await settle();
    expect(popover.pane()?.contains(box())).toBe(true);
  });
});
