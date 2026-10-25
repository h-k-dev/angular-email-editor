import { signal } from '@angular/core';
import { TextSelection } from 'prosemirror-state';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { emailPlainText, plainTextHTML } from '@h-k-dev/angular-email-editor';

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Compose } from './compose';
import { FormattingCommands } from '../../partials/shared/email/email-compose/formatting-commands';
import { Viewport } from '../../../core/layout/viewport';
import { Theme } from '../../../core/theme/theme';
import { EMAIL_SEND_LATENCY, EmailSend } from '../../../core/email/email-send';
import {
  DRAFT_KEY,
  DRAFT_SAVE_DELAY,
  DraftContent,
  parseDraft,
  serializeDraft,
} from '../../../core/email/draft';

/** Lets the mock transport's (zero-latency) timer and the submit settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// jsdom lacks what the textMetrics extension needs at editor mount
// (ResizeObserver, a canvas 2D context for glyph measurement) — without the
// stubs, createEditor throws mid-mount and the email pane silently never
// wires up in tests.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const context2dStub = {
  font: '',
  measureText: (text: string) => ({ width: text.length * 7 }),
};
HTMLCanvasElement.prototype.getContext = (() => context2dStub) as never;

// Every composer saves its draft when it goes: start each spec without one.
beforeEach(() => localStorage.clear());

/** The page opens with the caret in the text (its welcome is addressed).
    A focused editor holds a value written from outside until it is left
    (its own spec covers that), so the specs that write the body from
    outside start with the caret taken out again. Returns where it was. */
const leaveText = async (fixture: ComponentFixture<Compose>): Promise<Element | null> => {
  const started = document.activeElement;
  (started as HTMLElement | null)?.blur?.();
  await fixture.whenStable();
  return started;
};

/** Picks a View in the writer bar's ⋮ menu — the editor, or its HTML in
    the editor's place (code view) — one of its two check options. A pick
    closes the menu. */
async function chooseView(fixture: ComponentFixture<unknown>, view: 'Editor' | 'HTML') {
  const root = fixture.nativeElement as HTMLElement;
  (root.querySelector('.writer-bar [aria-label="More options"]') as HTMLButtonElement).click();
  await fixture.whenStable();
  const option = [
    ...document.querySelectorAll<HTMLElement>('.toolbar-menu [role="menuitemradio"]'),
  ].find((item) => item.textContent?.trim().startsWith(view));
  if (!option || option.getAttribute('aria-disabled') === 'true') {
    throw new Error(`no ${view} option in the ⋮ menu`);
  }
  option.click();
  await fixture.whenStable();
}

/** Opens the writer bar's settings dialog — Settings… in its ⋮ menu, as
    core's Preferences… — and hands it back: a MatDialog, in the overlay
    container on <body>, the one open. */
async function openSettings(fixture: ComponentFixture<unknown>): Promise<HTMLElement> {
  const root = fixture.nativeElement as HTMLElement;
  (root.querySelector('.writer-bar [aria-label="More options"]') as HTMLButtonElement).click();
  await fixture.whenStable();
  const item = [...document.querySelectorAll<HTMLElement>('.toolbar-menu [role="menuitem"]')].find(
    (row) => row.textContent?.includes('Settings…'),
  );
  if (!item) throw new Error('no Settings… item in the ⋮ menu');
  item.click();
  await fixture.whenStable();
  const dialog = document.querySelector<HTMLElement>('.message-settings-pane [role="dialog"]');
  if (!dialog) throw new Error('Settings… opened no dialog');
  return dialog;
}

/** Closes the settings by their close button, as a person would. */
async function closeSettings(fixture: ComponentFixture<unknown>, dialog: HTMLElement) {
  dialog.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.click();
  await fixture.whenStable();
}

/** Opens a page of the settings by its tab — a page renders when it is
    first opened (`ngTabContent`). */
async function openSection(
  fixture: ComponentFixture<unknown>,
  dialog: HTMLElement,
  label: 'Personalization' | 'Designer' | 'Writer',
): Promise<void> {
  [...dialog.querySelectorAll<HTMLElement>('[role="tab"]')]
    .find((tab) => tab.textContent?.includes(label))!
    .click();
  await fixture.whenStable();
}

/** The writer bar's ⋮ menu offers its View row now. */
function viewOffered(compose: Compose): boolean {
  return (compose as any).sheet().viewOffered();
}

