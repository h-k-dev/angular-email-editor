import { DOCUMENT, InjectionToken, Service, computed, inject } from '@angular/core';

import { Preferences } from '../storages/preferences';
import {
  FALLBACK_REGION,
  REGIONS,
  RegionCode,
  RegionPreference,
} from '../calendar/calendar-regions';

export { FALLBACK_REGION, REGIONS };
export type { RegionCode, RegionPreference };

/** The time zones that place a system in a region — where it is, not the
    language it reads: an English browser in Berlin is in Germany. */
const ZONE_REGIONS: Readonly<Record<string, RegionCode>> = {
  'Europe/Berlin': 'DE',
  'Europe/Busingen': 'DE',
  'Europe/London': 'GB',
  'Europe/Belfast': 'GB',
  GB: 'GB',
  'GB-Eire': 'GB',
  'Asia/Tokyo': 'JP',
  Japan: 'JP',
};

const isRegion = (code: string | undefined): code is RegionCode =>
  REGIONS.some((region) => region === code);

/**
 * The region a system is in, of those the app knows: its time zone's
 * first — where the clock is set is where it is — then its languages' in
 * order (`en-GB` → GB, a bare `ja` → JP), else {@link FALLBACK_REGION}.
 * Pure: the system's zone and languages in.
 */
export function systemRegion(
  timeZone: string | undefined,
  languages: readonly string[],
): RegionCode {
  const zoned = timeZone ? ZONE_REGIONS[timeZone] : undefined;
  if (zoned) return zoned;
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).maximize().region;
      if (isRegion(region)) return region;
    } catch {
      // An unreadable tag says nothing: the next one may.
    }
  }
  return FALLBACK_REGION;
}

/** The system's region, read from the browser as the app starts — a spec
    names one, so it reads the same on every machine and in every zone. */
export const SYSTEM_REGION = new InjectionToken<RegionCode>('SYSTEM_REGION', {
  providedIn: 'root',
  factory: () => {
    const navigator = inject(DOCUMENT).defaultView?.navigator;
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }
    return systemRegion(zone, navigator?.languages ?? [navigator?.language ?? '']);
  },
});

/**
 * Where the app's user is, for what follows a place and not a language —
 * the calendar's week, its week numbers, its holidays. Apart from the
 * language entirely (`I18n`): German words over a Japanese calendar are as
 * good as any.
 *
 * The region is a {@link Preferences} one — the app settings' Calendar
 * region. Unset, it is the system's ({@link SYSTEM_REGION}).
 */
@Service()
export class Region {
  readonly #chosen = inject(Preferences).region;

  readonly regions = REGIONS;

  /** The system's region: its time zone's, its languages', else Germany. */
  readonly system = inject(SYSTEM_REGION);

  /** The region as chosen — `system` while none is. */
  readonly preference = this.#chosen.asReadonly();

  /** The region in use. */
  readonly current = computed<RegionCode>(() => {
    const chosen = this.#chosen();
    return chosen === 'system' ? this.system : chosen;
  });

  /** The region from now on — `system` follows the system's again. */
  choose(region: RegionPreference): void {
    this.#chosen.set(region);
  }
}
