import { TestBed } from '@angular/core/testing';

import { Region, systemRegion } from './region';

describe('Region', () => {
  it('places the system by its time zone first — where it is, not what it reads', () => {
    expect(systemRegion('Europe/London', ['de-DE'])).toBe('GB');
    expect(systemRegion('Asia/Tokyo', ['en-US'])).toBe('JP');
    expect(systemRegion('Europe/Berlin', ['ja'])).toBe('DE');
  });

  it('else by its languages, in order — a bare language by its own country', () => {
    expect(systemRegion('America/New_York', ['en-US', 'en-GB'])).toBe('GB');
    expect(systemRegion(undefined, ['ja'])).toBe('JP');
    expect(systemRegion('UTC', ['x-unreadable-tag!', 'de'])).toBe('DE');
  });

  it('falls back to Germany where the system is nowhere it knows', () => {
    expect(systemRegion('America/New_York', ['en-US', 'fr-FR'])).toBe('DE');
    expect(systemRegion(undefined, [])).toBe('DE');
  });

  it('follows the system until one is chosen, apart from the language', () => {
    const region = TestBed.inject(Region);
    expect(region.preference()).toBe('system');
    expect(region.current()).toBe('DE'); // test-setup's system region

    region.choose('JP');
    expect(region.current()).toBe('JP');
    expect(localStorage.getItem('angular-email-editor:region')).toBe('JP');
    expect(localStorage.getItem('angular-email-editor:language')).toBeNull();

    region.choose('system');
    expect(region.current()).toBe('DE');
    expect(localStorage.getItem('angular-email-editor:region')).toBeNull();
  });
});
