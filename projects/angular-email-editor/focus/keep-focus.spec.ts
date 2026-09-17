import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KeepFocus } from './keep-focus';

@Component({
  selector: 'div[host-tool]',
  template: '<button class="composed">tool</button>',
  hostDirectives: [KeepFocus],
})
class ComposedTool {}

@Component({
  imports: [KeepFocus, ComposedTool],
  template: `
    <div class="bar" [emailKeepFocus]="enabled()">
      <button class="tool"><span class="glyph">B</span></button>
      <input class="size" />
      <span class="readonly" contenteditable="false">fixed</span>
    </div>

    <div class="row" emailKeepFocus emailKeepFocusExcept="input, button, textarea">
      <label class="label">To</label>
      <button class="chip-remove">×</button>
    </div>

    <div class="all" emailKeepFocus emailKeepFocusExcept="">
      <input class="never" />
    </div>

    <div class="editable" contenteditable="true">
      <span class="widget" emailKeepFocus><button class="inside">tool</button></span>
    </div>

    <div host-tool></div>
  `,
})
class Host {
  readonly enabled = signal(true);
}

describe('KeepFocus', () => {
  let fixture: ComponentFixture<Host>;

  /** A press on `selector`; true when it was kept from taking focus. */
  const pressKept = (selector: string): boolean => {
    const target = (fixture.nativeElement as HTMLElement).querySelector(selector)!;
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('keeps a press on a tool — or anything inside it — from taking focus', () => {
    expect(pressKept('.tool')).toBe(true);
    expect(pressKept('.glyph')).toBe(true);
    expect(pressKept('.bar')).toBe(true);
  });

  it('lets text entry take focus: a field in a toolbar has to be typed in', () => {
    expect(pressKept('.size')).toBe(false);
  });

  it('does not take contenteditable="false" for text entry', () => {
    expect(pressKept('.readonly')).toBe(true);
  });

  it('takes the exceptions it is given', () => {
    expect(pressKept('.label')).toBe(true);
    expect(pressKept('.chip-remove')).toBe(false);
  });

  it('makes no exception when given none', () => {
    expect(pressKept('.never')).toBe(true);
  });

  it('only counts an exception inside itself, not one it stands in', () => {
    expect(pressKept('.inside')).toBe(true);
  });

  it('switches off', async () => {
    fixture.componentInstance.enabled.set(false);
    await fixture.whenStable();
    expect(pressKept('.tool')).toBe(false);
  });

  it('composes into a host’s own component through hostDirectives', () => {
    expect(pressKept('.composed')).toBe(true);
  });

  it('leaves the click alone', () => {
    const tool = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.tool')!;
    const clicked = vi.fn();
    tool.addEventListener('click', clicked);
    tool.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    tool.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
