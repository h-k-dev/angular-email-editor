import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComposeWindowFrame } from './compose-window';
import { ComposeWindow, ComposeWindowMode } from '../../../../core/email/compose-windows';
import { EMAIL_SEND_LATENCY } from '../../../../core/email/email-send';

// jsdom lacks what the editor measures with at mount (see compose.spec.ts).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
HTMLCanvasElement.prototype.getContext = (() => ({
  font: '',
  measureText: (text: string) => ({ width: text.length * 7 }),
})) as never;

beforeEach(() => localStorage.clear());

const windowState = (mode: ComposeWindowMode): ComposeWindow => ({
  id: 1,
  slot: 0,
  mode,
  pin: null,
  mobile: 'page',
  sheet: 'desktop',
  restored: null,
  focus: 'to',
  guard: null,
});

/** Ctrl-Enter, as the keyboard sends it, on `target`. */
const press = (target: EventTarget): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};

describe('ComposeWindowFrame: Ctrl-Enter', () => {
  let fixture: ComponentFixture<ComposeWindowFrame>;
  let requested: number;

  async function open(mode: ComposeWindowMode): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [ComposeWindowFrame],
      providers: [provideRouter([]), { provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    }).compileComponents();
    fixture = TestBed.createComponent(ComposeWindowFrame);
    fixture.componentRef.setInput('window', windowState(mode));
    await fixture.whenStable();
    const sheet = (fixture.componentInstance as any).sheet();
    requested = 0;
    vi.spyOn(sheet, 'requestSend').mockImplementation(() => requested++);
    return fixture.nativeElement as HTMLElement;
  }

  it('sends from anywhere in the docked window: a row, the title bar', async () => {
    const root = await open('docked');
    expect(press(root.querySelector('.writer-field__input')!).defaultPrevented).toBe(true);
    press(root.querySelector('.compose-window__title')!);
    expect(requested).toBe(2);
  });

  it('sends from the zoomed window as well', async () => {
    const root = await open('expanded');
    press(root.querySelector('.compose-window__title')!);
    expect(requested).toBe(1);
  });

  it('leaves the editor’s own Mod-Enter to it — one send, not two', async () => {
    const root = await open('docked');
    const pm = root.querySelector('[aria-label="Message body"]') as HTMLElement;
    expect(press(pm).defaultPrevented).toBe(true);
    // The editor's keymap claimed the key (and sent through the sheet's
    // `send`, which calls `requestSend` once); the frame added nothing.
    expect(requested).toBe(1);
  });

  it('sends nothing while minimized: the sheet is out of sight', async () => {
    const root = await open('minimized');
    const event = press(root.querySelector('.compose-window__title')!);
    expect(event.defaultPrevented).toBe(false);
    expect(requested).toBe(0);
  });
});