describe('Compose', () => {
  let component: Compose;
  let fixture: ComponentFixture<Compose>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [{ provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    }).compileComponents();

    fixture = TestBed.createComponent(Compose);
    component = fixture.componentInstance;
    await fixture.whenStable();
    startedIn = await leaveText(fixture);
  });

  /** Where the caret was as the page opened. */
  let startedIn: Element | null;

  /** The form's complaint, as the sheet words it. */
  const problem = (): string | null => (component as any).sheet().problem();

  /** What the sheet says it sent, from now on. */
  const sentNotes = (): string[] => {
    const notes: string[] = [];
    (component as any).sheet().sent.subscribe((note: string) => notes.push(note));
    return notes;
  };

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('the page is the zoomed window on the whole screen: a document, its rows Material form fields, no strip under it', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[message-form]')?.getAttribute('data-layout')).toBe('document');
    expect(root.querySelector('form[email-writer]')?.getAttribute('data-bar')).toBe('top');
    expect(root.querySelectorAll('mat-form-field').length).toBeGreaterThan(0);
    expect(root.querySelector('footer')).toBeNull();
  });

  it('an external html write during focus applies on blur — a draft restore is never dropped', async () => {
    // Put the user "in" the editor (mount focuses it too, but not reliably
    // under the test harness — make it explicit).
    // Two editor roots live on the page (body + source): name the one meant.
    const pm = fixture.nativeElement.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    expect(document.activeElement).toBe(pm);

    // A draft restore (or import) lands while the user is "in" the editor —
    // written to the pane's model, the exact surface a host binds against.
    const pane = (component as any).sheet().emailPane();
    pane.value.set('<div>restored draft</div>');
    await fixture.whenStable(); // flush the pane's sync effect
    expect(pane.value()).toBe('<div>restored draft</div>');
    // Protected while focused: the typing surface must not be rewritten…
    expect(pm.textContent).not.toContain('restored draft');

    // …but the value is not lost: leaving the editor catches up.
    pm.blur();
    expect(pm.textContent).toContain('restored draft');
  });

  it('a write landing while the tab is in the background applies at once, though the editor is still the active element', async () => {
    const pm = fixture.nativeElement.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    expect(document.activeElement).toBe(pm);

    // The window lost focus (another tab is in front); the editor did not
    // lose its place as the document's active element.
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      (component as any).sheet().emailPane().value.set('<div>saved in another tab</div>');
      await fixture.whenStable();
      expect(pm.textContent).toContain('saved in another tab');
    } finally {
      hasFocus.mockRestore();
    }
  });

  it("the writer bar's </> moves the HTML source into the editing surface's place and back", async () => {
    const root = fixture.nativeElement as HTMLElement;
    // The pane's home is the page wrapper, which is also the .eml import
    // dropzone (compose.html) — not the component host.
    const page = root.querySelector('.compose__page') as HTMLElement;
    const editor = root.querySelector('.email-compose__editor') as HTMLElement;
    const code = root.querySelector('.email-compose__code') as HTMLElement;
    const source = root.querySelector('section[html-email-compose]') as HTMLElement;
    const sourceEditor = source.querySelector('[aria-label="Email HTML source"]');
    const bold = root.querySelector('.formatting-toolbar [aria-label="Bold"]') as HTMLButtonElement;
    const quote = root.querySelector(
      '.formatting-toolbar [aria-label="Quote"]',
    ) as HTMLButtonElement;
    const send = root.querySelector('.writer-bar__send') as HTMLButtonElement;

    // Hidden by default, in its own column (a sibling of the composer).
    expect(source.hidden).toBe(true);
    expect(source.parentElement).toBe(page);
    expect(editor.hidden).toBe(false);
    expect(code.hidden).toBe(true);

    await chooseView(fixture, 'HTML');
    // The very same node moved into the code slot — not a re-created pane.
    expect(source.hidden).toBe(false);
    expect(code.contains(source)).toBe(true);
    expect(source.querySelector('[aria-label="Email HTML source"]')).toBe(sourceEditor);
    expect(editor.hidden).toBe(true);
    expect(code.hidden).toBe(false);
    expect((component as any).sourceView()).toBe('code');
    // Marks route to the source pane (its kit mirrors them) and Send lives
    // in the writer's bar — both stay live; block commands have no source
    // twin and lock.
    expect(bold.disabled).toBe(false);
    expect(quote.disabled).toBe(true);
    expect(send.disabled).toBe(false);
    expect(root.querySelector('.formatting-toolbar [aria-label="Send"]')).toBeNull();

    await chooseView(fixture, 'Editor');
    // …and back home, hidden again.
    expect(source.parentElement).toBe(page);
    expect(source.hidden).toBe(true);
    expect(editor.hidden).toBe(false);
    expect(code.hidden).toBe(true);
    expect(quote.disabled).toBe(false);
  });

  it("the writer bar's formatting options button shows and hides the toolbar", async () => {
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector(
      '.writer-bar [aria-label="Formatting options"]',
    ) as HTMLButtonElement;
    const toolbar = root.querySelector('.formatting-toolbar') as HTMLElement;

    // Off by default, not pressed.
    expect(toolbar.hidden).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    button.click();
    await fixture.whenStable();
    expect(toolbar.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    await fixture.whenStable();
    expect(toolbar.hidden).toBe(true);
  });

  /** Switches the formatting toolbar on — it is off by default. */
  const showToolbar = async () => {
    (
      fixture.nativeElement.querySelector(
        '.writer-bar [aria-label="Formatting options"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
  };

  it('the font dropdowns lead the toolbar and apply the curated choice from their Aria menu', async () => {
    await showToolbar();
    const root = fixture.nativeElement as HTMLElement;
    const row = root.querySelector('.formatting-toolbar__scroll') as HTMLElement;
    const family = row.querySelector('.formatting-toolbar__select--family') as HTMLButtonElement;
    const size = row.querySelector('.formatting-toolbar__select--size') as HTMLButtonElement;
    expect(row.firstElementChild).toBe(family);
    // Never a "default": the value in effect, or nothing yet.
    expect(family.textContent).not.toContain('Default');
    expect(size.getAttribute('aria-haspopup')).toBe('true');

    // Opens the menu from its trigger and picks the item — the menus render
    // in the CDK overlay container, outside the component.
    const choose = async (trigger: HTMLButtonElement, label: string) => {
      trigger.click();
      await fixture.whenStable();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (el) => el.textContent?.trim().startsWith(label),
      );
      expect(item).toBeDefined();
      item!.click();
      await fixture.whenStable();
    };

    await choose(size, '18px');
    expect(size.textContent).toContain('18');
    expect(size.getAttribute('aria-expanded')).toBe('false');
    await choose(family, 'Serif');
    expect(family.textContent).toContain('Serif');
  });

  it('the colour button reads as applied for a colour, not for the font or size that share its mark', async () => {
    await showToolbar();
    const root = fixture.nativeElement as HTMLElement;
    const color = root.querySelector(
      '.formatting-toolbar [aria-label="Color"]',
    ) as HTMLButtonElement;
    const size = root.querySelector('.formatting-toolbar__select--size') as HTMLButtonElement;

    // A size at the caret: the same textStyle mark, without a colour.
    size.click();
    await fixture.whenStable();
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((el) =>
      el.textContent?.trim().startsWith('18px'),
    );
    item!.click();
    await fixture.whenStable();
    expect(size.textContent).toContain('18');
    expect(color.hasAttribute('data-applied')).toBe(false);

    // A swatch from its palette: now the colour is on.
    color.click();
    await fixture.whenStable();
    expect(color.getAttribute('aria-expanded')).toBe('true');
    // One pane, both palettes, each named by its heading: text, background.
    const palettes = () => [
      ...document.querySelectorAll<HTMLElement>('[color-picker] [color-palette]'),
    ];
    const selected = (palette: HTMLElement) =>
      palette.querySelector('[aria-selected="true"]')?.getAttribute('aria-label');
    expect(
      palettes().map((palette) =>
        document.getElementById(palette.getAttribute('aria-labelledby')!)?.textContent?.trim(),
      ),
    ).toEqual(['Text color', 'Background color']);
    (palettes()[0].querySelector('[aria-label="Red"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(color.hasAttribute('data-applied')).toBe(true);
    expect(color.getAttribute('aria-expanded')).toBe('false');

    // Reopened, the pane marks the colours in effect; a background joins.
    color.click();
    await fixture.whenStable();
    expect(palettes().map(selected)).toEqual(['Red', 'None']);
    (palettes()[1].querySelector('[aria-label="Yellow"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    color.click();
    await fixture.whenStable();
    expect(palettes().map(selected)).toEqual(['Red', 'Yellow']);
  });

  it('the button link always opens the link editor; a button left without a link is taken back', async () => {
    const pane = (component as any).sheet().emailPane();
    pane.value.set(
      '<div>Read <b>the report</b> now</div><div>Go <a href="https://x.io">there</a></div>',
    );
    await fixture.whenStable();
    const editor = pane.editor();
    // jsdom has no layout: the popover's anchor needs a box to stand on.
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 40,
      right: 40,
      top: 100,
      bottom: 120,
    });
    // The composer's shared commands: `act` is what every Button link
    // button calls (the bubble menu itself shows only with real focus).
    const formatting = fixture.debugElement
      .query((el) => !!el.nativeElement?.matches?.('section[email-compose]'))
      .injector.get(FormattingCommands);
    const dialog = () => document.querySelector('[role="dialog"][aria-label="Edit link"]');
    const field = () => dialog()!.querySelector('input') as HTMLInputElement;
    const key = (target: Element, key: string) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const convert = async (text: string) => {
      let from = 0;
      editor.state.doc.descendants((node: any, pos: number) => {
        if (node.isText && node.text.includes(text)) from = pos + node.text.indexOf(text);
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, from, from + text.length),
        ),
      );
      await fixture.whenStable();
      formatting.act('button-link');
      await fixture.whenStable();
    };

    // Text without a link: the editor opens, empty — a link is to be typed.
    await convert('the report');
    expect(dialog()).not.toBeNull();
    expect(field().value).toBe('');
    // Dismissed without one: taken back, the bold with it.
    key(field(), 'Escape');
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(pane.value()).not.toContain('inline-block');
    // The authored `<b>` stays itself (the editor's `email` parse).
    expect(pane.value()).toContain('<b>the report</b>');

    // Typed: the button goes there.
    await convert('the report');
    field().value = 'example.com/report';
    field().dispatchEvent(new Event('input', { bubbles: true }));
    key(field(), 'Enter');
    await fixture.whenStable();
    expect(pane.value()).toMatch(
      /<a href="https:\/\/example\.com\/report"[^>]*inline-block[^>]*>the report<\/a>/,
    );

    // Text that was a link opens it too, prefilled; Escape keeps the button,
    // which already goes somewhere.
    await convert('there');
    expect(field().value).toBe('https://x.io');
    key(field(), 'Escape');
    await fixture.whenStable();
    expect(pane.value()).toMatch(/<a href="https:\/\/x\.io"[^>]*inline-block[^>]*>there<\/a>/);
  });

  it('a click on a button opens only its link editor — again after an Escape the editor took too', async () => {
    const pane = (component as any).sheet().emailPane();
    const style =
      'display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); ' +
      'font-weight: bold; text-decoration: none; white-space: nowrap; border-width: 14px 28px; border-style: solid; ' +
      'border-color: rgb(26, 115, 232);';
    pane.value.set(`<div>Go <a href="https://x.io/shop" style="${style}">Shop</a> now</div>`);
    await fixture.whenStable();
    const editor = pane.editor();
    const view = editor.view;
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 40, right: 40, top: 100, bottom: 120 });
    const dialog = () => document.querySelector('[role="dialog"][aria-label="Edit link"]');
    // The bubble the composer renders: what it would show, and what it does.
    const bubble = () => (pane as any).bubbleShown();
    // ProseMirror's click path on the button (its mouseup runs this).
    const click = async () => {
      const node = view.state.doc.nodeAt(4);
      view.someProp('handleClickOn', (f: any) =>
        f(view, 4, node, 4, new MouseEvent('mouseup'), true),
      );
      await fixture.whenStable();
    };

    await click();
    expect(dialog()).not.toBeNull();
    // The click that opened it ends after it is on screen — and is not a
    // click outside it: it stays.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();
    expect(dialog()).not.toBeNull();

    // A button's link editor also sets where it sits on its line.
    const center = dialog()!.querySelector<HTMLButtonElement>('[aria-label="Align center"]')!;
    expect(center).not.toBeNull();
    expect(center.getAttribute('aria-pressed')).toBe('false');
    center.click();
    await fixture.whenStable();
    expect(pane.value()).toContain('text-align: center');
    expect(center.getAttribute('aria-pressed')).toBe('true');
    expect(dialog()).not.toBeNull(); // still its menu

    // Even when the extension says "show": the link editor is the popover.
    (pane as any).bubbleMenuState.set({ isOpen: true, boundingBox: null, kind: 'button' });
    expect(bubble().isOpen).toBe(false);

    // Escape in the editor, which the editor handles first.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    escape.preventDefault();
    view.dom.dispatchEvent(escape);
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    // Closed, and no other menu in its place while the button stays selected.
    expect(bubble().isOpen).toBe(false);

    // And the next click opens it again.
    await click();
    expect(dialog()).not.toBeNull();

    // A press outside: the popover goes, nothing comes up in its place…
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(bubble().isOpen).toBe(false);

    // …until the selection moves on; then the bubble is the selection's again.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    await fixture.whenStable();
    (pane as any).bubbleMenuState.set({ isOpen: true, boundingBox: null, kind: 'text' });
    expect(bubble().isOpen).toBe(true);
  });

  it('a button’s link editor has a second line: its words, bold and italic', async () => {
    const pane = (component as any).sheet().emailPane();
    const style =
      'display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); ' +
      'font-weight: bold; text-decoration: none; white-space: nowrap; border-width: 14px 28px; border-style: solid; ' +
      'border-color: rgb(26, 115, 232);';
    pane.value.set(`<div>Go <a href="https://x.io/shop" style="${style}">Shop</a> now</div>`);
    await fixture.whenStable();
    const view = pane.editor().view;
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 40, right: 40, top: 100, bottom: 120 });
    const node = view.state.doc.nodeAt(4);
    view.someProp('handleClickOn', (f: any) =>
      f(view, 4, node, 4, new MouseEvent('mouseup'), true),
    );
    await fixture.whenStable();

    const dialog = () => document.querySelector('[role="dialog"][aria-label="Edit link"]')!;
    const control = <T extends Element>(label: string) =>
      dialog().querySelector<T>(`[aria-label="${label}"]`)!;
    const words = () => control<HTMLInputElement>('Button text');
    expect(dialog().querySelectorAll('.link-editor__row').length).toBe(2);
    expect(words().value).toBe('Shop');

    // Bold and italic apply at once, to the button as a whole — never to
    // the field — and the popover stays.
    const bold = control<HTMLButtonElement>('Bold');
    const italic = control<HTMLButtonElement>('Italic');
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    bold.click();
    italic.click();
    await fixture.whenStable();
    // The button was written without our target/rel, so it keeps its own
    // markup: the edit replaces its weight in place and adds the slant.
    expect(pane.value()).toContain('font-weight: normal;');
    expect(pane.value()).toContain('font-style: italic;');
    expect(pane.value()).not.toMatch(/<strong|<em/);
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    expect(italic.getAttribute('aria-pressed')).toBe('true');

    // No words: refused, not applied.
    const type = async (value: string) => {
      words().value = value;
      words().dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();
    };
    await type('   ');
    control<HTMLButtonElement>('Apply link').click();
    await fixture.whenStable();
    await settle();
    expect(words().getAttribute('aria-invalid')).toBe('true');
    expect(pane.value()).toContain('>Shop</a>');

    // New words go on with Apply (Enter in the field), the link kept.
    await type('Shop the sale');
    words().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    await settle();
    expect(document.querySelector('[role="dialog"][aria-label="Edit link"]')).toBeNull();
    expect(pane.value()).toMatch(
      /<a href="https:\/\/x\.io\/shop"[^>]*font-style: italic[^>]*>Shop the sale<\/a>/,
    );
  });

  it('the link editor always offers apply, open and remove, and applies only a valid link', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pane = (component as any).sheet().emailPane();
    pane.value.set('<p>see the docs</p>');
    await fixture.whenStable();
    const editor = pane.editor();
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 40,
      right: 40,
      top: 100,
      bottom: 120,
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 9, 13)),
    );
    await fixture.whenStable();
    (root.querySelector('.formatting-toolbar [aria-label="Link"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    const dialog = () => document.querySelector('[role="dialog"][aria-label="Edit link"]')!;
    const field = () => dialog().querySelector('input') as HTMLInputElement;
    const button = (label: string) =>
      dialog().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    const error = () => dialog().querySelector('[role="alert"]')?.textContent?.trim() ?? null;
    const type = async (value: string) => {
      field().value = value;
      field().dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();
    };
    const apply = async () => {
      button('Apply link').click();
      await fixture.whenStable();
      await settle();
    };

    // A new link: all three are there, nothing is complained about yet —
    // and no alignment: text aligns with its line from the toolbar.
    expect(['Apply link', 'Open link', 'Remove link'].every((l) => !!button(l))).toBe(true);
    expect(button('Align center')).toBeNull();
    expect(button('Button text')).toBeNull(); // no second line for text
    expect(button('Apply link').type).toBe('submit');
    expect(error()).toBeNull();

    // Applying nothing, or no link, or a script: refused and not applied —
    // the field marked invalid, with no message.
    const invalid = () => field().getAttribute('aria-invalid') === 'true';
    for (const value of ['', 'not a link', 'javascript:alert(1)']) {
      await type(value);
      await apply();
      expect(dialog()).not.toBeNull();
      expect(invalid()).toBe(true);
    }
    expect(error()).toBeNull();
    expect(pane.value()).not.toContain('href=');

    // Open with no link to go to goes nowhere, and marks the field.
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await type('nope');
    button('Open link').click();
    await fixture.whenStable();
    expect(open).not.toHaveBeenCalled();
    expect(invalid()).toBe(true);
    await type('example.com/docs');
    button('Open link').click();
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
    open.mockRestore();

    // A link: applied, the popover gone.
    await apply();
    expect(document.querySelector('[role="dialog"][aria-label="Edit link"]')).toBeNull();
    expect(pane.value()).toContain('href="https://example.com/docs"');
  });

  it('the link buttons open the link editor at the selection, through the shared commands', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pane = (component as any).sheet().emailPane();
    pane.value.set('<p>see the docs</p>');
    await fixture.whenStable();
    const editor = pane.editor();
    // jsdom has no layout: the anchor at the selection is measured from a
    // rect the test supplies.
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 40,
      right: 40,
      top: 100,
      bottom: 120,
    });
    // Select "docs": the link editor opens only on a selection or in a link.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 9, 13)),
    );
    await fixture.whenStable();

    const dialog = () => document.querySelector('[role="dialog"][aria-label="Edit link"]');
    expect(dialog()).toBeNull();
    (root.querySelector('.formatting-toolbar [aria-label="Link"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(dialog()).not.toBeNull();

    // Applying a scheme-less URL links the selection with https.
    const input = dialog()!.querySelector('input') as HTMLInputElement;
    input.value = 'example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (dialog()!.querySelector('[aria-label="Apply link"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(pane.value()).toContain('href="https://example.com"');
  });

  it('serializes the email once per keystroke — even with the editor unfocused', async () => {
    const pane = (component as any).sheet().emailPane();
    pane.value.set('<p>see the docs</p>');
    await fixture.whenStable();
    const editor = pane.editor();
    const getHTML = vi.spyOn(editor, 'getHTML');
    for (let i = 0; i < 5; i++) {
      editor.view.dispatch(editor.state.tr.insertText('x', 2));
      await fixture.whenStable();
    }
    // One publish per change; the incoming-value check compares with what
    // was published instead of serializing again.
    expect(getHTML).toHaveBeenCalledTimes(5);
    expect(pane.value()).toContain('sxxxxxee the docs');
  });

  it('the link editor selects its field as it opens; Escape closes from any of it, never an IME’s', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pane = (component as any).sheet().emailPane();
    pane.value.set('<p>see the docs</p>');
    await fixture.whenStable();
    const editor = pane.editor();
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: 40,
      right: 40,
      top: 100,
      bottom: 120,
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 9, 13)),
    );
    await fixture.whenStable();

    const dialog = () => document.querySelector('[role="dialog"][aria-label="Edit link"]');
    const openIt = async () => {
      (root.querySelector('.formatting-toolbar [aria-label="Link"]') as HTMLButtonElement).click();
      await fixture.whenStable();
    };
    const key = (target: Element, key: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      );

    await openIt();
    const input = dialog()!.querySelector('input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('dir')).toBe('ltr');

    // An IME's Enter confirms its text; it neither applies nor closes.
    input.value = 'example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    key(input, 'Enter', { isComposing: true });
    key(input, 'Escape', { isComposing: true });
    await fixture.whenStable();
    expect(dialog()).not.toBeNull();
    expect(pane.value()).not.toContain('href=');

    // Escape on the Apply button closes too, and applies nothing.
    key(dialog()!.querySelector('[aria-label="Apply link"]')!, 'Escape');
    await fixture.whenStable();
    expect(dialog()).toBeNull();
    expect(pane.value()).not.toContain('href=');
  });

  it('detach shows the HTML source beside the editor; it and the View switch each other', async () => {
    const root = fixture.nativeElement as HTMLElement;
    // The pane's home is the page wrapper, which is also the .eml import
    // dropzone (compose.html) — not the component host.
    const page = root.querySelector('.compose__page') as HTMLElement;
    const editor = root.querySelector('.email-compose__editor') as HTMLElement;
    const code = root.querySelector('.email-compose__code') as HTMLElement;
    const source = root.querySelector('section[html-email-compose]') as HTMLElement;
    const detach = root.querySelector('[aria-label="Detach HTML source"]') as HTMLButtonElement;
    const quote = root.querySelector(
      '.formatting-toolbar [aria-label="Quote"]',
    ) as HTMLButtonElement;

    detach.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(true);
    expect(source.hidden).toBe(false);
    expect(source.parentElement).toBe(page); // its own column, not the slot
    expect(editor.hidden).toBe(false); // the editor stays, and stays the target
    expect(quote.disabled).toBe(false);
    expect(detach.getAttribute('aria-pressed')).toBe('true');

    // Choosing HTML switches views rather than stacking them.
    await chooseView(fixture, 'HTML');
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(code.contains(source)).toBe(true);
    expect(detach.getAttribute('aria-pressed')).toBe('false');

    detach.click();
    await fixture.whenStable();
    expect(code.contains(source)).toBe(false);
    expect(root.classList.contains('compose--detached')).toBe(true);

    // Pressing the active one again hides the source.
    detach.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(source.hidden).toBe(true);
  });

  it('Send submits the one form: held and explained while the envelope is incomplete, delivered once it is', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pm = root.querySelector('[aria-label="Message body"]') as HTMLElement;
    const send = root.querySelector('.writer-bar__send') as HTMLButtonElement;
    const toRow = root.querySelectorAll('[email-address-input]')[1];
    // A body, and the welcome's recipient taken out: the only thing
    // missing is a recipient.
    pm.focus();
    (component as any).sheet().emailPane().value.set('<div>hello</div>');
    pm.blur();
    (component as any).sheet().message.update((m: object) => ({ ...m, to: [] }));
    await fixture.whenStable();
    expect(send.type).toBe('submit');
    const notes = sentNotes();

    send.click();
    await settle();
    await fixture.whenStable();
    // Nothing went out; the sheet says why, and the To row wears it.
    expect(notes).toEqual([]);
    expect(problem()).toContain('Add at least one address');
    expect(toRow.getAttribute('data-invalid')).toBe('true');
    // …and the caret is in it: the form focused the control bound to the
    // first field with an error.
    expect(document.activeElement).toBe(toRow.querySelector('[data-slot=input]'));

    (component as any).sheet().message.update((m: object) => ({ ...m, to: ['ada@example.com'] }));
    await fixture.whenStable();
    expect(problem()).toBeNull();

    send.click();
    await settle();
    await fixture.whenStable();
    // The transport's receipt: envelope and body, as a real host would hand its mailer.
    const note = notes[0] ?? '';
    expect(note).toContain('Sent msg_1');
    expect(note).toContain('to 1 recipient');
    expect(note).toContain('no subject');
  });

  it('Cc and Bcc sit on the To row like Gmail: each opens its row focused, and an empty row folds back', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const labels = () =>
      [...root.querySelectorAll('.writer-field__label')].map((el) => el.textContent?.trim());
    const actions = () =>
      [...root.querySelectorAll('.writer-field__action')].map((el) => el.textContent?.trim());
    const action = (name: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('.writer-field__action')].find(
        (el) => el.textContent?.trim() === name,
      )!;
    const row = (label: string) =>
      [...root.querySelectorAll<HTMLElement>('.writer-field')].find(
        (el) => el.querySelector('.writer-field__label')?.textContent?.trim() === label,
      )!;

    expect(labels()).toEqual(['From', 'To']);
    expect(actions()).toEqual(['Cc', 'Bcc', 'Preview']);
    expect(action('Cc').type).toBe('button');

    action('Cc').click();
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Cc']);
    expect(actions()).toEqual(['Bcc', 'Preview']);
    const ccInput = row('Cc').querySelector<HTMLInputElement>('[data-slot=input]')!;
    expect(document.activeElement).toBe(ccInput);

    // The button never takes focus: it is removed as its row opens, and a
    // removed focused element would leave focus nowhere.
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    action('Bcc').dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);

    // Moving to another recipient row keeps it open, and so does focus going
    // nowhere (the window losing focus)…
    const toInput = row('To').querySelector<HTMLInputElement>('[data-slot=input]')!;
    row('Cc').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: toInput }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Cc']);
    row('Cc').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Cc']);

    // …leaving the recipients for somewhere real, with it empty, folds it back.
    const subject = root.querySelector<HTMLInputElement>('.writer-field__input')!;
    row('Cc').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: subject }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To']);
    expect(actions()).toEqual(['Cc', 'Bcc', 'Preview']);

    // With an address in it, it stays — and it is in the model.
    action('Bcc').click();
    await fixture.whenStable();
    const bccInput = row('Bcc').querySelector<HTMLInputElement>('[data-slot=input]')!;
    bccInput.value = 'grace@example.com';
    bccInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    row('Bcc').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: subject }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Bcc']);
    expect(actions()).toEqual(['Cc', 'Preview']);
    expect((component as any).sheet().message().bcc).toEqual(['grace@example.com']);
  });

  it('Preview on the Subject row opens the inbox snippet, folds empty, and goes out in the sent document', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const labels = () =>
      [...root.querySelectorAll('.writer-field__label')].map((el) => el.textContent?.trim());
    const preview = () =>
      [...root.querySelectorAll<HTMLButtonElement>('.writer-field__action')].find(
        (el) => el.textContent?.trim() === 'Preview',
      );
    const row = () =>
      [...root.querySelectorAll<HTMLElement>('.writer-field')].find(
        (el) => el.querySelector('.writer-field__label')?.textContent?.trim() === 'Preview',
      );

    // The subject precedes its button in the source: Tab runs To, Subject, Preview.
    const subject = root.querySelector<HTMLInputElement>('.writer-field__input')!;
    expect(
      subject.compareDocumentPosition(preview()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    preview()!.click();
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Preview']);
    expect(preview()).toBeUndefined();
    const input = row()!.querySelector('input')!;
    expect(document.activeElement).toBe(input);

    // Left empty, it folds back into the button.
    row()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To']);

    // Filled, it stays — and the transport gets it as the document's hidden
    // preview text, the subject as its title, the bare body beside it.
    preview()!.click();
    await fixture.whenStable();
    row()!.querySelector('input')!.value = 'Numbers inside';
    row()!
      .querySelector('input')!
      .dispatchEvent(new Event('input', { bubbles: true }));
    row()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await fixture.whenStable();
    expect(labels()).toEqual(['From', 'To', 'Preview']);

    const sheet = (component as any).sheet();
    const notes = sentNotes();
    sheet.emailPane().value.set('<div>hello</div>');
    sheet.message.update((m: object) => ({ ...m, to: ['ada@example.com'], subject: 'Q3' }));
    await fixture.whenStable();
    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await settle();
    await fixture.whenStable();

    const sent = TestBed.inject(EmailSend).last()!.message;
    expect(sent.html).not.toContain('Numbers inside');
    const doc = new DOMParser().parseFromString(sent.document!, 'text/html');
    expect(doc.title).toBe('Q3');
    const article = doc.body.firstElementChild!;
    expect(article.getAttribute('role')).toBe('article');
    expect(article.firstElementChild!.textContent).toContain('Numbers inside');
    expect(notes[0]).toContain('preview text');
    // The sheet started over, the row with it.
    expect(labels()).toEqual(['From', 'To']);
  });

  it('the settings’ Layout switch turns every layout block static, and stands disabled for plain text', async () => {
    const sheet = (component as any).sheet();
    const dialog = await openSettings(fixture);
    expect(dialog.getAttribute('aria-labelledby')).toMatch(/-title$/);
    await openSection(fixture, dialog, 'Writer');

    const pm = () => sheet.emailPane().editor().view.dom as HTMLElement;
    const layoutSwitch = () =>
      dialog.querySelector<HTMLButtonElement>('[data-setting="layout"] button[role="switch"]')!;
    expect(pm().hasAttribute('data-aee-static')).toBe(false);
    expect(layoutSwitch().getAttribute('aria-checked')).toBe('true');

    layoutSwitch().click();
    await fixture.whenStable();
    expect(layoutSwitch().getAttribute('aria-checked')).toBe('false');
    expect(pm().getAttribute('data-aee-static')).toBe('section columns table spacer');

    // Plain text has no layout: the switch is still there, disabled.
    sheet.onFormat('text');
    await settle();
    await fixture.whenStable();
    expect(layoutSwitch()).not.toBeNull();
    expect(layoutSwitch().disabled).toBe(true);

    // Back to HTML: the new editor takes the switch as it stands.
    sheet.onFormat('html');
    await settle();
    await fixture.whenStable();
    expect(layoutSwitch().disabled).toBe(false);
    expect(pm().getAttribute('data-aee-static')).toBe('section columns table spacer');
    await closeSettings(fixture, dialog);
  });

  it('the settings’ kept preferences apply at once, and this browser keeps them', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const sheet = (component as any).sheet();
    const dialog = await openSettings(fixture);
    const key = (name: string) => localStorage.getItem(`angular-email-editor:${name}`);

    /** Picks `option` (an icon's label, or a pill's words) on the toggle
        the row labelled `label` holds. */
    const pick = async (label: string, option: string) => {
      const id = [...dialog.querySelectorAll('.settings__label')].find(
        (text) => text.textContent?.trim() === label,
      )!.id;
      const group = dialog.querySelector(`hk-tgb[aria-labelledby="${id}"]`)!;
      [...group.querySelectorAll<HTMLElement>('[role=radio]')]
        .find((item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === option)!
        .click();
      await fixture.whenStable();
    };
    const toggle = async (setting: string) => {
      dialog.querySelector<HTMLButtonElement>(`[data-setting="${setting}"] button[role="switch"]`)!.click();
      await fixture.whenStable();
    };

    // The email's theme only — the app's stays in its top bar.
    expect(dialog.textContent).not.toContain('Language');
    // The editor follows the app's theme while it is Auto…
    TestBed.inject(Theme).toggle();
    await fixture.whenStable();
    expect(sheet.editorScheme()).toBe('dark');
    // …and keeps a theme of its own once it has one.
    await pick('Theme', 'Light');
    expect(sheet.editorScheme()).toBe('light');
    expect(key('editor-appearance')).toBe('light');
    // The default is no key at all.
    await pick('Theme', 'Auto');
    expect(key('editor-appearance')).toBeNull();

    // The formatting toolbar: the writer bar's button, mirrored.
    const formatting = root.querySelector('.writer-bar [aria-label="Formatting options"]')!;
    expect(formatting.getAttribute('aria-pressed')).toBe('false');
    await openSection(fixture, dialog, 'Writer');
    await toggle('toolbar');
    expect(formatting.getAttribute('aria-pressed')).toBe('true');
    expect(key('formatting-toolbar')).toBe('on');

    // The source's word wrap — Alt+Z's.
    const source = root.querySelector('section[html-email-compose]')!;
    expect(source.hasAttribute('data-wrap')).toBe(false);
    await openSection(fixture, dialog, 'Designer');
    await toggle('wrap');
    expect(source.getAttribute('data-wrap')).toBe('off');
    expect(key('source-wrap')).toBe('off');

    await closeSettings(fixture, dialog);
  });

  it('the attachment strip’s corner toggle lays the chips in two rows and back, kept by this browser', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const sheet = (component as any).sheet();
    const strip = () => root.querySelector<HTMLElement>('.attachment-strip')!;
    const toggle = () => strip().querySelector<HTMLButtonElement>('.attachment-strip__rows');
    expect(strip().hidden).toBe(true);

    const refs = ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => sheet.uploads.start({ name, size: 10 }));
    sheet.message.update((m: object) => ({ ...m, attachments: refs }));
    await fixture.whenStable();
    expect(strip().hidden).toBe(false);
    expect(strip().getAttribute('data-rows')).toBe('one');
    // jsdom lays nothing out, so nothing overflows: one fitting line needs no
    // toggle — until two rows are on, when it is the way back.
    expect(toggle()).toBeNull();

    sheet.toggleAttachmentRows();
    await fixture.whenStable();
    expect(strip().getAttribute('data-rows')).toBe('two');
    expect(localStorage.getItem('angular-email-editor:attachment-rows')).toBe('two');
    const list = strip().querySelector<HTMLElement>('ul[email-attachment-chips]')!;
    expect(list.style.getPropertyValue('--attachment-columns')).toBe('2');
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    expect(toggle()!.getAttribute('aria-label')).toBe('Two rows of attachments');
    expect(toggle()!.querySelector('dots-morph')!.hasAttribute('data-grid')).toBe(true);

    toggle()!.click();
    await fixture.whenStable();
    expect(strip().getAttribute('data-rows')).toBe('one');
    expect(localStorage.getItem('angular-email-editor:attachment-rows')).toBeNull();
  });

  it('the toggle beside Attach shows the count and puts the strip away and back', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const sheet = (component as any).sheet();
    const strip = () => root.querySelector<HTMLElement>('.attachment-strip')!;
    const row = () => strip().querySelector<HTMLElement>('overflow-row')!;
    const toggle = () => root.querySelector<HTMLButtonElement>('.attachment-toggle');
    const count = () => toggle()!.querySelector('.attachment-toggle__count')!.textContent;
    const ring = () => toggle()!.querySelector<SVGElement>('.attachment-toggle__ring');
    const face = () => toggle()!.getAttribute('data-face');

    // Nothing attached: split already — the bar never shifts when the first
    // file comes — with the toggle out of play, a plain chevron.
    const attach = () => root.querySelector<HTMLElement>('hk-split-button.attach-button')!;
    expect(attach().hasAttribute('data-split')).toBe(true);
    expect(toggle()!.hasAttribute('inert')).toBe(false);
    expect(toggle()!.disabled).toBe(true);
    expect(face()).toBe('chevron');

    const refs = ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => sheet.uploads.start({ name, size: 10 }));
    sheet.message.update((m: object) => ({ ...m, attachments: refs }));
    await fixture.whenStable();

    // Shown: the toggle in play, saying so — a plain chevron toggle, the
    // strip itself showing what is attached.
    expect(toggle()!.disabled).toBe(false);
    expect(toggle()!.getAttribute('aria-label')).toBe('3 attachments');
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
    expect(toggle()!.getAttribute('aria-controls')).toBe(strip().id);
    expect(face()).toBe('chevron');
    // The strip shows its own progress: no ring.
    expect(ring()).toBeNull();

    toggle()!.click();
    await fixture.whenStable();

    // Away: the chips out of sight, the same button — collapsed now —
    // showing the count in the chevron's place (the chevron under it, for
    // the pointer or focus), ringed by the batch's progress: still being
    // scanned, so no number yet — a sweep, and said so in its name.
    expect(strip().hasAttribute('data-collapsed')).toBe(true);
    expect(row().hidden).toBe(true);
    expect(toggle()!.getAttribute('aria-label')).toBe('3 attachments, preparing upload');
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
    expect(face()).toBe('count');
    expect(count()).toBe('3');
    expect(toggle()!.querySelector('.attachment-toggle__chevron')).not.toBeNull();
    expect(ring()!.getAttribute('data-mode')).toBe('indeterminate');

    toggle()!.click();
    await fixture.whenStable();

    expect(strip().hasAttribute('data-collapsed')).toBe(false);
    expect(row().hidden).toBe(false);
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
    expect(face()).toBe('chevron');
    expect(ring()).toBeNull();
    expect(toggle()!.getAttribute('aria-label')).toBe('3 attachments');

    // Put away again, a new file brings the strip back to land in.
    sheet.toggleAttachments();
    await fixture.whenStable();
    sheet.attach([{ name: 'd.pdf', size: 10 }]);
    await fixture.whenStable();
    expect(strip().hasAttribute('data-collapsed')).toBe(false);
    expect(toggle()!.getAttribute('aria-label')).toBe('4 attachments');

    // Past nine, the face says 9+ while away — the name keeps the number
    // (and, the files still being scanned, what they are waiting on).
    sheet.attach(['e', 'f', 'g', 'h', 'i', 'j'].map((name) => ({ name: name + '.pdf', size: 10 })));
    await fixture.whenStable();
    sheet.toggleAttachments();
    await fixture.whenStable();
    expect(face()).toBe('count');
    expect(count()).toBe('9+');
    expect(toggle()!.getAttribute('aria-label')).toBe('10 attachments, preparing upload');
  });

  it('the toggle rings the batch’s upload progress while the strip is away, and says it', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const sheet = (component as any).sheet();
    const toggle = () => root.querySelector<HTMLButtonElement>('.attachment-toggle')!;
    const ring = () => toggle().querySelector<SVGElement>('.attachment-toggle__ring');
    const bar = () => ring()!.querySelector<SVGElement>('.attachment-toggle__ring-bar')!;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    };

    // The store, driven by hand: one transfer half through.
    const summary = signal({ busy: true, pending: 1, progress: 0.42 as number | null });
    vi.spyOn(sheet, 'attachmentUploads').mockImplementation(() => summary());
    sheet.attach([{ name: 'a.pdf', size: 10 }]);
    await settle();
    // The strip shows: no ring, whatever the store says.
    expect(ring()).toBeNull();

    sheet.toggleAttachments();
    await settle();
    expect(ring()!.getAttribute('data-mode')).toBe('determinate');
    expect(bar().style.strokeDashoffset).toBe('58');
    expect(toggle().getAttribute('aria-label')).toBe('1 attachment, 42% uploaded');

    summary.set({ busy: false, pending: 0, progress: null });
    await settle();
    expect(ring()).toBeNull();
    expect(toggle().getAttribute('aria-label')).toBe('1 attachment');
  });

  it('the attachment strip’s trash takes every attachment out at once, and stops their uploads', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const sheet = (component as any).sheet();
    const refs = ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => sheet.uploads.start({ name, size: 10 }));
    sheet.message.update((m: object) => ({ ...m, attachments: refs }));
    await fixture.whenStable();

    // The menu reads: the count, the trash, then (when it applies) the rows.
    const menu = root.querySelector<HTMLElement>('.attachment-strip__menu')!;
    expect([...menu.children].map((child) =>
        [...child.classList].find((name) => name.startsWith('attachment-strip__')),
      )).toEqual([
      'attachment-strip__count',
      'attachment-strip__clear',
    ]);
    expect(menu.querySelector('.attachment-strip__count')!.textContent).toContain('3');

    const trash = root.querySelector<HTMLButtonElement>('.attachment-strip__clear')!;
    expect(trash.getAttribute('aria-label')).toBe('Remove all attachments');
    // One named group, for a screen reader: "Attachments, group".
    expect(menu.getAttribute('role')).toBe('group');
    expect(menu.getAttribute('aria-label')).toBe('Attachments');

    const cancel = vi.spyOn(sheet.uploads, 'cancel');
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
    trash.click();
    await fixture.whenStable();

    expect(sheet.message().attachments).toEqual([]);
    expect(cancel.mock.calls.map(([key]) => key)).toEqual(refs.map((ref: { key: string }) => ref.key));
    expect(root.querySelector<HTMLElement>('.attachment-strip')!.hidden).toBe(true);
    // The chips leave without a word: the sheet says what happened.
    expect(announce).toHaveBeenCalledWith('All attachments removed');
  });

  it('a chip’s × hands focus to the next chip and says which file went; the last one’s goes to the text', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const sheet = (component as any).sheet();
    const refs = ['a.pdf', 'b.pdf'].map((name) => sheet.uploads.start({ name, size: 10 }));
    sheet.message.update((m: object) => ({ ...m, attachments: refs }));
    await fixture.whenStable();
    const remove = (name: string) =>
      root.querySelector<HTMLButtonElement>(`[data-slot=remove][aria-label="Remove ${name}"]`)!;
    const cancel = vi.spyOn(sheet.uploads, 'cancel');
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

    remove('a.pdf').focus();
    remove('a.pdf').click();
    await fixture.whenStable();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove b.pdf');
    expect(sheet.message().attachments.map((ref: { name: string }) => ref.name)).toEqual(['b.pdf']);
    expect(cancel).toHaveBeenCalledWith(refs[0].key);
    expect(announce).toHaveBeenCalledWith('a.pdf removed');

    remove('b.pdf').click();
    await settle();
    await fixture.whenStable();
    expect(sheet.message().attachments).toEqual([]);
    expect(announce).toHaveBeenCalledWith('b.pdf removed');
    expect(sheet.emailPane().editor().view.dom.contains(document.activeElement)).toBe(true);
  });

  it('a failed upload is said aloud, brings the strip back, and holds the send with its own reason', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const sheet = (component as any).sheet();
    const ref = sheet.uploads.start({ name: 'lost.pdf', size: 10 });
    const status = signal<string>('uploading');
    vi.spyOn(sheet.uploads, 'status').mockImplementation(() => status);
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
    sheet.message.update((m: object) => ({ ...m, attachments: [ref] }));
    sheet.attachmentsHidden.set(true);
    await fixture.whenStable();
    const reason = () =>
      sheet.envelope.attachments().errors().map((error: { kind: string }) => error.kind);
    expect(reason()).toEqual(['attachments.pending']);

    status.set('failed');
    await fixture.whenStable();
    expect(announce).toHaveBeenCalledWith('lost.pdf didn’t upload', 'assertive');
    expect(sheet.attachmentsHidden()).toBe(false);
    expect(reason()).toEqual(['attachments.failed']);
    const chip = root.querySelector('[email-attachment-chip]')!;
    expect(chip.getAttribute('data-status')).toBe('failed');
    expect(chip.querySelector('[data-slot=error]')?.textContent?.trim()).toBe('Upload failed');

    // Once only, however often the sheet looks again.
    announce.mockClear();
    sheet.attachmentsHidden.set(true);
    await fixture.whenStable();
    expect(announce).not.toHaveBeenCalled();

    const retry = vi.spyOn(sheet.uploads, 'retry');
    chip.querySelector<HTMLButtonElement>('[data-slot=retry]')!.click();
    expect(retry).toHaveBeenCalledWith(ref.key);
  });

  it('the settings’ Format turns the message to plain text and back, and sends plain text alone', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const sheet = (component as any).sheet();
    const rich = '<div>Hello <strong>world</strong></div><ul><li><div>one</div></li></ul>';
    sheet.emailPane().value.set(rich);
    await fixture.whenStable();
    const richAsPublished = sheet.message().html;
    expect(richAsPublished).toContain('<strong');

    /** Picks a Format on the settings' toggle — the dialog stays open. */
    let dialog: HTMLElement | null = null;
    const chooseFormat = async (label: 'HTML' | 'Plain text') => {
      if (!dialog?.isConnected) {
        dialog = await openSettings(fixture);
        await openSection(fixture, dialog, 'Writer');
      }
      const row = [...dialog.querySelectorAll<HTMLElement>('hk-tgb')].find((group) =>
        group.textContent?.includes('Plain text'),
      )!;
      [...row.querySelectorAll<HTMLElement>('[role=radio]')]
        .find((item) => item.textContent?.trim() === label)!
        .click();
      await settle();
      await fixture.whenStable();
    };
    const marks = () => Object.keys(sheet.emailPane().editor().view.state.schema.marks);

    expect(marks()).toContain('bold');
    await chooseFormat('Plain text');
    // Read down to its text, on an editor that has nothing to format with.
    expect(sheet.message().format).toBe('text');
    expect(emailPlainText(sheet.message().html)).toBe('Hello world\n- one');
    expect(marks()).toEqual([]);
    expect(root.querySelector('[aria-label="Formatting options"]')).toBeNull();

    // Back before an edit: the formatting comes back as it was.
    await chooseFormat('HTML');
    expect(sheet.message().format).toBe('html');
    expect(sheet.message().html).toBe(richAsPublished);
    expect(marks()).toContain('bold');
    // …in the new editor too, which never publishes the old text over it.
    await settle();
    await fixture.whenStable();
    expect(sheet.emailPane().editor().getHTML()).toContain('<strong');
    expect(sheet.message().html).toBe(richAsPublished);

    // Edited as text, the text is what goes back.
    await chooseFormat('Plain text');
    sheet.emailPane().value.set(plainTextHTML('Hello world, edited'));
    await fixture.whenStable();
    await chooseFormat('HTML');
    expect(sheet.message().html).not.toContain('<strong');
    expect(emailPlainText(sheet.message().html)).toBe('Hello world, edited');

    // Sent as plain text: the text alone, no HTML part.
    await chooseFormat('Plain text');
    sheet.message.update((m: object) => ({ ...m, to: ['ada@example.com'], subject: 'Plain' }));
    await fixture.whenStable();
    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await settle();
    await fixture.whenStable();
    const sent = TestBed.inject(EmailSend).last()!.message;
    expect(sent.format).toBe('text');
    expect(sent.text).toBe('Hello world, edited');
    expect(sent.html).toBe('');
    expect(sent.document).toBeNull();
  });

  it('opens addressed, with the caret in the text — and tabs From, Cc, Bcc, To, Subject', async () => {
    const root = fixture.nativeElement as HTMLElement;
    // The welcome: To already holds a recipient, so the page opens one
    // keystroke from writing.
    expect((component as any).sheet().message().to).toEqual(['pride@example.com']);
    expect((component as any).sheet().blank()).toBe(true);
    expect(startedIn).toBe(root.querySelector('[aria-label="Message body"]'));
    const toInput = root
      .querySelectorAll('[email-address-input]')[1]
      .querySelector<HTMLInputElement>('[data-slot=input]')!;

    // Source order is tab order: the copy buttons precede the To control,
    // and CSS draws them last.
    const row = toInput.closest('.writer-field')!;
    const actions = row.querySelector('.writer-field__actions')!;
    const control = row.querySelector('[email-address-input]')!;
    expect(
      actions.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(getComputedStyle(actions).order).toBe('1');

    // Gmail's Subject: a placeholder for a label.
    const subject = root.querySelector<HTMLInputElement>('.writer-field__input')!;
    expect(subject.placeholder).toBe('Subject');
    expect(subject.getAttribute('aria-label')).toBe('Subject');
  });

  it('To, Cc and Bcc merge into one line while focus is elsewhere and a copy row is there, and open again on focus', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const group = root.querySelector<HTMLElement>('.writer-recipients')!;
    const summary = () => root.querySelector<HTMLElement>('.writer-summary');
    const toInput = root
      .querySelectorAll('[email-address-input]')[1]
      .querySelector<HTMLInputElement>('[data-slot=input]')!;
    const subject = root.querySelector<HTMLInputElement>('.writer-field__input')!;

    // Nothing but To, focus elsewhere: the row is its own line, and there is
    // nothing to merge — its placeholder stays put when focus arrives.
    expect(group.classList).not.toContain('writer-recipients--merged');
    expect(summary()).toBeNull();

    // The caret starts in To: take focus elsewhere, then give the message a Bcc.
    subject.focus();
    (component as any).sheet().message.update((m: object) => ({
      ...m,
      to: ['Ada Lovelace <ada@example.com>', 'hong@iusta'],
      bcc: ['grace@example.com'],
    }));
    await fixture.whenStable();
    // A Bcc beside To: one quiet line, hidden from assistive tech.
    expect(group.classList).toContain('writer-recipients--merged');
    expect(summary()?.getAttribute('aria-hidden')).toBe('true');
    const line = summary()!.querySelector('.writer-summary__line')!;
    expect(
      [...line.querySelectorAll('.writer-summary__person, .writer-summary__kind')].map((el) =>
        el.textContent?.trim(),
      ),
    ).toEqual(['Ada Lovelace', 'hong@iusta', 'Bcc', 'grace@example.com']);
    expect(line.textContent?.replace(/\s+/g, ' ')).toContain('Ada Lovelace, hong@iusta');
    // To's people start the line bare, as the To row has no label at rest.
    expect(line.firstElementChild?.textContent?.trim()).toBe('Ada Lovelace');
    expect(
      [...line.querySelectorAll('.writer-summary__person--invalid')].map((el) => el.textContent),
    ).toEqual(['hong@iusta']);

    // A click on the line puts the caret in To, and the focus opens the rows.
    summary()!.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(toInput);
    expect(group.classList).not.toContain('writer-recipients--merged');
    expect(summary()).toBeNull();

    // Focus going nowhere keeps them open; leaving for somewhere real merges.
    toInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await fixture.whenStable();
    expect(summary()).toBeNull();
    subject.focus();
    await fixture.whenStable();
    expect(group.classList).toContain('writer-recipients--merged');

    // Tab (any focus) into a hidden row opens them too — the rows never unmount.
    toInput.focus();
    await fixture.whenStable();
    expect(summary()).toBeNull();
  });

  it('a body problem focuses the editor, out of code view if need be', async () => {
    const root = fixture.nativeElement as HTMLElement;
    (component as any).sheet().message.update((m: object) => ({ ...m, to: ['ada@example.com'] }));
    await fixture.whenStable();
    await chooseView(fixture, 'HTML');
    expect((root.querySelector('.email-compose__code') as HTMLElement).hidden).toBe(false);

    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await settle();
    await fixture.whenStable();
    expect(problem()).toContain('Write something');
    expect((root.querySelector('.email-compose__code') as HTMLElement).hidden).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[aria-label="Message body"]'));
  });

  it('a rejection the server pins on an address comes back onto the To row', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const pm = root.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    (component as any).sheet().emailPane().value.set('<div>hello</div>');
    pm.blur();
    (component as any)
      .sheet()
      .message.update((m: object) => ({ ...m, to: ['bounce@example.com'] }));
    await fixture.whenStable();
    const notes = sentNotes();

    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await settle();
    await fixture.whenStable();
    expect(notes).toEqual([]);
    const toRow = root.querySelectorAll('[email-address-input]')[1];
    expect(toRow.getAttribute('data-invalid')).toBe('true');
    // The wording is the sheet's — the row only wears the state.
    expect(problem()).toContain('bounce@example.com was rejected');
  });

  it('the preview is a detachable pane too — hidden by default, docked to the left', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const preview = root.querySelector('section[email-preview]') as HTMLElement;
    const composer = root.querySelector('section[email-compose]') as HTMLElement;
    const toggle = root.querySelector('.writer-bar [aria-label="Preview"]') as HTMLButtonElement;
    // The page's controls, not the editor's: the formatting toolbar holds
    // formatting alone — no view toggles.
    const toolbar = root.querySelector('.formatting-toolbar') as HTMLElement;
    for (const label of ['Preview', 'Detach HTML source']) {
      expect(toolbar.querySelector(`[aria-label="${label}"]`)).toBeNull();
    }

    expect(preview.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    await fixture.whenStable();
    expect(preview.hidden).toBe(false);
    expect(root.classList.contains('compose--preview')).toBe(true);
    // To the left: before the composer, in DOM as on screen.
    expect(
      preview.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    toggle.click();
    await fixture.whenStable();
    expect(preview.hidden).toBe(true);
  });
});

