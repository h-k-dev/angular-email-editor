import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { hue } from '../../../../core/randomisation/hue';
import { HueOf } from '../hue-of/hue-of';
import { Avatar } from './avatar';

@Component({
  imports: [Avatar, HueOf],
  template: `
    <span class="alone" [avatar]="name()"></span>
    <div class="row" [hueOf]="seed()">
      <span class="inside" [avatar]="name()"></span>
    </div>
  `,
})
class Host {
  readonly name = signal('Jane Doe');
  readonly seed = signal('reply');
}

describe('Avatar and HueOf', () => {
  let fixture: ComponentFixture<Host>;
  const el = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)!;
  const hueOn = (selector: string) => el(selector).style.getPropertyValue('--avatar-hue');

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('makes an element an avatar: its initials written in, decoration only', () => {
    expect(el('.alone').classList).toContain('avatar');
    expect(el('.alone').textContent).toBe('JD');
    expect(el('.alone').getAttribute('aria-hidden')).toBe('true');
  });

  it('wears its own name’s hue on its own', () => {
    expect(hueOn('.alone')).toBe(String(hue('Jane Doe')));
  });

  it('wears its container’s hue inside one, setting none of its own', () => {
    expect(el('.row').classList).toContain('hued');
    expect(hueOn('.row')).toBe(String(hue('reply')));
    expect(hueOn('.inside')).toBe('');
  });

  it('follows the name and the seed as they change', async () => {
    fixture.componentInstance.name.set('ops@example.com');
    fixture.componentInstance.seed.set('mjml');
    await fixture.whenStable();
    expect(el('.alone').textContent).toBe('O');
    expect(hueOn('.alone')).toBe(String(hue('ops@example.com')));
    expect(hueOn('.row')).toBe(String(hue('mjml')));
  });
});
