import {
  Component,
  Injector,
  TemplateRef,
  ViewContainerRef,
  inject,
  viewChild,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScrollDispatcher } from '@angular/cdk/scrolling';
import {
  OverlayRef,
  createCloseScrollStrategy,
  createGlobalPositionStrategy,
  createOverlayRef,
} from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';

import { EveryScrollDispatcher, provideEveryScroll } from './scrolling';

/** A pane of the app's: scrolls, unmarked — no `cdkScrollable`. */
function pane(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

/** What a container's scroll fires: no bubbling, as a browser's. */
function scroll(target: EventTarget): void {
  target.dispatchEvent(new Event('scroll'));
}

@Component({ template: '<ng-template #menu><div class="menu"></div></ng-template>' })
class Host {
  readonly menu = viewChild.required<TemplateRef<unknown>>('menu');
  readonly injector = inject(Injector);
  readonly container = inject(ViewContainerRef);
}

describe('EveryScrollDispatcher', () => {
  const panes: HTMLElement[] = [];
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideEveryScroll()] }));
  afterEach(() => panes.splice(0).forEach((element) => element.remove()));

  it('stands in for the CDK dispatcher', () => {
    expect(TestBed.inject(ScrollDispatcher)).toBeInstanceOf(EveryScrollDispatcher);
  });

  it('hears an unmarked container scroll, and names it', () => {
    const element = pane();
    panes.push(element);
    const heard: unknown[] = [];
    const subscription = TestBed.inject(ScrollDispatcher)
      .scrolled(0)
      .subscribe((target) => heard.push(target?.getElementRef().nativeElement));
    scroll(element);
    scroll(document);
    subscription.unsubscribe();
    scroll(element);
    // The pane by name; the document's own as the CDK's — no target.
    expect(heard).toEqual([element, undefined]);
  });

  describe('with a close strategy', () => {
    let ref: OverlayRef;
    beforeEach(() => {
      const host = TestBed.createComponent(Host);
      host.detectChanges();
      const injector = host.componentInstance.injector;
      ref = createOverlayRef(injector, {
        positionStrategy: createGlobalPositionStrategy(injector),
        scrollStrategy: createCloseScrollStrategy(injector),
      });
      const { menu, container } = host.componentInstance;
      ref.attach(new TemplatePortal(menu(), container));
    });
    afterEach(() => ref.dispose());

    it('closes an overlay as a pane under it scrolls', () => {
      const element = pane();
      panes.push(element);
      expect(ref.hasAttached()).toBe(true);
      scroll(element);
      expect(ref.hasAttached()).toBe(false);
    });

    it('keeps it open while its own list scrolls', () => {
      scroll(ref.overlayElement.querySelector('.menu')!);
      expect(ref.hasAttached()).toBe(true);
    });
  });
});
