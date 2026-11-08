import { ViewportScroller } from '@angular/common';
import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipDefaultOptions } from '@angular/material/tooltip';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { provideI18n } from '../i18n/loader';

import { routes } from './app.routes';
import { provideAppCalendarHost } from './core/calendar-host/app-calendar-host';
import { provideDialogDefaults } from './core/layout/dialogs';
import { provideEveryScroll } from './core/layout/scrolling';
import { PageScroller } from './core/router/page-scroller';
import { Preferences } from './core/storages/preferences';
import { provideCustomSwatches } from '@h-k-dev/angular-email-editor/swatches';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Route params bind to inputs: the inbox reader's `id` is `/inbox/:id`.
    // A #fragment scrolls to its element and back returns to where the page
    // was left — on the sheet the page scrolls in, not the window
    // (`PageScroller`).
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    { provide: ViewportScroller, useExisting: PageScroller },
    // English is bundled; any other language is a chunk of its own, fetched
    // when it is first switched to (see i18n/loader.ts).
    provideI18n(),
    // The calendar meets the app here alone: its language, region, minimum
    // duration and where its events are kept (core/calendar/calendar-host).
    provideAppCalendarHost(),
    // The colours a user picked outside the palette, kept with their
    // preferences: offered again as swatches in every picker.
    provideCustomSwatches(() => inject(Preferences).customSwatches),
    // Every dialog: the page behind it blurred where the GPU paints it,
    // the stock backdrop where it has none. `{ blur: false }` turns the
    // blur off everywhere.
    provideDialogDefaults(),
    // Every overlay hears a scroll in any of the app's panes, not the
    // window's alone: a menu closes as what it stands over scrolls, a
    // popover keeps to its trigger.
    provideEveryScroll(),
    // Every tooltip waits a moment before it shows: a pointer passing over a
    // row of buttons on its way elsewhere raises none. Hiding stays
    // Material's.
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: {
        showDelay: 500,
        hideDelay: 0,
        touchendHideDelay: 1500,
      } satisfies MatTooltipDefaultOptions,
    },
  ],
};
