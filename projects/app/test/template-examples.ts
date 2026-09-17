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

/** Opens a letter the way the iusta examples do: the salutation by gender. */
const SALUTATION =
  "<div>{{ customer_gender == 'male' ? 'Sehr geehrter Herr' : customer_gender == 'female' ? 'Sehr geehrte Frau' : 'Guten Tag' }} {{ customer_surname }},</div><div><br></div>";

const REGARDS = '<div><br></div><div>Mit freundlichen Grüßen</div><div>{{ user_name }}</div>';

const letter = (name: string, body: string): TemplateExample => ({
  name,
  html: SALUTATION + body + REGARDS,
});

/**
 * Everyday correspondence in the AngularJS dialect — the bulk of a real
 * template library, and what the composer's `/templates` search pages
 * through. Not part of the footer cycler.
 */
export const EVERYDAY_EXAMPLES: TemplateExample[] = [
  letter(
    'Eingangsbestätigung',
    '<div>wir bestätigen den Eingang Ihrer Nachricht vom {{ case_created | formatDateDE }} zum Vorgang {{ case_name }}.</div>',
  ),
  letter(
    'Terminbestätigung',
    '<div>hiermit bestätigen wir Ihren Termin am {{ cf_80 | formatDateDE }} um {{ cf_81 }} Uhr.</div>',
  ),
  letter(
    'Terminerinnerung',
    '<div>wir möchten Sie an Ihren Termin am {{ cf_80 | formatDateDE }} um {{ cf_81 }} Uhr erinnern.</div>',
  ),
  letter(
    'Unterlagen anfordern',
    "<div>für die weitere Bearbeitung benötigen wir noch folgende Unterlagen bis zum {{ cf_68 | calcDate:'+2 weeks' | formatDateDE }}:</div><ul><li>Personalausweis (Kopie)</li><li>Vertrag vom {{ cf_72 | formatDateDE }}</li></ul>",
  ),
  letter(
    'Zahlungserinnerung',
    '<div>zu unserer Rechnung {{ cf_75 }} über {{ cf_70 | formatPrice }}€ konnten wir noch keinen Zahlungseingang feststellen.</div>',
  ),
  letter(
    'Mahnung (zweite Stufe)',
    "<div>trotz Erinnerung ist der Betrag von {{ cf_70 | formatPrice }}€ weiterhin offen. Bitte überweisen Sie ihn bis zum {{ today | calcDate:'+7 days' | formatDateDE }}.</div>",
  ),
  letter(
    'Zahlungseingang bestätigt',
    '<div>vielen Dank, Ihre Zahlung über {{ cf_70 | formatPrice }}€ ist am {{ cf_76 | formatDateDE }} bei uns eingegangen.</div>',
  ),
  letter(
    'Vollmacht zur Unterschrift',
    '<div>anbei erhalten Sie die Vollmacht für {{ case_name }}. Bitte senden Sie sie uns unterschrieben zurück.</div>',
  ),
  letter(
    'Sachstandsmitteilung',
    "<div>zum aktuellen Stand in Ihrer Sache {{ case_name }}: {{ cf_71 ? 'Die Gegenseite hat reagiert.' : 'Eine Reaktion der Gegenseite steht noch aus.' }}</div>",
  ),
  letter(
    'Fristverlängerung beantragt',
    "<div>wir haben für Sie eine Verlängerung der Frist bis zum {{ cf_68 | calcDate:'+4 weeks' | formatDateDE }} beantragt.</div>",
  ),
  letter(
    'Mandatsbeendigung',
    '<div>hiermit bestätigen wir die Beendigung des Mandats {{ case_name }} zum {{ cf_77 | formatDateDE }}.</div>',
  ),
  letter(
    'Abwesenheitsnotiz',
    '<div>ich bin bis einschließlich {{ cf_78 | formatDateDE }} nicht erreichbar. In dringenden Fällen wenden Sie sich bitte an {{ cf_79 }}.</div>',
  ),
  letter(
    'Rückrufbitte',
    '<div>wir haben versucht, Sie telefonisch zu erreichen. Bitte rufen Sie uns unter {{ user_phone }} zurück.</div>',
  ),
  letter(
    'Kostenvoranschlag',
    '<table><tbody><tr><td>Leistung</td><td>Betrag</td></tr><tr><td>{{ case_name }}</td><td>{{ cf_70 | formatPrice }}€</td></tr><tr><td>MwSt (19%)</td><td>{{ round(parseFloat(cf_70) * 0.19,2) | formatPrice }}€</td></tr></tbody></table>',
  ),
  letter(
    'Vergleichsangebot weitergeleitet',
    '<div>die Gegenseite bietet einen Vergleich über {{ cf_73 | formatPrice }}€ an. Wir besprechen das Angebot gern mit Ihnen.</div>',
  ),
  letter(
    'Feedback erbeten',
    '<div>Ihre Sache {{ case_name }} ist abgeschlossen. Über eine kurze Rückmeldung zu unserer Arbeit würden wir uns freuen.</div>',
  ),
];
