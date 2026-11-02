/**
 * The template designer's desk, in real Chromium — `npm run test:render`
 * (jsdom has no layout): three panes, VS Code's — the preview, the editor,
 * the details — the sides dragged by their dividers, the editor a window
 * 8px off the desk that never holds less than the email's 720px; a side the
 * desk is too narrow for floats over the editor; an email wider than its
 * column is scrolled by the editor pane, both ways, alone.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { page } from 'vitest/browser';

import { TemplateDesigner } from './template-designer';

/** A fixed-width template: one table 2000px wide, wider than any desk. */
const WIDE = {
  id: 'wide',
  name: 'Wide',
  dialect: 'angularjs',
  html: '<table width="2000" style="width: 2000px"><tbody><tr><td>Statement</td></tr></tbody></table>',
};

/** A poorly written one, as Poor Fix Width is: a fixed-layout table that
    says 1200px — its min-content, whatever it holds — round a table its
    no-wrap line draws far wider. */
const OVERFLOWING = {
  ...WIDE,
  id: 'overflowing',
  html:
    '<table width="1200" style="width: 1200px; table-layout: fixed"><tbody><tr><td>' +
    '<table><tbody><tr>' +
    `<td style="white-space: nowrap">Verwendungszweck: ${'B'.repeat(240)}</td>` +
    '</tr></tbody></table>' +
    '</td></tr></tbody></table>',
};