describe('Compose answering a message', () => {
  const QUOTE =
    '<div>Jane wrote:</div><blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Original message</div></blockquote>';

  it('restores a draft’s quoted history under the body, and a body written over it keeps it', async () => {
    const draft: DraftContent = {
      from: ['you@example.com'],
      to: ['jane@example.com'],
      cc: [],
      bcc: [],
      subject: 'Re: Hello',
      html: '<div>My answer</div>',
      quoted: QUOTE,
      attachments: [],
    };
    localStorage.setItem(DRAFT_KEY, serializeDraft(draft)!);
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [{ provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    await leaveText(fixture);

    const sheet = (fixture.componentInstance as any).sheet();
    const pm = fixture.nativeElement.querySelector('[aria-label="Message body"]') as HTMLElement;
    // The editor mounted after the draft was read: its empty history must
    // not have overwritten the one the draft brought.
    expect(sheet.quoted()).toBe(QUOTE);
    expect(pm.querySelector('.aee-quoted')).not.toBeNull();

    // A template, an .eml, the source pane: the body is replaced, the
    // history stays.
    sheet.emailPane().value.set('<div>A template</div>');
    await fixture.whenStable();
    expect(pm.textContent).toContain('A template');
    expect(sheet.quoted()).toBe(QUOTE);
    expect(sheet.emailPane().intent().html).toBe('<div>A template</div>' + QUOTE);
  });
});

describe('Compose below the docking breakpoint', () => {
  it('drops the pane toggles from the writer bar and collapses a docked pane', async () => {
    const narrow = signal(false);
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [
        {
          provide: Viewport,
          useValue: {
            narrow: narrow.asReadonly(),
            compact: signal(false).asReadonly(),
            touch: signal(false).asReadonly(),
            floatingScrollbars: signal(true).asReadonly(),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const btn = (label: string) =>
      root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;

    // Wide: dock the preview and the source.
    btn('Preview')!.click();
    btn('Detach HTML source')!.click();
    await fixture.whenStable();
    expect(root.classList.contains('compose--detached')).toBe(true);
    expect(root.classList.contains('compose--preview')).toBe(true);

    // Narrow: the options are gone, the docked panes collapse — code view
    // (in place, the ⋮ menu's View) stays.
    narrow.set(true);
    await fixture.whenStable();
    expect(btn('Preview')).toBeNull();
    expect(btn('Detach HTML source')).toBeNull();
    expect(viewOffered(fixture.componentInstance)).toBe(true);
    expect(root.classList.contains('compose--detached')).toBe(false);
    expect(root.classList.contains('compose--preview')).toBe(false);

    // Wide again: the options return; nothing re-docks by itself.
    narrow.set(false);
    await fixture.whenStable();
    expect(btn('Preview')).not.toBeNull();
    expect(root.classList.contains('compose--preview')).toBe(false);
  });

  /** The page, opened at a phone's width or a desk's, and the switch to
      move the screen across the breakpoint afterwards. */
  async function openAt(compactAtOpen: boolean) {
    const compact = signal(compactAtOpen);
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [
        {
          provide: Viewport,
          useValue: {
            narrow: compact.asReadonly(),
            compact: compact.asReadonly(),
            touch: signal(false).asReadonly(),
            floatingScrollbars: signal(true).asReadonly(),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    return { fixture, compact, root: fixture.nativeElement as HTMLElement };
  }

  const toggle = (root: HTMLElement) =>
    root.querySelector('.writer-bar [aria-label="Formatting options"]') as HTMLButtonElement | null;

  it("opens on a phone with the phone's sheet: the toolbar always on, no switch, no View, the sheet scrolling", async () => {
    const { fixture, root } = await openAt(true);
    expect(root.querySelector('[mobile-message-form]')).not.toBeNull();
    expect(root.querySelector('[message-form]')).toBeNull();
    expect((root.querySelector('.formatting-toolbar') as HTMLElement).hidden).toBe(false);
    expect(toggle(root)).toBeNull();
    expect(viewOffered(fixture.componentInstance)).toBe(false);
    // The bar heads the sheet, and the whole sheet scrolls under it.
    expect(root.querySelector('.writer-bar')?.tagName).toBe('HEADER');
    expect(root.querySelector('form[email-writer]')?.getAttribute('data-scroll')).toBe('sheet');
    expect(root.querySelector('section[email-compose]')?.getAttribute('data-scroll')).toBe('host');
    // The suggestion menu is docked over the toolbar, not by the caret.
    const menu = root.querySelector('[email-suggestion-menu]');
    expect(menu?.closest('.email-compose__dock')).not.toBeNull();
    expect(menu?.getAttribute('data-placement')).toBe('docked');
  });

  it("keeps the phone's sheet it opened with once the screen is wide", async () => {
    const phone = await openAt(true);
    phone.compact.set(false);
    await phone.fixture.whenStable();
    expect(phone.root.querySelector('[mobile-message-form]')).not.toBeNull();
    expect(phone.root.querySelector('[message-form]')).toBeNull();
  });

  it("keeps the desktop's sheet it opened with at a phone's width — its toolbar switch and choice too", async () => {
    const desk = await openAt(false);
    const toolbar = desk.root.querySelector('.formatting-toolbar') as HTMLElement;
    expect(toolbar.hidden).toBe(true);
    const writer = () => desk.root.querySelector('form[email-writer]');
    // A document owns its scroll: the whole sheet scrolls, at any width.
    expect(writer()?.getAttribute('data-scroll')).toBe('sheet');
    desk.compact.set(true);
    await desk.fixture.whenStable();
    expect(desk.root.querySelector('[message-form]')).not.toBeNull();
    expect(desk.root.querySelector('[mobile-message-form]')).toBeNull();
    expect(toolbar.hidden).toBe(true);
    expect(toggle(desk.root)!.getAttribute('aria-pressed')).toBe('false');
    expect(writer()?.getAttribute('data-scroll')).toBe('sheet');
    // Its suggestion menu stays by the caret, in the paper.
    const menu = desk.root.querySelector('[email-suggestion-menu]');
    expect(menu?.closest('.email-compose__editor')).not.toBeNull();
    expect(menu?.getAttribute('data-placement')).toBe('caret');
  });
});

describe('Compose drafts', () => {
  const draft = (overrides: Partial<DraftContent> = {}): DraftContent => ({
    from: ['you@example.com'],
    to: ['ada@example.com'],
    cc: [],
    bcc: [],
    subject: 'Plans',
    html: '<div>restored body</div>',
    attachments: [],
    ...overrides,
  });
  const stored = () => parseDraft(localStorage.getItem(DRAFT_KEY));

  const start = async (saveDelay = 0) => {
    await TestBed.configureTestingModule({
      imports: [Compose],
      providers: [
        { provide: EMAIL_SEND_LATENCY, useValue: 0 },
        { provide: DRAFT_SAVE_DELAY, useValue: saveDelay },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Compose);
    await fixture.whenStable();
    await leaveText(fixture);
    return {
      fixture,
      component: (fixture.componentInstance as any).sheet(),
      root: fixture.nativeElement as HTMLElement,
    };
  };

  /** What the page's draft keeper says of the draft. */
  const draftNote = (fixture: ComponentFixture<Compose>): string | null =>
    (fixture.componentInstance as any).draft().note();

  /** Another tab saving (or removing) the draft. */
  const otherTab = (content: DraftContent | null) => {
    const value = serializeDraft(content);
    if (value === null) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, value);
    window.dispatchEvent(
      new StorageEvent('storage', { key: DRAFT_KEY, newValue: value, storageArea: localStorage }),
    );
  };

  it('opens with the stored draft: rows, body and attachments — and keeps it', async () => {
    localStorage.setItem(
      DRAFT_KEY,
      serializeDraft(draft({ attachments: [{ id: 'att_kept', name: 'plan.pdf', size: 12 }] }))!,
    );
    const { component, root } = await start();
    await settle();

    const message = component.message();
    expect(message.to).toEqual(['ada@example.com']);
    expect((root.querySelector('input[aria-label="Subject"]') as HTMLInputElement).value).toBe(
      'Plans',
    );
    expect(root.querySelector('[aria-label="Message body"]')?.textContent).toContain(
      'restored body',
    );
    expect(message.attachments).toEqual([
      expect.objectContaining({ id: 'att_kept', name: 'plan.pdf' }),
    ]);
    expect(component.uploads.status(message.attachments[0].key)()).toBe('complete');
    // Mounting the editor must not have published an empty body over it.
    expect(stored()?.html).toBe(message.html);
    expect(stored()?.html).toContain('restored body');
  });

  it('saves the message once it rests, and removes the draft once there is nothing left to keep', async () => {
    const { fixture, component, root } = await start();
    expect(stored()).toBeNull();

    component.message.update((m: object) => ({ ...m, subject: 'Hello' }));
    await vi.waitFor(() => expect(stored()?.subject).toBe('Hello'));
    await fixture.whenStable();
    expect(draftNote(fixture)).toContain('Draft saved');

    component.message.update((m: object) => ({ ...m, subject: '' }));
    await vi.waitFor(() => expect(stored()).toBeNull());
    await fixture.whenStable();
    expect(draftNote(fixture)).toBeNull();
  });

  it('leaves an attachment still uploading out of the draft', async () => {
    const { component } = await start();
    const pending = component.uploads.start({ name: 'big.zip', size: 1024 });
    component.message.update((m: object) => ({
      ...m,
      subject: 'With files',
      attachments: [pending],
    }));
    await vi.waitFor(() => expect(stored()?.subject).toBe('With files'));
    expect(stored()?.attachments).toEqual([]);
  });

  it('saves at once when the composer goes, without waiting for the message to rest', async () => {
    const { fixture, component } = await start(60_000);
    component.message.update((m: object) => ({ ...m, subject: 'Leaving' }));
    await fixture.whenStable();
    expect(stored()).toBeNull();
    fixture.destroy();
    expect(stored()?.subject).toBe('Leaving');
  });

  it('takes in a draft another tab saved, keeping the uploads still under way here', async () => {
    const { fixture, component, root } = await start();
    const pending = component.uploads.start({ name: 'big.zip', size: 1024 });
    component.message.update((m: object) => ({ ...m, attachments: [pending] }));
    await fixture.whenStable();

    otherTab(draft({ subject: 'From the other tab' }));
    await fixture.whenStable();
    expect(component.message().subject).toBe('From the other tab');
    expect(component.message().attachments).toEqual([pending]);
    expect(root.querySelector('[aria-label="Message body"]')?.textContent).toContain(
      'restored body',
    );

    // That tab sent it: this sheet clears too — to the page's new message.
    otherTab(null);
    await fixture.whenStable();
    expect(component.message().subject).toBe('');
    expect(component.message().to).toEqual(['pride@example.com']);
  });

  it('a send clears the sheet and the draft; the receipt stays until the next message starts', async () => {
    const { fixture, component, root } = await start();
    const pm = root.querySelector('[aria-label="Message body"]') as HTMLElement;
    pm.focus();
    component.emailPane().value.set('<div>hello</div>');
    pm.blur();
    component.message.update((m: object) => ({ ...m, to: ['ada@example.com'] }));
    await vi.waitFor(() => expect(stored()?.to).toEqual(['ada@example.com']));

    (root.querySelector('.writer-bar__send') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(stored()).toBeNull());
    await fixture.whenStable();
    // Back to the page's new message: addressed, and nothing written.
    expect(component.message().to).toEqual(['pride@example.com']);
    expect(component.blank()).toBe(true);
    expect(pm.textContent?.trim()).toBe('');
    expect(component.problem()).toBeNull();
    // Said the way a compose window says it.
    expect(document.querySelector('.mat-mdc-snack-bar-label')?.textContent).toContain(
      'Message sent',
    );
  });

  it('Discard throws the draft away and starts over', async () => {
    localStorage.setItem(DRAFT_KEY, serializeDraft(draft())!);
    const { fixture, component, root } = await start();
    const discard = root.querySelector('[aria-label="Discard draft"]') as HTMLButtonElement;
    // In the writer's bar, beside Send.
    expect(discard.closest('.writer-bar')).toBe(
      root.querySelector('.writer-bar__send')?.closest('.writer-bar'),
    );

    discard.click();
    await settle();
    await fixture.whenStable();
    expect(stored()).toBeNull();
    expect(component.message().subject).toBe('');
    expect(root.querySelector('[aria-label="Message body"]')?.textContent).not.toContain(
      'restored body',
    );
  });
});
