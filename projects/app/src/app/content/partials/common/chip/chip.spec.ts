import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Chip, ChipCloud, ChipCloudOption, ChipSet, ChipSetOption, type ChipVariant } from './chip';
import { ChipAction } from './chip-action';
import { ChipDismiss } from './chip-dismiss';

@Component({
  imports: [Chip, ChipAction],
  template: `
    <button chip id="plain" type="button" [variant]="variant()">
      <i chipLead class="lead"></i>
      Label
      <span chipTrail class="trail">3</span>
    </button>

    <div chip id="composite">
      <button chipAction id="action" type="button" role="tab" aria-selected="true">Tab</button>
      <button chipTrail id="close" type="button">✕</button>
    </div>
  `,
})
class Host {
  variant = signal<ChipVariant>('quiet');
}

describe('Chip', () => {
  let fixture: ComponentFixture<Host>;
  const el = (selector: string): HTMLElement => fixture.nativeElement.querySelector(selector);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('rides on the element it is put on, tagging it as a chip of the quiet variant by default', () => {
    const chip = el('#plain');

    expect(chip.tagName).toBe('BUTTON');
    expect(chip.classList).toContain('m-chip');
    expect(chip.getAttribute('data-variant')).toBe('quiet');
  });

  it('reflects the variant for the stylesheet', () => {
    fixture.componentInstance.variant.set('filled');
    fixture.detectChanges();

    expect(el('#plain').getAttribute('data-variant')).toBe('filled');
  });

  it('projects lead, label and trail in that order, the text into the label box', () => {
    const children = Array.from(el('#plain').children);

    expect(children.map((child) => child.className)).toEqual(['lead', 'm-chip__label', 'trail']);
    expect(el('#plain .m-chip__label').textContent?.trim()).toBe('Label');
  });

  it('puts a composite chip’s action first and leaves its label box empty, so the box collapses', () => {
    const children = Array.from(el('#composite').children);

    expect(children.map((child) => child.id || child.className)).toEqual(['action', 'm-chip__label', 'close']);
    expect(el('#composite .m-chip__label').childNodes).toHaveLength(0);
  });

  it('keeps selection on the element’s own ARIA state — the chip adds no class for it', () => {
    expect(el('#composite').className.trim()).toBe('m-chip');
    expect(el('#action').getAttribute('aria-selected')).toBe('true');
  });
});

describe('ChipAction', () => {
  it('forwards focus to its element, since a template ref resolves to the component', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const action = fixture.debugElement.query((node) => node.nativeElement.id === 'action');
    action.injector.get(ChipAction).focus();

    expect(document.activeElement).toBe(action.nativeElement);
  });
});

@Component({
  imports: [Chip, ChipCloud, ChipCloudOption],
  template: `
    <div chipCloud role="radiogroup" [(value)]="value">
      @for (option of options; track option) {
        <button chip type="button" [chipCloudOption]="option">{{ option }}</button>
      }
    </div>
  `,
})
class CloudHost {
  options = ['all', 'case', 'customer'];
  value = signal('all');
}

