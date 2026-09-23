/**
 * German. English is not a file: it is what the code says — the library's
 * action titles, the composer's labels — and every lookup falls back to it
 * (`I18n.t(key, fallback)`). A translation only has to say what differs.
 *
 * `editor.actions.<id>` is keyed by the library's action ids — the same ids
 * a `/` menu's rows and a toolbar's buttons carry — plus the composer's own
 * groups (`templates`, `ai`). `keywords` are *added* to the English ones:
 * the menu searches both languages at once.
 */
export default {
  app: {
    nav: { composer: 'Editor', api: 'API', styling: 'Gestaltung' },
    language: 'Sprache',
    compose: 'Verfassen',
    theme: { light: 'Zum hellen Design wechseln', dark: 'Zum dunklen Design wechseln' },
  },
  composeWindow: {
    new: 'Neue Nachricht',
    minimize: 'Minimieren',
    restore: 'Wiederherstellen',
    expand: 'Vollbild',
    collapse: 'Vollbild beenden',
    close: 'Schließen',
    sent: 'Nachricht gesendet',
  },
  editor: {
    actions: {
      text: { title: 'Text', keywords: 'absatz, fließtext' },
      'heading-1': { title: 'Überschrift 1', keywords: 'überschrift, titel' },
      'heading-2': { title: 'Überschrift 2', keywords: 'überschrift, titel' },
      'heading-3': { title: 'Überschrift 3', keywords: 'überschrift, titel' },
      quote: { title: 'Zitat', keywords: 'zitat, zitieren' },
      'bulleted-list': { title: 'Aufzählung', keywords: 'liste, aufzählung, punkte' },
      'numbered-list': { title: 'Nummerierte Liste', keywords: 'liste, nummeriert' },
      image: { title: 'Bild', keywords: 'bild, foto, grafik' },
      'image-placeholder': { title: 'Bildplatzhalter', keywords: 'bild, platzhalter' },
      divider: { title: 'Trennlinie', keywords: 'linie, trenner' },
      button: { title: 'Schaltfläche', keywords: 'knopf, schaltfläche' },
      'button-link': { title: 'Schaltflächen-Link', keywords: 'schaltfläche, knopf, link, handlungsaufforderung' },
      table: { title: 'Tabelle', keywords: 'tabelle, raster' },
      'bordered-table': { title: 'Tabelle mit Rahmen', keywords: 'tabelle, rahmen' },
      columns: { title: 'Spalten', keywords: 'spalten, layout' },
      '3-columns': { title: '3 Spalten', keywords: 'spalten, layout' },
      bold: { title: 'Fett', keywords: 'fett, hervorheben' },
      italic: { title: 'Kursiv', keywords: 'kursiv, schräg' },
      underline: { title: 'Unterstrichen', keywords: 'unterstreichen' },
      strike: { title: 'Durchgestrichen', keywords: 'durchstreichen' },
      'replace-image': { title: 'Bild ersetzen', keywords: 'bild, ersetzen, austauschen' },
      'remove-image': { title: 'Bild entfernen', keywords: 'bild, entfernen, löschen' },
      'align-left': { title: 'Linksbündig', keywords: 'ausrichten, links' },
      'align-center': { title: 'Zentriert', keywords: 'ausrichten, mitte, zentrieren' },
      'align-right': { title: 'Rechtsbündig', keywords: 'ausrichten, rechts' },
      indent: { title: 'Einzug vergrößern', keywords: 'einzug, einrücken' },
      outdent: { title: 'Einzug verkleinern', keywords: 'einzug, ausrücken' },
      'clear-formatting': { title: 'Formatierung entfernen', keywords: 'formatierung, löschen' },
      send: { title: 'Senden', keywords: 'senden, abschicken' },
      templates: {
        title: 'Vorlagen',
        keywords: 'vorlage, baustein',
        placeholder: 'Vorlagen durchsuchen…',
      },
      ai: {
        title: 'KI: für mich schreiben',
        keywords: 'ki, assistent, schreiben, weiter, entwurf, e-mail, vorschlag',
      },
    },
    // A button's words, where they differ from the row's: "Insert table"
    // on a bar, "Table" in a list.
    toolbar: {
      'image-alt': 'Alternativtext',
      'text-color': 'Textfarbe',
      highlight: 'Hervorhebungsfarbe',
      link: 'Link',
      strike: 'Durchgestrichen',
      table: 'Tabelle einfügen',
    },
    link: {
      dialog: 'Link bearbeiten',
      url: 'Link-URL',
      apply: 'Link übernehmen',
      open: 'Link öffnen',
      remove: 'Link entfernen',
    },
    button: {
      menu: 'Schaltflächenoptionen',
    },
    image: {
      menu: 'Bildoptionen',
      addAlt: 'Alternativtext hinzufügen',
      altLabel: 'Alternativtext',
      altPlaceholder: 'Bild beschreiben',
      altWithValue: 'Alternativtext: {{alt}}',
      applyAlt: 'Alternativtext übernehmen',
    },
    menu: {
      slash: { label: 'Block einfügen', placeholder: 'Tippen zum Filtern…' },
      tokens: { label: 'Personalisierung', placeholder: 'Variablen durchsuchen…' },
      loading: 'Suche…',
      loadingMore: 'Weitere werden geladen…',
      empty: 'Keine Treffer',
      error: 'Vorschläge konnten nicht geladen werden',
      back: 'Zurück',
      results: { one: '1 Treffer', other: '{{count}} Treffer' },
      selection: 'Auswahl formatieren',
    },
  },
};
