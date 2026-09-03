/**
 * Dummy template bodies for the footer's example cycler — one set per
 * templating dialect the editor must transport faithfully. Demo data only:
 * nothing here ships with the library. Grow each list freely; the cycler
 * picks up new entries automatically.
 */
export interface TemplateExample {
  /** Short label shown in the status strip while the example is active. */
  name: string;
  /** The document, as canonical email HTML with the tokens verbatim. */
  html: string;
}

/**
 * AngularJS-expression templates — the iusta dialect (their vendored
 * `$parse`): ternaries, arithmetic, local assignments, `|` filter chains.
 * Condensed from a production iusta template.
 */
export const ANGULAR_EXPRESSION_EXAMPLES: TemplateExample[] = [
  {
    name: 'Anrede & Bedingungen',
    html:
      '<div>Sehr geehrte Damen und Herren,</div><div><br></div>' +
      "<div>{{ customer_gender == 'male' ? 'Herr' : 'Frau' }} {{ customer_surname }},</div>" +
      "<div>Direkte Entscheidung aus Boolean Feldwert: {{ cf_71 ? 'JA' : 'NEIN' }}</div>" +
      '<div><br></div><div>Mit freundlichen Grüßen,</div>',
  },
  {
    name: 'Rechnen & Filter',
    html:
      '<div>Einfache Rechnung: {{ 1+2+3+4+5 }}</div>' +
      '<div>Feldwert: {{ cf_70 }}</div>' +
      '<div>{{ mwst = round(parseFloat( cf_70 ) * 0.19,2); mwst }}</div>' +
      '<div>{{ cf_70 | formatPrice }}€ + {{ mwst | formatPrice }}€ = {{ parseFloat(cf_70) + mwst }}€</div>',
  },
  {
    name: 'Daten & calcDate',
    html:
      "<div>Fix: {{ '2021-09-21' | formatDateDE }}</div>" +
      "<div>Datum plus 5 Tage: {{ '2021-09-21' | calcDate:'+5days' | formatDateDE }}</div>" +
      "<div>Datum plus 4 Wochen: {{ cf_68 | calcDate:'+4 weeks' | formatDateDE }}</div>" +
      '<div>Aktuell: {{ now | formatDateTimeDE }}</div>' +
      '<div>Sonstiges: {{ doc_cf_67_storageKey }} — {{ case_name }}</div>',
  },
  {
    // One expression wider than the 600px column — a correct nested ternary,
    // 171 characters inside the braces: the token must wrap like text, over
    // two lines. The atom pill (inline-block, nowrap) could only overflow it;
    // the mark model wraps it.
    name: 'Lange Anrede (zweizeilig)',
    html:
      '<div>Sehr geehrte Damen und Herren,</div><div><br></div>' +
      "<div>{{ customer_gender == 'male' ? 'Sehr geehrter Herr ' + customer_surname : customer_gender == 'female' ? 'Sehr geehrte Frau ' + customer_surname : 'Guten Tag ' + customer_name }},</div>" +
      '<div><br></div><div>vielen Dank für Ihre Nachricht.</div>',
  },
  {
    // Four branches and string concatenation — 301 characters inside the
    // braces, three lines in the 600px column. Past the old 200 ceiling, so
    // it is also the proof that the ceiling is a runaway guard, not a limit.
    name: 'Sehr lange Anrede (dreizeilig)',
    html:
      '<div>Sehr geehrte Damen und Herren,</div><div><br></div>' +
      "<div>{{ customer_gender == 'male' ? 'Sehr geehrter Herr ' + customer_title + ' ' + customer_surname : customer_gender == 'female' ? 'Sehr geehrte Frau ' + customer_title + ' ' + customer_surname : customer_gender == 'diverse' ? 'Guten Tag ' + customer_firstname + ' ' + customer_surname : 'Sehr geehrte Damen und Herren' }},</div>" +
      '<div><br></div><div>vielen Dank für Ihre Nachricht.</div>',
  },
  {
    name: 'Tabelle & Spalten',
    html:
      '<div>Sehr geehrte Damen und Herren,</div><div><br></div>' +
      '<table><tbody>' +
      '<tr><td>Position</td><td>Betrag</td></tr>' +
      '<tr><td>{{ case_name }}</td><td>{{ cf_70 | formatPrice }}€</td></tr>' +
      '<tr><td>MwSt (19%)</td><td>{{ round(parseFloat(cf_70) * 0.19,2) | formatPrice }}€</td></tr>' +
      '</tbody></table>' +
      '<div><br></div>' +
      '<div style="width: 100%; max-width: 600px;">' +
      '<div style="display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;">' +
      '<div>Ihr Ansprechpartner:</div><div>{{ customer_surname }}</div>' +
      '</div>' +
      '<div style="display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;">' +
      "<div>Frist:</div><div>{{ cf_68 | calcDate:'+2 weeks' | formatDateDE }}</div>" +
      '</div>' +
      '</div>',
  },
];

/**
 * Handlebars templates — simple substitutions become pills; block helpers
 * (`{{#if}}`, `{{#each}}`) stay literal text on purpose, so the downstream
 * renderer still sees the full program.
 */
export const HANDLEBARS_EXAMPLES: TemplateExample[] = [
  {
    name: 'Simple fields',
    html:
      '<div>Hi {{ firstName }} {{ lastName }},</div><div><br></div>' +
      '<div>your order {{ orderId }} ships to {{ city }} on {{ shipDate }}.</div>' +
      '<div><br></div><div>Thanks,<br>{{ senderName }}</div>',
  },
  {
    name: 'Blocks stay literal',
    html:
      '<div>Hi {{ firstName }},</div><div><br></div>' +
      '<div>{{#if premium}}</div>' +
      '<div>Thanks for being a premium member!</div>' +
      '<div>{{else}}</div>' +
      '<div>Consider upgrading for free shipping.</div>' +
      '<div>{{/if}}</div>' +
      '<div><br></div><div>Your items:</div>' +
      '<div>{{#each items}}</div><div>- {{ name }}: {{ price }}</div><div>{{/each}}</div>',
  },
  {
    name: 'Table & columns',
    html:
      '<div>Hi {{ firstName }},</div><div><br></div>' +
      '<table><tbody>' +
      '<tr><td>Order</td><td>{{ orderId }}</td></tr>' +
      '<tr><td>Total</td><td>{{ total }}</td></tr>' +
      '<tr><td>Ships to</td><td>{{ city }}, {{ country }}</td></tr>' +
      '</tbody></table>' +
      '<div><br></div>' +
      '<div style="width: 100%; max-width: 600px;">' +
      '<div style="display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;">' +
      '<div>Questions?</div><div>{{ supportEmail }}</div>' +
      '</div>' +
      '<div style="display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;">' +
      '<div>Tracking:</div><div>{{ trackingUrl }}</div>' +
      '</div>' +
      '</div>',
  },
];
