import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, disabled, form, readonly } from '@angular/forms/signals';
import { ToggleButtonGroup } from './toggle-button-group';
import { ToggleButtonGroupIcon, ToggleButtonGroupText } from './toggle-button-group-item';

type Scheme = 'light' | 'dark' | 'auto';

/** A host the way a settings row uses the pair without a form: two-way
    on a signal, one toggle per choice, the middle one optionally out. */
@Component({
  imports: [ToggleButtonGroup, ToggleButtonGroupIcon, ToggleButtonGroupText],
  template: `<div (keydown)="heard = heard + 1">
    <hk-tgb
      aria-label="Appearance"
      [disabled]="disabled()"
      [readonly]="readonly()"
      [(value)]="scheme"
      (touch)="touches = touches + 1"
    >
      <button hkTgbIcon value="light" aria-label="Light"><svg></svg></button>
      <a hkTgbIcon value="dark" aria-label="Dark" href="#dark" [aria-disabled]="darkOut()"><i></i></a>
      <div hkTgbText value="auto">Auto</div>
    </hk-tgb>
    <button id="after">after</button>
  </div>`,
})
class Host {
  readonly scheme = signal<Scheme>('auto');
  readonly disabled = signal(false);
  readonly readonly = signal(false);
  readonly darkOut = signal(false);
  heard = 0;
  touches = 0;
}

describe('ToggleButtonGroup', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let group: HTMLElement;

  const toggles = () => [...group.querySelectorAll<HTMLElement>('[role=radio]')];
  const checked = () => toggles().map((toggle) => toggle.getAttribute('aria-checked'));
  const tabbable = () => toggles().map((toggle) => toggle.tabIndex);
  const press = (target: HTMLElement, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    group = (fixture.nativeElement as HTMLElement).querySelector('hk-tgb')!;
    document.body.append(fixture.nativeElement);
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('is a radio group of radios, the value one checked', () => {
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(toggles().map((toggle) => toggle.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
    expect(checked()).toEqual(['false', 'false', 'true']);
  });

  it('makes any element an item: a button never submits, a link or div gets no type', () => {
    const [button, link, div] = toggles();
    expect(button.getAttribute('type')).toBe('button');
    expect(link.hasAttribute('type')).toBe(false);
    expect(div.hasAttribute('type')).toBe(false);
  });

  it('takes no place from a box that is not laid out', async () => {
    // jsdom lays nothing out: every box is 0 wide, as out of sight. The
    // thumb keeps waiting for a real one (the render spec places it).
    expect(group.hasAttribute('data-empty')).toBe(false);
    expect(group.style.getPropertyValue('--hk-tgb-thumb-width')).toBe('');
  });

  it('picks a toggle on click, into the value', async () => {
    toggles()[1].click();
    await fixture.whenStable();
    expect(host.scheme()).toBe('dark');
    expect(checked()).toEqual(['false', 'true', 'false']);
  });

  it('is one tab stop: the picked toggle', async () => {
    expect(tabbable()).toEqual([-1, -1, 0]);
    host.scheme.set('dark');
    await fixture.whenStable();
    expect(tabbable()).toEqual([-1, 0, -1]);
  });

  it('moves the pick with Left and Right, wrapping, and Home and End', async () => {
    toggles()[2].focus();
    press(toggles()[2], 'ArrowRight');
    await fixture.whenStable();
    expect(host.scheme()).toBe('light');
    expect(document.activeElement).toBe(toggles()[0]);

    press(toggles()[0], 'ArrowLeft');
    await fixture.whenStable();
    expect(host.scheme()).toBe('auto');

    press(toggles()[2], 'Home');
    await fixture.whenStable();
    expect(host.scheme()).toBe('light');

    press(toggles()[0], 'End');
    await fixture.whenStable();
    expect(host.scheme()).toBe('auto');
  });

  it('spends the keys it acts on, and leaves the rest to what is around it', async () => {
    toggles()[2].focus();
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'Enter']) {
      expect(press(document.activeElement as HTMLElement, key).defaultPrevented).toBe(true);
    }
    expect(host.heard).toBe(0);

    const down = press(document.activeElement as HTMLElement, 'ArrowDown');
    press(document.activeElement as HTMLElement, 'Escape');
    expect(down.defaultPrevented).toBe(false);
    expect(host.heard).toBe(2);
  });

  it('skips a disabled toggle with the keys, and does not pick it on click', async () => {
    host.darkOut.set(true);
    await fixture.whenStable();
    expect(toggles()[1].getAttribute('aria-disabled')).toBe('true');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    toggles()[1].dispatchEvent(click);
    await fixture.whenStable();
    // A disabled link is not followed either.
    expect(click.defaultPrevented).toBe(true);
    expect(host.scheme()).toBe('auto');

    toggles()[2].focus();
    press(toggles()[2], 'ArrowLeft');
    await fixture.whenStable();
    expect(host.scheme()).toBe('light');
  });

  it('holds the value while disabled, with no tab stop', async () => {
    host.disabled.set(true);
    await fixture.whenStable();
    expect(group.getAttribute('aria-disabled')).toBe('true');
    expect(tabbable()).toEqual([-1, -1, -1]);
    toggles()[0].click();
    await fixture.whenStable();
    expect(host.scheme()).toBe('auto');
  });

  it('moves focus but not the pick while read-only', async () => {
    host.readonly.set(true);
    await fixture.whenStable();
    expect(group.getAttribute('aria-readonly')).toBe('true');
    toggles()[2].focus();
    press(toggles()[2], 'ArrowLeft');
    toggles()[0].click();
    await fixture.whenStable();
    expect(host.scheme()).toBe('auto');
    expect(document.activeElement).toBe(toggles()[1]);
  });

  it('picks none for a value no toggle carries, the first enabled one the tab stop', async () => {
    host.scheme.set('sepia' as Scheme);
    await fixture.whenStable();
    expect(checked()).toEqual(['false', 'false', 'false']);
    expect(group.hasAttribute('data-empty')).toBe(true);
    expect(tabbable()).toEqual([0, -1, -1]);
  });

  it('emits touch once focus leaves the group, not while it moves inside', async () => {
    toggles()[2].focus();
    toggles()[0].focus();
    expect(host.touches).toBe(0);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#after')!.focus();
    expect(host.touches).toBe(1);
  });
});

