import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Directionality } from '@angular/cdk/bidi';

import { Grid, GridCell, GridRow, GridWidget } from './grid';

@Component({
  imports: [Grid, GridCell, GridRow, GridWidget],
  template: `
    <div grid [multi]="multi()" aria-label="Rows">
      @for (row of rows(); track row) {
        <div
          gridRow
          [selected]="picked().includes(row)"
          (selectedChange)="toggle(row)"
          [current]="row === open() ? 'page' : false"
          (activate)="activated.push(row)"
        >
          <div gridCell><input gridWidget type="checkbox" tabindex="-1" /></div>
          <div gridCell>{{ row }}</div>
          <div gridCell>
            <button gridWidget tabOnHover type="button" tabindex="-1">one</button>
            <button gridWidget tabOnHover type="button" tabindex="-1">two</button>
          </div>
        </div>
      }
    </div>
    <button type="button" class="after">after</button>
  `,
})
class Host {
  readonly rows = signal(['a', 'b', 'c']);
  readonly multi = signal(true);
  readonly open = signal<string | null>(null);
  readonly picked = signal<string[]>([]);
  readonly activated: string[] = [];

  toggle(row: string): void {
    this.picked.update((picked) =>
      picked.includes(row) ? picked.filter((p) => p !== row) : [...picked, row],
    );
  }
}

