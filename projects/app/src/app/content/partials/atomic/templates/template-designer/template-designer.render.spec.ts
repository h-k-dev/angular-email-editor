/**
 * The template designer's desk, in real Chromium — `npm run test:render`
 * (jsdom has no layout): three panes, VS Code's — the preview, the editor,
 * the details — the sides dragged by their dividers, the editor never under
 * 720px; a side the desk is too narrow for floats over the editor; an email
 * wider than its column is scrolled by the editor pane, both ways, alone.
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

  it('opens the details on the rows, no heading, the files on a drop zone', async () => {
    await open(1600);
    expect(host().querySelectorAll('.designer-details h2')).toHaveLength(0);
    expect(el('.designer-details').firstElementChild!.hasAttribute('envelope-rows')).toBe(true);
    expect(el('.designer-files__zone').tagName).toBe('BUTTON');
  });

  it('labels To as From is, at rest too, on the same lines', async () => {
    await open(1600);
    const [from, to] = Array.from(host().querySelectorAll<HTMLElement>('.designer-details .writer-field'));
    const label = (row: HTMLElement) => row.querySelector<HTMLElement>('.writer-field__label')!;
    const control = (row: HTMLElement) => row.querySelector<HTMLElement>('[email-address-input]')!;
    expect(label(to).textContent!.trim()).toBe('To');
    expect(to.contains(document.activeElement)).toBe(false);
    expect(label(to).getBoundingClientRect().width).toBeGreaterThan(1);
    expect(label(to).getBoundingClientRect().left).toBe(label(from).getBoundingClientRect().left);
    expect(control(to).getBoundingClientRect().left).toBe(control(from).getBoundingClientRect().left);
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

  it('keeps the HTML source to the column’s 720px, centred in the editor, whatever the pane', async () => {
    await open(1600);
    fixture.componentInstance['toggleSource']();
    const middle = (selector: string) => {
      const box = el(selector).getBoundingClientRect();
      return (box.left + box.right) / 2;
    };
    await vi.waitFor(async () => {
      await settle();
      expect(host().getAttribute('data-view')).toBe('html');
      expect(width('section[html-email-compose]')).toBe(720);
    });
    expect(middle('section[html-email-compose]')).toBeCloseTo(middle('.designer-canvas'), 0);

    // Folded details: a wider pane, the source as it was, still centred.
    fixture.componentInstance['detailsOpen'].set(false);
    await settle();
    expect(width('.designer-canvas')).toBeGreaterThan(1000);
    expect(width('section[html-email-compose]')).toBe(720);
    expect(middle('section[html-email-compose]')).toBeCloseTo(middle('.designer-canvas'), 0);
    // Nothing to scroll sideways: the code wraps in its own measure.
    const canvas = el('.designer-canvas');
    expect(canvas.scrollWidth).toBe(canvas.clientWidth);
  });

  it('never lets a divider take the editor under 720px', async () => {
    await open(1600);
    fixture.componentInstance['phoneOpen'].set(true);
    await settle();
    expect(host().getAttribute('data-preview')).toBe('docked');

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

  it('floats the details over the editor short of a wide desk, a Mac’s sidebar, raised off the email', async () => {
    // Room for the details beside the editor's 720px — but short of 1200.
    await open(1100);
    expect(host().getAttribute('data-details')).toBe('over');
    // The email keeps the desk's whole width: nothing pushed aside.
    expect(width('.designer-canvas')).toBe(1100);
    const details = getComputedStyle(el('.designer-details'));
    expect(details.position).toBe('absolute');
    expect(details.boxShadow).not.toBe('none');
    // As wide as they were dragged — the desk is their box, not their track
    // — and its whole height, 8px off the edges.
    expect(width('.designer-details')).toBe(420);
    const desk = el('.designer-body').getBoundingClientRect();
    const panel = el('.designer-details').getBoundingClientRect();
    expect([panel.top - desk.top, desk.bottom - panel.bottom, desk.right - panel.right]).toEqual([8, 8, 8]);
    expect(host().querySelector('.designer-divider--details')).toBeNull();
  });

  it('floats a side over the editor where the desk is too narrow for it', async () => {
    await open(1000);
    expect(host().getAttribute('data-details')).toBe('over');
    expect(getComputedStyle(el('.designer-details')).position).toBe('absolute');
    expect(width('.designer-canvas')).toBe(1000);
    expect(host().querySelector('.designer-divider')).toBeNull();
  });
});
