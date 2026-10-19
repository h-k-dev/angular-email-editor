/**
 * English — the app's own words, and the fallback of every other language
 * (`fallbackLang: 'en'`): a key German or Japanese does not say reads as
 * this. It is bundled, not lazy, so the first frame has words, not keys.
 *
 * Templates read it through ngx-translate's own pipe —
 * `{{ 'composer.more' | translate }}` — as core's copy of this kit does, with
 * the same key names, so a component moves between the two unchanged.
 *
 * `editor.actions.<id>` is *not* here for the library's actions: their
 * English is the library's own title (see `I18n.suggestionLabel`). Only the
 * composer's own groups are.
 */
export default {
  app: {
    nav: { composer: 'Composer', inbox: 'Inbox', api: 'API', styling: 'Styling', render: 'Render' },
    language: 'Language',
    compose: 'Compose',
    theme: { light: 'Switch to light mode', dark: 'Switch to dark mode' },
  },
  inbox: {
    title: 'Inbox',
    to: 'To',
    cc: 'Cc',
    reply: 'Reply',
    replyAll: 'Reply all',
    forward: 'Forward',
  },
  composeWindow: {
    new: 'New message',
    minimize: 'Minimize',
    restore: 'Restore',
    expand: 'Full screen',
    collapse: 'Exit full screen',
    close: 'Close',
    sent: 'Message sent',
  },
  composer: {
    format: { title: 'Format', html: 'HTML', text: 'Plain text' },
    view: { title: 'View', editor: 'Editor', html: 'HTML' },
    attach: 'Attach files',
    more: 'More options',
    settings: {
      title: 'Settings',
      close: 'Close settings',
      message: 'Message',
      formatHint: 'What the message is written and sent as',
      themeHint: 'The editor on its own paper, or the app’s theme',
      layout: {
        title: 'Layout',
        label: 'Layout blocks',
        hint: 'Sections, columns and tables: grips, resizing, adding and removing',
        plainText: 'Plain text has no layout',
        note: 'Off, every block stands as laid out: its text still edits, its structure takes no gesture.',
      },
    },
    appearance: { title: 'Appearance', theme: 'Theme', light: 'Light', dark: 'Dark', auto: 'Auto' },
    placeholders: {
      filled: 'Placeholders filled in',
      empty: {
        one: '1 placeholder had no value',
        other: '{{count}} placeholders had no value',
      },
      failed: 'Placeholders could not be filled in',
    },
  },
  editor: {
    placeholder: {
      line: 'Write something, or type / for commands',
      heading: 'Heading {{level}}',
      quote: 'Empty quote',
      list: 'List',
      image: 'Add an image',
    },
    quoted: {
      show: 'Show quoted text',
      hide: 'Hide quoted text',
      edit: 'Edit quoted text',
      remove: 'Remove quoted text',
    },
    actions: {
      'resolve-placeholders': { title: 'Fill in placeholders' },
    },
    ai: {
      dialog: 'Writing assistant',
      instructions: 'Instructions',
      prompt: 'Tell the assistant what else to change…',
      send: 'Send',
      stop: 'Stop',
      voice: 'Voice input (coming soon)',
      thinking: 'The assistant is thinking…',
      discard: 'Discard',
      apply: 'Apply',
    },
    // The bar's own words. A button's label, where it differs from its
    // action's title, is `toolbar.<id>` as well ("Insert table" on a bar).
    toolbar: {
      font: 'Font',
      fontValue: 'Font: {{font}}',
      size: 'Font size',
      sizeValue: 'Font size: {{size}}',
      more: 'More formatting',
      undo: 'Undo',
      redo: 'Redo',
    },
    // The fonts whose names are words, by their id in
    // `@h-k-dev/angular-email-editor/fonts`; a face's own name (Georgia,
    // Verdana) is never translated.
    fonts: {
      drawnBy: 'Shows as itself in {{clients}}',
      'sans-serif': 'Sans Serif',
      serif: 'Serif',
      'fixed-width': 'Fixed width',
      wide: 'Wide',
      narrow: 'Narrow',
    },
    color: {
      text: 'Text color',
      background: 'Background color',
      automatic: 'Automatic',
      none: 'None',
    },
    link: {
      dialog: 'Edit link',
      url: 'Link URL',
      apply: 'Apply link',
      open: 'Open link',
      remove: 'Remove link',
    },
    button: {
      menu: 'Button options',
      label: 'Button text',
    },
    image: {
      menu: 'Image options',
      addAlt: 'Add alt text',
      altLabel: 'Alt text',
      altPlaceholder: 'Describe the image',
      altWithValue: 'Alt text: {{alt}}',
      applyAlt: 'Apply alt text',
    },
    table: {
      cellOptions: 'Cell options',
      rowOptions: 'Row {{number}} options',
      columnOptions: 'Column {{number}} options',
      kinds: {
        label: 'Table kind',
        bordered: 'Bordered',
        borderedHint: 'Lines and padding, in the email too',
        borderless: 'Borderless',
        borderlessHint: 'Padding in the email, no lines',
        layout: 'Layout',
        layoutHint: 'No lines, no padding — content sits flush',
      },
    },
    menu: {
      slash: { label: 'Insert block', placeholder: 'Type to filter…' },
      tokens: { label: 'Personalization tokens', placeholder: 'Search tokens…' },
      loading: 'Searching…',
      loadingMore: 'Loading more…',
      empty: 'No results',
      error: 'Couldn’t load suggestions',
      back: 'Back',
      results: { one: '1 result', other: '{{count}} results' },
      selection: 'Selection formatting',
    },
  },
  render: {
    view: 'View',
    editor: 'Editor',
    html: 'HTML',
    client: 'Mail client',
    device: 'Reading pane',
    desktop: 'Desktop',
    phone: 'Phone',
    surface: 'Surface',
    light: 'Light',
    dark: 'Dark',
    replica: 'Replica in our editor',
    source: 'Replica HTML',
    original: 'Original MJML, as a client draws it',
    loading: 'Loading the MJML examples…',
    examples: 'MJML examples',
    previous: 'Previous example',
    next: 'Next example',
  },
};
