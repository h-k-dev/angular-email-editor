/**
 * The template designer's desk, in real Chromium — `npm run test:render`
 * (jsdom has no layout): three panes, VS Code's — the details, the editor,
 * the preview — the sides dragged by their dividers, the editor a window
 * 8px off the desk that never holds less than a phone's 375px; the left
 * column's tabs on a rail of their own, there always; details
 * the desk is too narrow for float over the editor, a phone it is too
 * narrow for is a tab beside the editor's; an email wider than its column
 * is scrolled by the editor pane, both ways, alone.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { page, userEvent } from 'vitest/browser';

import { TemplateDesigner } from './template-designer';

/** A fixed-width template: one table 2000px wide, wider than any desk. */
const WIDE = {
  id: 'wide',
  name: 'Wide',
  dialect: 'angularjs',
  html: '<table width="2000" style="width: 2000px"><tbody><tr><td>Statement</td></tr></tbody></table>',
};

/** An email that wraps: its column narrows with the editor. */
const PLAIN = {
  ...WIDE,
  id: 'plain',
  html: '<p>Hello there — a friendly reminder that we have an upcoming appointment.</p>',
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

  /** Opens the designer on a desk this wide, once its editor has drawn the
      email (the wide ones' tables, unless said otherwise). */
  const open = async (
    deskWidth: number,
    template: object = WIDE,
    drawn = () => expect(el('.designer-canvas').scrollWidth).toBeGreaterThan(2000),
  ) => {
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
      drawn();
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

  it('opens the details on the rows, no heading, the files on a drop zone', async () => {
    await open(1600);
    expect(host().querySelectorAll('.designer-details h2')).toHaveLength(0);
    expect(el('.designer-envelope').firstElementChild!.hasAttribute('envelope-rows')).toBe(true);
    expect(el('.designer-files .designer-zone').tagName).toBe('BUTTON');
    expect(
      host().querySelector('.designer-details input[type="file"][accept=".eml,message/rfc822"]'),
    ).toBeNull();
  });

  it('opens an email to study from the ⋮ on the left, its first item', async () => {
    await open(1600);
    // Third on the left: close, the side panel, the ⋮ — none on the right.
    const start = Array.from(
      host().querySelectorAll<HTMLElement>('.designer-bar__start > button'),
    ).map((button) => button.getAttribute('aria-label'));
    expect(start).toEqual(['Close', 'Side panel', 'More']);
    expect(host().querySelector('.designer-bar__end input[type="file"]')).toBeNull();
    // The paper, the phone, the formatting and the layout in one module —
    // no outline of the paper's own.
    const editing = Array.from(
      el('.designer-bar__end > [glassGroup][aria-label="Editing"]').querySelectorAll('button'),
    ).map((button) => button.getAttribute('aria-label'));
    expect(editing.slice(1)).toEqual(['Phone preview', 'Formatting options', 'Layout']);
    expect(el('.designer-bar__end > [glassGroup] > paper-toggle')).not.toBeNull();
    expect(host().querySelector('.designer-bar [glassGroup="outline"]')).toBeNull();
    expect(host().querySelectorAll('.designer-bar__end > div[glassGroup]').length).toBe(1);
    expect(
      el('.designer-bar button[aria-label="Revert to saved"]').nextElementSibling!.tagName,
    ).toBe('MESSAGE-SETTINGS-BUTTON');

    // Its first item picks an .eml.
    const picker = el('.designer-bar__start > input[type="file"]') as HTMLInputElement;
    expect(picker.getAttribute('accept')).toBe('.eml,message/rfc822');
    const picked = vi.spyOn(picker, 'click').mockImplementation(() => undefined);
    el('.designer-bar button[aria-label="More"]').click();
    let first!: HTMLElement;
    await vi.waitFor(async () => {
      await settle();
      first = document.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]')!;
      expect(first).not.toBeNull();
    });
    expect(first.textContent!.trim()).toBe('Import EML');
    first.click();
    await settle();
    expect(picked).toHaveBeenCalledOnce();
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
    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    // The editor stays: the source is in the left column, not its place.
    expect(host().getAttribute('data-view')).toBe('editor');
    expect(host().getAttribute('data-details')).toBe('docked');
    const source = el('section[html-email-compose]');
    expect(source.closest('.designer-details')).toBe(el('.designer-details'));
    // The column as wide as the source's default, the editor what is left.
    expect(width('.designer-details')).toBe(640);
    expect(width('.designer-canvas')).toBe(1600 - 40 - 640 - 16);

    // Two tabs down the left edge, the source picked as it came in; its
    // window the column's whole height, flush with the desk's top, 8px off its foot, the tabs beside.
    const tabs = Array.from(host().querySelectorAll<HTMLElement>('.designer-tab'));
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(el('.designer-tabs').getAttribute('aria-orientation')).toBe('vertical');
    expect(el('.designer-envelope').hidden).toBe(true);
    const desk = el('.designer-body').getBoundingClientRect();
    const box = source.getBoundingClientRect();
    const rail = el('.designer-tabs').getBoundingClientRect();
    expect([box.top - desk.top, desk.bottom - box.bottom]).toEqual([0, 8]);
    expect(rail.width).toBe(40);
    expect(rail.left).toBe(desk.left);
    expect(box.left).toBe(rail.right);

    // The details' tab: the rows, the source put away — the column the
    // details' width again, the rail where it was.
    tabs[0].click();
    await settle();
    expect(el('.designer-envelope').hidden).toBe(false);
    expect(el('.designer-source').hidden).toBe(true);
    expect(host().getAttribute('data-source')).toBeNull();
    expect(el('.designer-envelope').firstElementChild!.hasAttribute('envelope-rows')).toBe(true);
    expect(width('.designer-details')).toBe(420);
    expect(el('.designer-tabs').getBoundingClientRect().left).toBe(desk.left);
    // The keys: down moves on, wrapping round; the focus with it.
    key(tabs[0], 'ArrowDown');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    key(tabs[1], 'ArrowDown');
    await settle();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(host().getAttribute('data-source')).toBeNull();

    // The details folded with the source out: the source alone, the tabs
    // kept on their rail.
    tabs[1].click();
    fixture.componentInstance['detailsOpen'].set(false);
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    expect(host().querySelectorAll('.designer-tabs[data-side="aside"] .designer-tab')).toHaveLength(
      2,
    );
    expect(el('.designer-source').hidden).toBe(false);
    expect(source.getBoundingClientRect().left - desk.left).toBe(40);
  });

  it('makes the HTML source the first time it is asked for, and keeps it — no </> in the bar', async () => {
    await open(1600);
    expect(host().querySelector('.designer-bar button[aria-label="HTML source"]')).toBeNull();
    // Nothing of it until its tab is pressed.
    expect(host().querySelector('section[html-email-compose]')).toBeNull();
    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    const source = el('section[html-email-compose]');
    // Put away, it stays made: the same node when it comes back.
    fixture.componentInstance['pickAside']('envelope');
    await settle();
    expect(el('section[html-email-compose]')).toBe(source);
    fixture.componentInstance['pickAside']('source');
    await settle();
    expect(el('section[html-email-compose]')).toBe(source);
  });

  it('gives the HTML source a paper of its own, from a toggle in the head row over its lines', async () => {
    await open(1600);
    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    const source = el('section[html-email-compose]');
    const designer = host().getAttribute('data-paper-scheme')!;
    const other = designer === 'dark' ? 'light' : 'dark';
    // At first, the designer's own.
    expect(source.getAttribute('data-paper-scheme')).toBe(designer);

    // The head: a row a tab's 32px, flush with the pane's top, edge to
    // edge, the lines under it; the 28px toggle at its end, centred in it.
    const head = el('.designer-source__head').getBoundingClientRect();
    const pane = source.getBoundingClientRect();
    expect(head.top).toBeCloseTo(pane.top, 0);
    expect(head.height).toBe(el('.designer-tab').getBoundingClientRect().height);
    expect(head.height).toBe(32);
    expect(head.left).toBeCloseTo(pane.left, 0);
    const first = source.querySelector<HTMLElement>('[data-line]')!.getBoundingClientRect();
    expect(first.top).toBeGreaterThanOrEqual(head.bottom - 0.5);
    const toggle = el('.designer-scheme__toggle');
    const box = toggle.getBoundingClientRect();
    expect(box.width).toBe(28);
    expect(box.top + box.height / 2).toBeCloseTo(head.top + 16, 0);
    expect(head.right - box.right).toBeCloseTo(2, 0);

    // Shown only while the pointer is over the head.
    expect(getComputedStyle(toggle).opacity).toBe('0');
    await userEvent.hover(el('.designer-source__head'));
    await vi.waitFor(() => expect(getComputedStyle(toggle).opacity).toBe('1'));

    // A press: the other paper, the source's alone.
    await userEvent.click(toggle);
    await settle();
    expect(source.getAttribute('data-paper-scheme')).toBe(other);
    expect(host().getAttribute('data-paper-scheme')).toBe(designer);

    // On the toggle, its menu: the three, the pick ticked.
    const menu = el('.designer-scheme__menu');
    await vi.waitFor(() => expect(getComputedStyle(menu).visibility).toBe('visible'));
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(items.map((item) => item.firstChild!.textContent!.trim())).toEqual([
      'Same as the designer',
      'Light',
      'Dark',
    ]);
    expect(
      items.find((item) => item.getAttribute('aria-checked') === 'true')!.textContent,
    ).toContain(other === 'dark' ? 'Dark' : 'Light');

    // A pick: the designer's again, and the menu goes — the hand still on it.
    await userEvent.click(items[0]);
    await settle();
    expect(source.getAttribute('data-paper-scheme')).toBe(designer);
    await vi.waitFor(() => expect(getComputedStyle(menu).visibility).toBe('hidden'));
    // Back once the hand has left and come again.
    await userEvent.hover(el('.designer-canvas'));
    await userEvent.hover(toggle);
    await vi.waitFor(() => expect(getComputedStyle(menu).visibility).toBe('visible'));
  });

  it('keeps the left tabs on their rail, a press switching panels — never folding one', async () => {
    await open(1600);
    const tab = (id: string) => el(`#designer-tab-${id}`);
    // Under the bar's close button, to the pixel.
    const middle = (box: DOMRect) => (box.left + box.right) / 2;
    const close = el('.designer-bar button[aria-label="Close"]').getBoundingClientRect();
    expect(middle(tab('envelope').getBoundingClientRect())).toBe(middle(close));
    // Both a 28px state, pressed anywhere in 32px.
    expect(close.width).toBe(28);
    const envelope = tab('envelope');
    expect(envelope.getBoundingClientRect().width).toBe(32);
    expect(envelope.clientWidth - 2 * parseFloat(getComputedStyle(envelope).paddingLeft)).toBe(28);
    const touch = el('.designer-bar button[aria-label="Close"] .mat-mdc-button-touch-target');
    expect(touch.getBoundingClientRect().width).toBe(32);
    // The bar as tall as the rail is wide: close 6px off the bar's top and
    // foot, as the tabs' 28px are 6px off the rail's sides — the desk 6px
    // under it.
    const bar = el('.designer-bar').getBoundingClientRect();
    const rail = el('.designer-tabs').getBoundingClientRect();
    expect(bar.height).toBe(rail.width);
    expect(bar.height).toBe(40);
    expect([close.top - bar.top, bar.bottom - close.bottom]).toEqual([6, 6]);
    expect(el('.designer-body').getBoundingClientRect().top - close.bottom).toBe(6);
    // Save the same: 28px, 6px off the bar's top and foot.
    const save = el('.designer-bar__save').getBoundingClientRect();
    expect(save.height).toBe(28);
    expect([save.top - bar.top, bar.bottom - save.bottom]).toEqual([6, 6]);
    expect(bar.right - save.right).toBe(12);
    expect(envelope.getBoundingClientRect().left + 2 - rail.left).toBe(6);
    // Level with From, the row the details open on.
    const level = (box: DOMRect) => (box.top + box.bottom) / 2;
    const from = el('.designer-details .writer-field [email-address-input]');
    expect(level(tab('envelope').getBoundingClientRect())).toBe(
      level(from.getBoundingClientRect()),
    );

    // The source's tab opens the source beside the editor, picked.
    tab('source').click();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    expect(tab('source').getAttribute('aria-selected')).toBe('true');
    // Pressed again: still there.
    tab('source').click();
    await settle();
    expect(host().getAttribute('data-source')).toBe('docked');
    expect(el('.designer-source').hidden).toBe(false);
    // The details' tab: the rows, the source put away.
    tab('envelope').click();
    await settle();
    expect(el('.designer-envelope').hidden).toBe(false);
    expect(host().getAttribute('data-source')).toBeNull();
    tab('envelope').click();
    await settle();
    expect(el('.designer-envelope').hidden).toBe(false);

    // Folded from the bar: the rail alone, nothing picked, the first tab
    // the way back in.
    el('.designer-bar button[aria-controls="designer-details"]').click();
    await settle();
    expect(host().getAttribute('data-details')).toBe('folded');
    expect(width('.designer-canvas')).toBe(1600 - 40 - 16);
    expect(tab('envelope').getAttribute('aria-selected')).toBe('false');
    expect(tab('envelope').getAttribute('tabindex')).toBe('0');
    tab('envelope').click();
    await settle();
    expect(host().getAttribute('data-details')).toBe('docked');
  });

  it('lays out HTML, editor and phone side by side on a wide desk', async () => {
    await open(1920);
    fixture.componentInstance['phoneOpen'].set(true);
    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    expect(host().getAttribute('data-preview')).toBe('docked');
    const phone = el('.designer-phone').getBoundingClientRect();
    const canvas = el('.designer-canvas').getBoundingClientRect();
    const source = el('section[html-email-compose]').getBoundingClientRect();
    expect(source.right).toBeLessThanOrEqual(canvas.left);
    expect(canvas.right).toBeLessThanOrEqual(phone.left);
    expect(canvas.width).toBeGreaterThanOrEqual(375);
    expect(host().hasAttribute('data-stage')).toBe(false);

    // Narrower than all three at their least: the phone gives way first —
    // a tab beside the editor's, down the desk's right edge — and the
    // source keeps its place beside the editor.
    await page.viewport(1280, 800);
    fixture.componentInstance['measureDesk']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-preview')).toBe('tabbed');
    });
    expect(host().getAttribute('data-source')).toBe('docked');
    expect(host().getAttribute('data-view')).toBe('editor');
    expect(host().getAttribute('data-details')).toBe('docked');
    // The editor's tab picked: the work stays in sight.
    expect(host().getAttribute('data-stage')).toBe('editor');
    const desk = el('.designer-body').getBoundingClientRect();
    const rail = el('.designer-tabs[data-side="stage"]').getBoundingClientRect();
    expect(rail.width).toBe(40);
    expect(rail.right).toBe(desk.right);
    expect(getComputedStyle(el('.designer-phone')).visibility).toBe('hidden');
    expect(getComputedStyle(el('.designer-canvas')).visibility).toBe('visible');
    expect(el('.designer-canvas').getBoundingClientRect().right).toBe(rail.left - 8);

    // The phone's tab: the phone in the editor's place, the editor kept.
    const [editorTab, phoneTab] = Array.from(
      host().querySelectorAll<HTMLElement>('.designer-tabs[data-side="stage"] .designer-tab'),
    );
    phoneTab.click();
    await settle();
    expect(host().getAttribute('data-stage')).toBe('phone');
    expect(getComputedStyle(el('.designer-phone')).visibility).toBe('visible');
    expect(getComputedStyle(el('.designer-canvas')).visibility).toBe('hidden');
    expect(el('.designer-canvas').inert).toBe(true);
    const room = el('.designer-phone').getBoundingClientRect();
    expect(room.left).toBe(el('.designer-details').getBoundingClientRect().right);
    expect(room.right).toBe(rail.left);
    // The keys: down wraps round to the editor, the focus with it.
    key(phoneTab, 'ArrowDown');
    await settle();
    expect(host().getAttribute('data-stage')).toBe('editor');
    expect(document.activeElement).toBe(editorTab);

    // Wide again: the phone has its pane back, no tabs on the right.
    await page.viewport(1920, 800);
    fixture.componentInstance['measureDesk']();
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-preview')).toBe('docked');
    });
    expect(host().querySelector('.designer-tabs[data-side="stage"]')).toBeNull();
  });

  it('opens the phone onto its tab where the desk has no pane for it', async () => {
    await open(1100);
    fixture.componentInstance['togglePhone']();
    await settle();
    expect(host().getAttribute('data-preview')).toBe('tabbed');
    expect(host().getAttribute('data-stage')).toBe('phone');
    // The rail takes its room beside the editor's and the details'.
    expect(host().getAttribute('data-details')).toBe('docked');
    expect(width('.designer-canvas')).toBe(1100 - 40 - 420 - 16 - 40);
  });

  it('puts the HTML source in the editor’s place where the desk is too narrow for both', async () => {
    // Short of the editor's least and the source's beside the rail.
    await open(900);
    fixture.componentInstance['pickAside']('source');
    const canvas = el('.designer-canvas');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-view')).toBe('html');
      expect(width('section[html-email-compose]')).toBe(canvas.clientWidth);
    });
    expect(host().getAttribute('data-source')).toBeNull();
    // Its tab lit while it stands in the editor's place.
    expect(el('#designer-tab-source').getAttribute('aria-selected')).toBe('true');
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

  it('brings the editor back from code view at the details’ tab', async () => {
    await open(900);
    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-view')).toBe('html');
    });
    el('#designer-tab-envelope').click();
    await settle();
    expect(host().getAttribute('data-view')).toBe('editor');
    expect(el('#designer-tab-envelope').getAttribute('aria-selected')).toBe('true');
  });

  it('folds the details away: no column, the editor has the desk', async () => {
    await open(1600);
    fixture.componentInstance['detailsOpen'].set(false);
    await settle();
    expect(host().getAttribute('data-details')).toBe('folded');
    expect(width('.designer-canvas')).toBe(1600 - 40 - 16);
    expect(getComputedStyle(el('.designer-details')).display).toBe('none');
  });

  it('draws the dividers’ hairline — clear beside the HTML source alone', async () => {
    await open(1700);
    fixture.componentInstance['togglePhone']();
    await settle();
    const line = (selector: string) => getComputedStyle(el(selector), '::before').backgroundImage;
    expect(line('.designer-divider--details')).not.toBe('none');
    expect(line('.designer-divider--preview')).not.toBe('none');

    // The source beside the editor: its window's own edges part them.
    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    expect(line('.designer-divider--details')).toBe('none');
    expect(getComputedStyle(el('.designer-divider--details'), '::after').backgroundImage).not.toBe(
      'none',
    );
    expect(line('.designer-divider--preview')).not.toBe('none');
  });

  it('drags a divider with nothing spilling out of its pane — no scrollbar anywhere', async () => {
    await open(1600);
    fixture.componentInstance['pickAside']('source');
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
    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });
    // 40svh of the 800px screen.
    expect(await roomUnderLastLine()).toBeCloseTo(320, 0);
  });

  it('lets the toolbar span the window over the HTML in the editor’s place', async () => {
    await open(900);
    fixture.componentInstance['formattingOpen'].set(true);
    await settle();
    const toolbar = () => el('[formatting-toolbar]').getBoundingClientRect().width;
    expect(toolbar()).toBeLessThanOrEqual(720);

    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-view')).toBe('html');
    });
    expect(toolbar()).toBe(el('.designer-canvas').clientWidth);
  });

  it('folds the column from the toggle beside close, the name in the bar’s middle', async () => {
    await open(1600);
    fixture.componentInstance['pickAside']('source');
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-source')).toBe('docked');
    });

    // Right of the close button; the name centred in the bar.
    const close = el('.designer-bar button[aria-label="Close"]');
    const toggle = close.nextElementSibling as HTMLElement;
    expect(toggle.getAttribute('aria-controls')).toBe('designer-details');
    expect(toggle.getAttribute('aria-label')).toBe('Side panel');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent!.trim()).toBe('left_panel_close');
    // Never lit: no pressed state, the glyph says it.
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);
    const look = getComputedStyle(toggle).backgroundColor;
    expect(look).toBe(getComputedStyle(close).backgroundColor);
    expect(
      host().querySelector('.designer-tabs button[aria-controls="designer-details"]'),
    ).toBeNull();
    const middle = (box: DOMRect) => (box.left + box.right) / 2;
    expect(middle(el('.designer-bar__title').getBoundingClientRect())).toBeCloseTo(
      middle(el('.designer-bar').getBoundingClientRect()),
      0,
    );

    // Folded: the source put away with it, the rail kept.
    toggle.click();
    await settle();
    expect(host().getAttribute('data-details')).toBe('folded');
    expect(host().getAttribute('data-source')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(getComputedStyle(toggle).backgroundColor).toBe(look);
    expect(toggle.textContent!.trim()).toBe('left_panel_open');
    expect(el('.designer-tabs').getBoundingClientRect().width).toBe(40);

    // Open again: on the details.
    toggle.click();
    await settle();
    expect(host().getAttribute('data-details')).toBe('docked');
    expect(el('.designer-envelope').hidden).toBe(false);
  });

  it('never lets a divider take the editor’s window under a phone’s 375px', async () => {
    // Wide enough for the details to push beside the phone's pane.
    await open(1700);
    fixture.componentInstance['phoneOpen'].set(true);
    await settle();
    expect(host().getAttribute('data-preview')).toBe('docked');

    // The column alone: the window has no outline of its own.
    key(el('.designer-divider--details'), 'End');
    await settle();
    expect(width('.designer-canvas')).toBe(375);

    key(el('.designer-divider--details'), 'Home');
    await settle();
    key(el('.designer-divider--preview'), 'End');
    await settle();
    expect(width('.designer-canvas')).toBe(375);
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

  it('keeps the details their room down to the editor’s least', async () => {
    // Room for the details' least beside the editor's — no more.
    await open(800);
    expect(host().getAttribute('data-details')).toBe('docked');
    // The details take what the editor's 375px leaves.
    expect(width('.designer-canvas')).toBe(375);
    expect(width('.designer-details')).toBe(800 - 40 - 375 - 16);
  });

  it('narrows the email’s column with the editor, down to a phone’s — nothing to scroll sideways', async () => {
    await open(800, PLAIN, () => expect(el('.designer-paper .ProseMirror')).not.toBeNull());
    const canvas = el('.designer-canvas');
    expect(width('.designer-paper')).toBe(375);
    expect(canvas.scrollWidth).toBe(canvas.clientWidth);

    // Wider again: back to the email's 720px, centred.
    await page.viewport(1600, 800);
    fixture.componentInstance['measureDesk']();
    await vi.waitFor(async () => {
      await settle();
      expect(width('.designer-paper')).toBe(720);
    });
  });

  it('floats the details over the editor where the desk is too narrow, flush with the rail, edged off the email', async () => {
    await open(700);
    expect(host().getAttribute('data-details')).toBe('over');
    // The window keeps the desk's width beside the rail: nothing pushed aside.
    expect(width('.designer-canvas')).toBe(700 - 40 - 16);
    const details = getComputedStyle(el('.designer-details'));
    expect(details.position).toBe('absolute');
    // One paper: no shadow, a hairline where they meet the editor.
    expect(details.boxShadow).toBe('none');
    expect(details.borderInlineEndWidth).toBe('1px');
    // As wide as they were dragged — the desk is their box, not their track
    // — and its whole height, flush with the rail.
    expect(width('.designer-details')).toBe(420);
    const desk = el('.designer-body').getBoundingClientRect();
    const panel = el('.designer-details').getBoundingClientRect();
    expect([panel.top - desk.top, desk.bottom - panel.bottom, panel.left - desk.left]).toEqual([
      0, 0, 40,
    ]);
    expect(host().querySelector('.designer-divider')).toBeNull();
  });
});