describe('ChipCloud', () => {
  let fixture: ComponentFixture<CloudHost>;
  let host: CloudHost;

  const chips = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('[role="radio"]'));
  const key = (chip: HTMLElement, key: string) =>
    chip.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CloudHost] }).compileComponents();
    fixture = TestBed.createComponent(CloudHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('makes each chip a radio, checked per the bound value — the state the chip paints from', () => {
    expect(chips()).toHaveLength(3);
    expect(chips().map((x) => x.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('selects on click, through the two-way value', () => {
    chips()[1].click();

    expect(host.value()).toBe('case');
  });

  // ONE tab stop however many chips exist is the radiogroup contract, and the
  // point of the pattern: a cloud may hold thirty chips, and thirty tab stops
  // between the field and the results would be worse than one stop and arrows.
  it('roves the single tab stop with the selection', () => {
    expect(chips().map((x) => x.tabIndex)).toEqual([0, -1, -1]);

    chips()[2].click();
    fixture.detectChanges();

    expect(chips().map((x) => x.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('keeps the group reachable when the value names no option', () => {
    host.value.set('nope');
    fixture.detectChanges();

    expect(chips()[0].tabIndex).toBe(0);
  });

  it('moves and selects with arrows, wrapping at both ends', () => {
    key(chips()[0], 'ArrowLeft');
    expect(host.value()).toBe('customer');

    fixture.detectChanges();
    key(chips()[2], 'ArrowRight');
    expect(host.value()).toBe('all');
  });

  it('jumps with Home and End, and moves focus with the selection', () => {
    key(chips()[0], 'End');
    fixture.detectChanges();

    expect(host.value()).toBe('customer');
    expect(document.activeElement).toBe(chips()[2]);

    key(chips()[2], 'Home');
    expect(host.value()).toBe('all');
  });
});

@Component({
  imports: [Chip, ChipSet, ChipSetOption],
  template: `
    <div chipSet role="group" [selected]="selected()" (toggled)="toggled = $event" (soloed)="soloed = $event">
      @for (option of options; track option) {
        <button chip variant="filled" type="button" [chipSetOption]="option">{{ option }}</button>
      }
    </div>
  `,
})
class SetHost {
  options = ['id', 'name', 'email'];
  selected = signal<string[]>(['id', 'name']);
  toggled: string | null = null;
  soloed: string | null = null;
}

describe('ChipSet', () => {
  let fixture: ComponentFixture<SetHost>;
  let host: SetHost;

  const chips = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('button'));
  const key = (chip: HTMLElement, key: string) =>
    chip.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SetHost] }).compileComponents();
    fixture = TestBed.createComponent(SetHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('makes each chip a toggle button, one pressed state per selected value', () => {
    expect(chips().map((x) => x.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false']);
  });

  it('emits the value on click, without owning the state', () => {
    chips()[2].click();
    fixture.detectChanges();

    expect(host.toggled).toBe('email');
    // Intent only — the host still decides; nothing flipped on its own.
    expect(chips()[2].getAttribute('aria-pressed')).toBe('false');
  });

  it('solos on ctrl-click and meta-click, the only way in', () => {
    chips()[0].dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
    expect(host.soloed).toBe('id');
    expect(host.toggled).toBeNull();

    chips()[1].dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));
    expect(host.soloed).toBe('name');
    expect(host.toggled).toBeNull();
  });

  it('keeps every chip in the tab order', () => {
    expect(chips().map((x) => x.tabIndex)).toEqual([0, 0, 0]);
  });

  it('walks focus with arrows, wrapping, with Home/End jumps — never the selection', () => {
    chips()[0].focus();
    key(chips()[0], 'ArrowRight');
    expect(document.activeElement).toBe(chips()[1]);

    key(chips()[1], 'ArrowLeft');
    expect(document.activeElement).toBe(chips()[0]);

    key(chips()[0], 'ArrowLeft');
    expect(document.activeElement).toBe(chips()[2]);

    key(chips()[2], 'Home');
    expect(document.activeElement).toBe(chips()[0]);

    key(chips()[0], 'End');
    expect(document.activeElement).toBe(chips()[2]);

    expect(host.toggled).toBeNull();
  });
});

@Component({
  imports: [Chip, ChipAction, ChipDismiss],
  template: `
    <button chip id="plain-dismissible" type="button">
      Label
      <button chipDismiss id="dismiss" type="button" aria-label="Remove"></button>
    </button>

    <div chip id="composite-dismissible">
      <button chipAction type="button" role="tab" aria-selected="false">
        <i chipLead class="lead"></i>
        Tab name
      </button>
      @if (dismissible()) {
        <button chipDismiss id="composite-dismiss" type="button" aria-label="Remove">
          <span class="custom-glyph">x</span>
        </button>
      }
    </div>
  `,
})
class DismissHost {
  dismissible = signal(true);
}

describe('ChipDismiss', () => {
  let fixture: ComponentFixture<DismissHost>;
  const el = (selector: string): HTMLElement => fixture.nativeElement.querySelector(selector);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DismissHost] }).compileComponents();
    fixture = TestBed.createComponent(DismissHost);
    fixture.detectChanges();
  });

  it('is projected last, after the label — it positions itself over the chip’s end', () => {
    const children = Array.from(el('#plain-dismissible').children);

    expect(children.map((child) => child.id || child.className)).toEqual(['m-chip__label', 'dismiss']);
  });

  it('draws the close glyph by default, and a projected one instead when given', () => {
    expect(el('#dismiss mat-icon')?.textContent?.trim()).toBe('close');

    expect(el('#composite-dismiss mat-icon')).toBeNull();
    expect(el('#composite-dismiss .custom-glyph')).not.toBeNull();
  });

  it('gives a composite chip’s action its own lead slot and label box, where the fade applies', () => {
    const action = el('#composite-dismissible [chipAction]');
    const children = Array.from(action.children);

    expect(children.map((child) => child.className)).toEqual(['lead', 'm-chip-action__label']);
    expect(action.querySelector('.m-chip-action__label')?.textContent?.trim()).toBe('Tab name');
  });

  it('opts in by presence alone — removing the ✕ makes the chip a plain one again', () => {
    expect(el('#composite-dismissible').querySelector(':scope > [chipDismiss]')).not.toBeNull();

    fixture.componentInstance.dismissible.set(false);
    fixture.detectChanges();

    expect(el('#composite-dismissible').querySelector(':scope > [chipDismiss]')).toBeNull();
  });
});
