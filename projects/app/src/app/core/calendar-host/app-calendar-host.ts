import { Provider, inject } from '@angular/core';

// Types and a token only: a runtime import of the calendar here would
// bring Luxon into the first load, which the lazy calendar route keeps out.
import { CALENDAR_HOST, CalendarHost } from '../calendar/calendar-host';
import { LocalStorage } from '../storages/local-storage';
import { Preferences } from '../storages/preferences';
import { I18n } from '../translations/i18n';
import { Region } from '../translations/region';

/**
 * The app as the calendar's host ({@link CalendarHost}): the app's
 * language, the app settings' Calendar region and Minimum duration, and
 * this browser's storage for what the calendar keeps — every tab sees it,
 * a reload keeps it. The one place the calendar meets the app.
 */
export function provideAppCalendarHost(): Provider {
  return {
    provide: CALENDAR_HOST,
    useFactory: (): CalendarHost => {
      const i18n = inject(I18n);
      const storage = inject(LocalStorage);
      return {
        language: i18n.lang,
        region: inject(Region).current,
        minDuration: inject(Preferences).calendarMinDuration,
        store: (key, codec) => storage.pairSignal(`angular-email-editor:${key}`, codec),
        label: (key, params) => i18n.t(key, params),
      };
    },
  };
}