/** The same pair under signal forms: `[formField]` drives the value and
    pushes the field's state in. */
@Component({
  imports: [ToggleButtonGroup, ToggleButtonGroupIcon, ToggleButtonGroupText, FormField],
  template: `<hk-tgb aria-label="Appearance" [formField]="settings.scheme">
      <button hkTgbIcon value="light" aria-label="Light"></button>
      <button hkTgbIcon value="dark" aria-label="Dark"></button>
      <button hkTgbText value="auto">Auto</button>
    </hk-tgb>
    <button id="after">after</button>`,
})
class FormHost {
  readonly model = signal<{ scheme: Scheme }>({ scheme: 'light' });
  readonly locked = signal(false);
  readonly frozen = signal(false);
  readonly settings = form(this.model, (path) => {
    disabled(path.scheme, () => this.locked());
    readonly(path.scheme, () => this.frozen());
  });
}

describe('ToggleButtonGroup under signal forms', () => {
  let fixture: ComponentFixture<FormHost>;
  let host: FormHost;
  let group: HTMLElement;

  const toggles = () => [...group.querySelectorAll<HTMLElement>('[role=radio]')];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormHost] }).compileComponents();
    fixture = TestBed.createComponent(FormHost);
    host = fixture.componentInstance;
    await fixture.whenStable();
    group = (fixture.nativeElement as HTMLElement).querySelector('hk-tgb')!;
    document.body.append(fixture.nativeElement);
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('shows the field value and writes picks back into the model', async () => {
    expect(toggles()[0].getAttribute('aria-checked')).toBe('true');
    toggles()[2].click();
    await fixture.whenStable();
    expect(host.model().scheme).toBe('auto');
    expect(host.settings.scheme().dirty()).toBe(true);
  });

  it('takes the field value when the model changes', async () => {
    host.model.set({ scheme: 'dark' });
    await fixture.whenStable();
    expect(toggles()[1].getAttribute('aria-checked')).toBe('true');
  });

  it('follows the field disabled and read-only', async () => {
    host.locked.set(true);
    await fixture.whenStable();
    expect(group.getAttribute('aria-disabled')).toBe('true');
    toggles()[1].click();
    await fixture.whenStable();
    expect(host.model().scheme).toBe('light');

    host.locked.set(false);
    host.frozen.set(true);
    await fixture.whenStable();
    expect(group.getAttribute('aria-readonly')).toBe('true');
    toggles()[1].click();
    await fixture.whenStable();
    expect(host.model().scheme).toBe('light');
  });

  it('marks the field touched when focus leaves it', async () => {
    toggles()[0].focus();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#after')!.focus();
    await fixture.whenStable();
    expect(host.settings.scheme().touched()).toBe(true);
  });
});

/** Items an `@for` makes, each value bound — a language picker. */
@Component({
  imports: [ToggleButtonGroup, ToggleButtonGroupText],
  template: `<hk-tgb aria-label="Language" [(value)]="language">
    @for (code of codes; track code) {
      <button hkTgbText [value]="code">{{ code }}</button>
    }
  </hk-tgb>`,
})
class LoopHost {
  readonly codes = ['en', 'ja', 'de'];
  readonly language = signal('de');
}

describe('ToggleButtonGroup over an @for', () => {
  it('binds every item before reading any — the tab stop on the picked one', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fixture = TestBed.createComponent(LoopHost);
      await fixture.whenStable();
      const toggles = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role=radio]')];
      expect(toggles.map((toggle) => toggle.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
      expect(toggles.map((toggle) => toggle.tabIndex)).toEqual([-1, -1, 0]);

      fixture.componentInstance.language.set('ja');
      await fixture.whenStable();
      expect(toggles.map((toggle) => toggle.tabIndex)).toEqual([-1, 0, -1]);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