describe('Grid', () => {
  let root: HTMLElement;
  let host: Host;
  let rtl = false;

  const rows = () => [...root.querySelectorAll<HTMLElement>('[role="row"]')];
  const press = async (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    (document.activeElement as HTMLElement).dispatchEvent(event);
    await fixture.whenStable();
    return event;
  };
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;

  beforeEach(async () => {
    rtl = false;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Directionality,
          useValue: {
            get value() {
              return rtl ? 'rtl' : 'ltr';
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('is a grid of rows and cells, the first row the one tab stop', () => {
    const grid = root.querySelector('[grid]')!;
    expect(grid.getAttribute('role')).toBe('grid');
    expect(grid.getAttribute('aria-multiselectable')).toBe('true');
    expect(rows().map((row) => row.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(rows()[0].querySelectorAll('[role="gridcell"]')).toHaveLength(3);
    expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'false',
    ]);
  });

  it('starts at the current row, and says so', async () => {
    host.open.set('b');
    await fixture.whenStable();
    expect(rows()[1].getAttribute('aria-current')).toBe('page');
    expect(rows()[0].hasAttribute('aria-current')).toBe(false);
    expect(rows().map((row) => row.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('selects nothing, and says nothing of it, unless multi', async () => {
    host.multi.set(false);
    await fixture.whenStable();
    expect(root.querySelector('[grid]')!.hasAttribute('aria-multiselectable')).toBe(false);
    expect(rows()[0].hasAttribute('aria-selected')).toBe(false);
    rows()[0].focus();
    const space = await press(' ');
    expect(space.defaultPrevented).toBe(false);
    expect(host.picked()).toEqual([]);
  });

  it('walks the rows: arrows, Home, End — never past an end', async () => {
    rows()[0].focus();
    await press('ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);
    await press('End');
    expect(document.activeElement).toBe(rows()[2]);
    const down = await press('ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rows()[2]);
    await press('Home');
    expect(document.activeElement).toBe(rows()[0]);
    await press('ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('opens with Enter and ticks with Space, on the row alone', async () => {
    rows()[1].focus();
    await press('Enter');
    expect(host.activated).toEqual(['b']);
    await press(' ');
    expect(host.picked()).toEqual(['b']);
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');

    // On a widget the keys are the widget's own.
    rows()[1].querySelector('button')!.focus();
    const enter = await press('Enter');
    expect(enter.defaultPrevented).toBe(false);
    expect(host.activated).toEqual(['b']);
  });

  it('steps through a row’s shown widgets and back, mirrored right to left', async () => {
    const [box, one, two] = rows()[0].querySelectorAll<HTMLElement>('[gridWidget]');
    rows()[0].focus();
    await press('ArrowRight');
    expect(document.activeElement).toBe(box);
    await press('ArrowRight');
    expect(document.activeElement).toBe(one);
    await press('ArrowRight');
    expect(document.activeElement).toBe(two);
    await press('Home');
    expect(document.activeElement).toBe(box);
    await press('ArrowLeft');
    expect(document.activeElement).toBe(rows()[0]);

    rtl = true;
    await press('ArrowLeft');
    expect(document.activeElement).toBe(box);
    await press('ArrowRight');
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('skips a widget that is not shown', async () => {
    // The browser's own check (jsdom lays nothing out): a hover-only bar on
    // a touch screen.
    const [, one, two] = rows()[0].querySelectorAll<HTMLElement>('[gridWidget]');
    two.checkVisibility = () => false;
    one.focus();
    await press('End');
    expect(document.activeElement).toBe(one);
  });

  it('keeps the row focus was last in as the tab stop, and Tab leaves from a widget via its row', async () => {
    rows()[2].querySelector('input')!.focus();
    await fixture.whenStable();
    expect(rows().map((row) => row.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    const tab = await press('Tab');
    // The row takes focus; the browser's own Tab then goes on past the grid.
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(rows()[2]);
    await press('Escape');
    expect(document.activeElement).toBe(rows()[2]);
  });

  it('puts a row’s tabOnHover widgets in the Tab order while the pointer is on it', async () => {
    const tabs = (row: HTMLElement) =>
      [...row.querySelectorAll<HTMLElement>('[gridWidget]')].map((widget) => widget.tabIndex);
    expect(tabs(rows()[1])).toEqual([-1, -1, -1]);

    rows()[1].dispatchEvent(new PointerEvent('pointerenter'));
    await fixture.whenStable();
    // The buttons join; the checkbox, no tabOnHover, stays out — and so do
    // the other rows'.
    expect(tabs(rows()[1])).toEqual([-1, 0, 0]);
    expect(tabs(rows()[0])).toEqual([-1, -1, -1]);

    rows()[1].dispatchEvent(new PointerEvent('pointerleave'));
    await fixture.whenStable();
    expect(tabs(rows()[1])).toEqual([-1, -1, -1]);
  });

  it('keeps them in it while focus is on one, and lets the browser’s Tab walk them', async () => {
    const [, one, two] = rows()[1].querySelectorAll<HTMLElement>('[gridWidget]');
    rows()[1].dispatchEvent(new PointerEvent('pointerenter'));
    await fixture.whenStable();
    one.focus();
    rows()[1].dispatchEvent(new PointerEvent('pointerleave'));
    await fixture.whenStable();
    expect([one.tabIndex, two.tabIndex]).toEqual([0, 0]);

    const tab = await press('Tab');
    expect(tab.defaultPrevented).toBe(false);
    // Not sent back to its row: the page's own order goes on from here.
    expect(document.activeElement).toBe(one);

    // Back on the row: out of the order again.
    rows()[1].focus();
    await fixture.whenStable();
    expect([one.tabIndex, two.tabIndex]).toEqual([-1, -1]);
  });

  it('hands focus on when the focused row goes', async () => {
    rows()[1].querySelector('button')!.focus();
    host.rows.set(['a', 'c']);
    await fixture.whenStable();
    expect(document.activeElement).toBe(rows()[1]);
    expect(rows()[1].textContent).toContain('c');
    expect(rows()[1].getAttribute('tabindex')).toBe('0');
  });

  it('takes no focus back when it had left the grid', async () => {
    rows()[1].focus();
    root.querySelector<HTMLElement>('.after')!.focus();
    host.rows.set(['a', 'c']);
    await fixture.whenStable();
    expect(document.activeElement).toBe(root.querySelector('.after'));
  });
});