describe('TemplateDesigner desk (render)', () => {
  let fixture: ComponentFixture<TemplateDesigner>;

  const host = () => fixture.nativeElement as HTMLElement;
  const el = (selector: string) => host().querySelector<HTMLElement>(selector)!;
  const width = (selector: string) => el(selector).getBoundingClientRect().width;
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const settle = async () => {
    await fixture.whenStable();
    await frame();
  };
  const key = (handle: HTMLElement, key: string) =>
    handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  const open = async (deskWidth: number, template: object = WIDE) => {
    await page.viewport(deskWidth, 800);
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { template } },
        { provide: MatDialogRef, useValue: { disableClose: false, close: () => undefined } },
      ],
    });
    fixture = TestBed.createComponent(TemplateDesigner);
    host().style.cssText = 'display: grid; position: fixed; inset: 0';
    document.body.append(host());
    await vi.waitFor(async () => {
      await settle();
      expect(el('.designer-canvas').scrollWidth).toBeGreaterThan(2000);
    });
  };

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    host().remove();
    localStorage.clear();
  });

  it('docks the details beside the editor, and scrolls a wide email in the editor alone', async () => {
    await open(1600);
    expect(host().getAttribute('data-details')).toBe('docked');
    expect(width('.designer-details')).toBe(420);
    // The column as wide as the email: the editor pane scrolls it.
    expect(width('.designer-paper')).toBeGreaterThanOrEqual(2000);
    const canvas = el('.designer-canvas');
    expect(canvas.scrollWidth).toBeGreaterThan(canvas.clientWidth);
    expect(document.scrollingElement!.scrollWidth).toBe(window.innerWidth);
    expect(el('.designer-details').scrollWidth).toBe(el('.designer-details').clientWidth);
  });

  it('opens the details on the rows, no heading, the files on a drop zone — the email to study in the bar', async () => {
    await open(1600);
    expect(host().querySelectorAll('.designer-details h2')).toHaveLength(0);
    expect(el('.designer-envelope').firstElementChild!.hasAttribute('envelope-rows')).toBe(true);
    expect(el('.designer-files .designer-zone').tagName).toBe('BUTTON');
    // The email to study is the bar's, between Revert and the gear, its
    // picker for an .eml.
    const picker = el('.designer-bar > input[type="file"]');
    expect(picker.getAttribute('accept')).toBe('.eml,message/rfc822');
    const study = picker.previousElementSibling!;
    expect(study.getAttribute('aria-label')).toBe('Open an email as the design');
    expect(study.previousElementSibling!.getAttribute('aria-label')).toBe('Revert to saved');
    expect(picker.nextElementSibling!.tagName.toLowerCase()).toBe('message-settings-button');
    expect(
      host().querySelector('.designer-details input[type="file"][accept=".eml,message/rfc822"]'),
    ).toBeNull();
  });

  it('labels To as From is, at rest too, on the same lines', async () => {
    await open(1600);
    const [from, to] = Array.from(
      host().querySelectorAll<HTMLElement>('.designer-details .writer-field'),
    );
    const label = (row: HTMLElement) => row.querySelector<HTMLElement>('.writer-field__label')!;
    const control = (row: HTMLElement) => row.querySelector<HTMLElement>('[email-address-input]')!;
    expect(label(to).textContent!.trim()).toBe('To');
    expect(to.contains(document.activeElement)).toBe(false);
    expect(label(to).getBoundingClientRect().width).toBeGreaterThan(1);
    expect(label(to).getBoundingClientRect().left).toBe(label(from).getBoundingClientRect().left);
    expect(control(to).getBoundingClientRect().left).toBe(
      control(from).getBoundingClientRect().left,
    );
  });

  it('keeps filled copies a row each, labelled — never merged into one line', async () => {
    await open(1600, {
      ...WIDE,
      envelope: {
        from: ['billing@example.com'],
        to: [],
        cc: ['accounts@example.com'],
        bcc: ['archive@example.com'],
        subject: '',
        previewText: '',
        attachments: [],
      },
    });
    expect(host().querySelector('.writer-recipients--merged')).toBeNull();
    const rows = Array.from(host().querySelectorAll<HTMLElement>('.designer-details .writer-field'))
      .filter((row) => row.getBoundingClientRect().height > 1)
      .map((row) => row.querySelector('.writer-field__label')?.textContent?.trim());
    expect(rows.slice(0, 4)).toEqual(['From', 'To', 'Cc', 'Bcc']);
  });

  it('docks the HTML source beside the editor, a tab beside the details, in a window of its own', async () => {
    await open(1600);
    fixture.componentInstance['toggleSource']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    // The editor stays: the source is in the right column, not its place.
    expect(host().getAttribute('data-view')).toBe('editor');
    expect(host().getAttribute('data-details')).toBe('docked');
    expect(host().hasAttribute('data-tabbed')).toBe(true);
    const source = el('section[html-email-compose]');
    expect(source.closest('.designer-details')).toBe(el('.designer-details'));
    // The column as wide as the source's default, the editor what is left.
    expect(width('.designer-details')).toBe(640);
    expect(width('.designer-canvas')).toBe(1600 - 640 - 16);

    // Two tabs down the right edge, the source picked as it came in; its
    // window the column's whole height, 8px off the desk, the tabs beside.
    const tabs = Array.from(host().querySelectorAll<HTMLElement>('.designer-tab'));
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(el('.designer-tabs').getAttribute('aria-orientation')).toBe('vertical');
    expect(el('.designer-envelope').hidden).toBe(true);
    const desk = el('.designer-body').getBoundingClientRect();
    const box = source.getBoundingClientRect();
    const rail = el('.designer-tabs').getBoundingClientRect();
    expect([box.top - desk.top, desk.bottom - box.bottom]).toEqual([8, 8]);
    expect(rail.width).toBe(44);
    expect(rail.right).toBe(desk.right);
    expect(box.right).toBe(rail.left);

    // The details' tab: the rows, the source out of sight.
    tabs[0].click();
    await settle();
    expect(el('.designer-envelope').hidden).toBe(false);
    expect(el('.designer-source').hidden).toBe(true);
    expect(el('.designer-envelope').firstElementChild!.hasAttribute('envelope-rows')).toBe(true);
    // The keys: down moves on, wrapping round; the focus with it.
    key(tabs[0], 'ArrowDown');
    await settle();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    key(tabs[1], 'ArrowDown');
    await settle();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    // The details folded: the source alone, no tabs.
    fixture.componentInstance['detailsOpen'].set(false);
    await settle();
    expect(host().hasAttribute('data-tabbed')).toBe(false);
    expect(host().querySelector('.designer-tabs')).toBeNull();
    expect(el('.designer-source').hidden).toBe(false);
    expect(desk.right - source.getBoundingClientRect().right).toBe(8);

    // Open again: the details come in picked.
    fixture.componentInstance['detailsOpen'].set(true);
    await settle();
    expect(el('.designer-envelope').hidden).toBe(false);

    // Put away: the column is the details' again.
    fixture.componentInstance['toggleSource']();
    await settle();
    expect(host().getAttribute('data-source')).toBeNull();
    expect(host().querySelector('.designer-tabs')).toBeNull();
    expect(width('.designer-details')).toBe(420);
  });

  it('lays out phone, editor and HTML side by side on a wide desk', async () => {
    await open(1920);
    fixture.componentInstance['phoneOpen'].set(true);
    fixture.componentInstance['toggleSource']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    expect(host().getAttribute('data-preview')).toBe('docked');
    const phone = el('.designer-phone').getBoundingClientRect();
    const canvas = el('.designer-canvas').getBoundingClientRect();
    const source = el('section[html-email-compose]').getBoundingClientRect();
    expect(phone.right).toBeLessThanOrEqual(canvas.left);
    expect(canvas.right).toBeLessThanOrEqual(source.left);
    expect(canvas.width).toBeGreaterThanOrEqual(720);

    // Narrower than all three at their least: the source takes the editor's
    // place, the phone keeps its pane, the envelope floats alone.
    await page.viewport(1600, 800);
    fixture.componentInstance['measureDesk']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-view')).toBe('html');
    });
    expect(host().getAttribute('data-source')).toBeNull();
    expect(host().getAttribute('data-preview')).toBe('docked');
    expect(host().getAttribute('data-details')).toBe('over');
    expect(host().querySelector('.designer-tabs')).toBeNull();
    expect(el('.designer-phone').getBoundingClientRect().right).toBeLessThanOrEqual(
      el('.designer-canvas').getBoundingClientRect().left,
    );
  });

  it('puts the HTML source in the editor’s place where the desk is too narrow for both', async () => {
    await open(1100);
    fixture.componentInstance['toggleSource']();
    const canvas = el('.designer-canvas');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-view')).toBe('html');
      expect(width('section[html-email-compose]')).toBe(canvas.clientWidth);
    });
    expect(host().getAttribute('data-source')).toBeNull();
    expect(host().querySelector('.designer-tabs')).toBeNull();
    // Nothing to scroll sideways: the code wraps in its own measure.
    expect(canvas.scrollWidth).toBe(canvas.clientWidth);

    // The window widened: the source moves beside the editor.
    await page.viewport(1600, 800);
    fixture.componentInstance['measureDesk']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    expect(host().getAttribute('data-view')).toBe('editor');
    expect(el('section[html-email-compose]').closest('.designer-source')).toBe(
      el('.designer-source'),
    );
  });

  it('folds the details away: no column, the editor has the desk', async () => {
    await open(1600);
    fixture.componentInstance['detailsOpen'].set(false);
    await settle();
    expect(host().getAttribute('data-details')).toBe('folded');
    expect(width('.designer-canvas')).toBe(1600 - 16);
    expect(getComputedStyle(el('.designer-details')).display).toBe('none');
  });

  it('drags a divider with nothing spilling out of its pane — no scrollbar anywhere', async () => {
    await open(1600);
    fixture.componentInstance['toggleSource']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    const overflowing = () =>
      [host(), el('.designer-body'), el('.designer-details')]
        .filter((box) => box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight)
        .map((box) => box.className || box.tagName);
    const pointer = (handle: HTMLElement, type: string, clientX: number) =>
      handle.dispatchEvent(
        new PointerEvent(type, { pointerId: 7, clientX, clientY: 300, bubbles: true, button: 0 }),
      );

    for (const [selector, by] of [
      ['.designer-divider--details', 200],
      ['.designer-divider--details', -200],
    ] as const) {
      const handle = el(selector);
      // A synthetic pointer is no live one to capture.
      handle.setPointerCapture = () => undefined;
      const x = handle.getBoundingClientRect().left + 4;
      pointer(handle, 'pointerdown', x);
      for (let step = 1; step <= 4; step++) {
        pointer(handle, 'pointermove', x + (by * step) / 4);
        await frame();
        await frame();
        expect(overflowing()).toEqual([]);
      }
      pointer(handle, 'pointerup', x + by);
      await settle();
      expect(overflowing()).toEqual([]);
    }
  });

  it('scrolls the docked source past its last line, as far as in the editor’s place', async () => {
    // Long enough to scroll: the pane's room under the last line must
    // follow the lines, not the pane's box (the editor root's `height: 100%`).
    const LONG = { ...WIDE, html: WIDE.html + '<p>line</p>'.repeat(150) };
    const roomUnderLastLine = async () => {
      const source = el('section[html-email-compose]');
      source.scrollTop = source.scrollHeight;
      await frame();
      const lines = source.querySelectorAll<HTMLElement>('[data-line]');
      const last = lines[lines.length - 1].getBoundingClientRect();
      return source.getBoundingClientRect().bottom - last.bottom;
    };

    await open(1600, LONG);
    fixture.componentInstance['toggleSource']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    // 40svh of the 800px screen.
    expect(await roomUnderLastLine()).toBeCloseTo(320, 0);
  });

  it('lets the toolbar span the window over the HTML in the editor’s place', async () => {
    await open(1100);
    fixture.componentInstance['formattingOpen'].set(true);
    await settle();
    const toolbar = () => el('[formatting-toolbar]').getBoundingClientRect().width;
    expect(toolbar()).toBeLessThanOrEqual(720);

    fixture.componentInstance['toggleSource']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-view')).toBe('html');
    });
    expect(toolbar()).toBe(el('.designer-canvas').clientWidth);
  });

  it('presses the details toggle while their panel is there, as the phone’s and the source’s are', async () => {
    await open(1600);
    const toggle = (label: string) => el(`.designer-bar button[aria-label="${label}"]`);
    const look = (button: HTMLElement) => {
      const style = getComputedStyle(button);
      return [style.color, style.backgroundColor];
    };
    fixture.componentInstance['phoneOpen'].set(true);
    fixture.componentInstance['toggleSource']();
    await settle();

    const details = toggle('Message details');
    expect(details.getAttribute('aria-pressed')).toBe('true');
    expect(look(details)).toEqual(look(toggle('Phone preview')));
    expect(look(details)).toEqual(look(toggle('HTML source')));

    details.click();
    await settle();
    expect(details.getAttribute('aria-pressed')).toBe('false');
    expect(look(details)).not.toEqual(look(toggle('Phone preview')));
  });

  it('never lets a divider take the editor’s window under the email’s 720px', async () => {
    // Wide enough for the details to push beside the phone's pane.
    await open(1700);
    fixture.componentInstance['phoneOpen'].set(true);
    await settle();
    expect(host().getAttribute('data-preview')).toBe('docked');

    // The column alone: the window has no outline of its own.
    key(el('.designer-divider--details'), 'End');
    await settle();
    expect(width('.designer-canvas')).toBe(720);

    key(el('.designer-divider--details'), 'Home');
    await settle();
    key(el('.designer-divider--preview'), 'End');
    await settle();
    expect(width('.designer-canvas')).toBe(720);
    expect(width('.designer-details')).toBe(320);
  });

  it('holds the paper to what an email really draws, past its tables’ own widths', async () => {
    await open(1600, OVERFLOWING);
    const canvas = el('.designer-canvas');
    // The no-wrap line draws far past the 1200px the table says it is.
    expect(canvas.scrollWidth).toBeGreaterThan(2000);
    // To the pixel: scrollWidth is rounded, the paper's width is not.
    expect(width('.designer-paper')).toBeGreaterThan(canvas.scrollWidth - 1);
  });

  it('keeps the formatting toolbar centred in the editor, at the column’s measure, however far it scrolls', async () => {
    await open(1600);
    fixture.componentInstance['formattingOpen'].set(true);
    await settle();
    const canvas = el('.designer-canvas');
    const toolbar = el('[formatting-toolbar]');
    const middle = (box: DOMRect) => (box.left + box.right) / 2;

    for (const left of [0, 500, canvas.scrollWidth]) {
      canvas.scrollLeft = left;
      await frame();
      const box = toolbar.getBoundingClientRect();
      expect(box.width).toBeLessThanOrEqual(720);
      expect(middle(box)).toBeCloseTo(middle(canvas.getBoundingClientRect()), 0);
    }
  });

  it('floats the details over the editor short of a wide desk, flush with its edge, edged off the email', async () => {
    // Room for the details beside the editor's least — but short of 1200.
    await open(1100);
    expect(host().getAttribute('data-details')).toBe('over');
    // The window keeps the desk's whole width, 8px off its edges: nothing
    // pushed aside.
    expect(width('.designer-canvas')).toBe(1100 - 16);
    const details = getComputedStyle(el('.designer-details'));
    expect(details.position).toBe('absolute');
    // One paper: no shadow, a hairline where they meet the editor.
    expect(details.boxShadow).toBe('none');
    expect(details.borderInlineStartWidth).toBe('1px');
    // As wide as they were dragged — the desk is their box, not their track
    // — and its whole height, flush with its edges.
    expect(width('.designer-details')).toBe(420);
    const desk = el('.designer-body').getBoundingClientRect();
    const panel = el('.designer-details').getBoundingClientRect();
    expect([panel.top - desk.top, desk.bottom - panel.bottom, desk.right - panel.right]).toEqual([
      0, 0, 0,
    ]);
    expect(host().querySelector('.designer-divider--details')).toBeNull();
  });

  it('floats a side over the editor where the desk is too narrow for it', async () => {
    await open(1000);
    expect(host().getAttribute('data-details')).toBe('over');
    expect(getComputedStyle(el('.designer-details')).position).toBe('absolute');
    expect(width('.designer-canvas')).toBe(1000 - 16);
    expect(host().querySelector('.designer-divider')).toBeNull();
  });
});
