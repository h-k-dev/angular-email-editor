import { Service } from '@angular/core';

import { evaluateExpression } from './expression-evaluator';
import { Filter, applyFilter, respond } from './loopback-filter';

/** A personalization variable, as the backend's `MergeTag` model returns it. */
export interface MergeTag {
  /** The dotted path the token serializes as — `firstName`, `company.name`. */
  path: string;
  /** Human name for the menu row. */
  label: string;
}

/**
 * The variable catalogue of the `{{` menu. Stands in for
 * `GET /api/merge-tags?filter=…` on a LoopBack 3 backend, like
 * {@link Templates}: `find(filter)` answered by the shared filter mock after
 * a small latency, cancelled by an `AbortSignal`. A labelled core plus
 * enough custom fields to need paging.
 */
@Service()
export class MergeTags {
  readonly #rows: MergeTag[] = [
    { path: 'firstName', label: 'First name' },
    { path: 'lastName', label: 'Last name' },
    { path: 'email', label: 'Email address' },
    { path: 'company.name', label: 'Company' },
    { path: 'unsubscribeUrl', label: 'Unsubscribe URL' },
    { path: 'otp.code', label: 'One-time code' },
    { path: 'otp.minutes', label: 'One-time code valid for (minutes)' },
    { path: 'otp.requestedAt', label: 'One-time code requested at' },
    { path: 'otp.device', label: 'One-time code requested from (device)' },
    { path: 'otp.location', label: 'One-time code requested near (place)' },
    { path: 'otp.reference', label: 'One-time code reference' },
    { path: 'company.website', label: 'Company website' },
    { path: 'company.address', label: 'Company address' },
    { path: 'company.logoUrl', label: 'Company logo URL' },
    { path: 'company.bannerUrl', label: 'Company banner image URL' },
    { path: 'order.number', label: 'Order number' },
    { path: 'order.date', label: 'Order date' },
    { path: 'order.item', label: 'Order item' },
    { path: 'order.total', label: 'Order total' },
    { path: 'shipment.merchant', label: 'Shipment sent by (shop)' },
    { path: 'shipment.merchantLogoUrl', label: 'Shipment shop logo URL' },
    { path: 'shipment.trackingNumber', label: 'Tracking number' },
    { path: 'shipment.trackingUrl', label: 'Tracking URL' },
    { path: 'shipment.eta', label: 'Expected delivery day' },
    { path: 'shipment.window', label: 'Expected delivery window' },
    { path: 'clearance.production', label: 'Rights clearance production' },
    { path: 'clearance.photographer', label: 'Rights clearance photographer' },
    { path: 'clearance.location', label: 'Rights clearance location' },
    { path: 'clearance.rights', label: 'Rights clearance usage rights' },
    { path: 'clearance.caseNumber', label: 'Rights clearance case number' },
    { path: 'clearance.shootDate', label: 'Rights clearance shooting date' },
    { path: 'clearance.fee', label: 'Rights clearance licence fee' },
    ...Array.from({ length: 80 }, (_, i) => ({
      path: `custom.field${i + 1}`,
      label: `Custom field ${i + 1}`,
    })),
  ];

  find(filter: Filter<MergeTag> = {}, signal?: AbortSignal): Promise<MergeTag[]> {
    return respond(applyFilter(this.#rows, filter), signal);
  }

  /** The one contact the demo fills placeholders in for, by path. A Map,
      not an object: the key is whatever the author typed between the braces,
      and `{{ constructor }}` must find nothing, not what every object
      inherits. */
  readonly #sample: ReadonlyMap<string, string> = new Map([
    ['firstName', 'Ada'],
    ['lastName', 'Lovelace'],
    ['email', 'ada@example.com'],
    ['company.name', 'Analytical Engines Ltd'],
    ['unsubscribeUrl', 'https://example.com/unsubscribe'],
    // The one-time code the sign-in example sends
    // (examples/angularjs/sign-in-code.html).
    ['otp.code', '483920'],
    ['otp.minutes', '10'],
    ['otp.requestedAt', '25.10.2026, 14:32'],
    ['otp.device', 'Firefox on Windows'],
    ['otp.location', 'Berlin, Germany'],
    ['otp.reference', 'OTP-7F3K-92QD'],
    ['company.website', 'example.com'],
    ['company.address', 'Example Street 1, 10115 Berlin'],
    // The demo's own logo (public/assets/brand) — a real host fills an
    // absolute https URL, which is what a sent email needs.
    ['company.logoUrl', 'assets/brand/logo.png'],
    // The picture behind a hero band (a section's image), the same way.
    ['company.bannerUrl', 'assets/brand/banner.png'],
    // The order the confirmation example confirms
    // (examples/angularjs/order-confirmation.html).
    ['order.number', 'A-10427'],
    ['order.date', '25.10.2026'],
    ['order.item', 'Difference Engine No. 2 (kit)'],
    ['order.total', '149,00 €'],
    // The parcel the shipping example announces
    // (examples/angularjs/shipping-confirmation.html).
    ['shipment.merchant', 'Babbage & Daughters'],
    ['shipment.merchantLogoUrl', 'assets/brand/merchant.png'],
    ['shipment.trackingNumber', '00340434161094042557'],
    ['shipment.trackingUrl', 'https://example.com/track/00340434161094042557'],
    ['shipment.eta', 'Tuesday, 27.10.2026'],
    ['shipment.window', '12:00 – 15:30'],
    // The shoot the rights request asks about
    // (examples/angularjs/rechteanfrage.html).
    ['clearance.production', 'Analytical Engines – Herbst/Winter 2026'],
    ['clearance.photographer', 'Mara Lindqvist'],
    ['clearance.location', 'Tempelhofer Feld, Berlin'],
    ['clearance.rights', 'Print, Online und Social Media, DACH, 12 Monate'],
    ['clearance.caseNumber', 'RC-2026-0187'],
    ['clearance.shootDate', '14.10.2026'],
    ['clearance.fee', '2.400,00'],
    // The custom fields the AngularJS example's trade-mark table reads
    // (examples/angularjs/platzhalter-im-ueberblick.html): its mark and
    // infringement are choices,
    // stored as the keys its ternaries test.
    ['custom.field1', 'swoosh'],
    ['custom.field2', 'UK00000123456'],
    ['custom.field3', 'marktplatz'],
    ['custom.field4', '20.10.2026'],
    ['custom.field5', '12'],
    ['custom.field6', 'https://example.com/listing/4711'],
    ['custom.field7', 'BP-2026-0042'],
  ]);

  /**
   * Values for placeholder expressions, in order. Stands in for
   * `POST /api/TextParser/parseStrings` — iusta's evaluator, which compiles
   * each `{{…}}` as an AngularJS expression against the case. This one
   * evaluates them too ({@link evaluateExpression}) against one sample
   * contact: a field it has no value for, a helper call or a filter comes
   * back empty, the way a real evaluator answers a field without a value.
   */
  resolve(expressions: readonly string[], signal?: AbortSignal): Promise<string[]> {
    return respond(
      expressions.map((expression) =>
        evaluateExpression(expression, (path) => this.#sample.get(path)),
      ),
      signal,
    );
  }
}
