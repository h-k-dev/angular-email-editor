/** A component's page: what it is, what to import, how a host writes it.
    Prose marks code with `backticks`. */
export interface ComponentPage {
  readonly title: string;
  readonly lede: string;
  /** The exports a host imports from the entry, in the order it meets them. */
  readonly exports: readonly string[];
  /** What to know before using it, a point each. */
  readonly points: readonly string[];
  /** What a host writes — the playground's, trimmed: a template, or
      TypeScript for an entry of functions and data (`usageLang`). */
  readonly usage: string;
  readonly usageLang?: 'html' | 'ts';
}

/**
 * The words of each component's page, by its entry point's name
 * (`ENTRY_PAGES`). The usage is what the playground on the page
 * writes, without the bench around it.
 */
export const COMPONENT_CONTENT: Readonly<Record<string, ComponentPage>> = {
  'address-input': {
    title: 'Address input',
    lede: 'A recipients field: chips for the addresses, one text input after the last. A signal-forms control over `string[]`, validated by `addressList`.',
    exports: ['AddressInput', 'addressList', 'AddressInputLabel', 'AddressDragGroup'],
    points: [
      'The control is the control alone — the row and its label are the host’s, as for a plain `<input>`; name it with `aria-labelledby` or the `emailAddressLabel` slot.',
      'Enter, comma and paste make chips of valid addresses; the rest stays typed and flagged. Blur commits everything, so the form can flag it.',
      'Inputs in one `emailAddressDragGroup` take chips dragged from each other.',
      'It renders no error words: the form owner says them from `errors()`.',
    ],
    usage: `<div emailAddressDragGroup>
  <label [for]="to.id">To</label>
  <div email-address-input #to [formField]="envelope.to" placeholder="Recipients"></div>

  <label [for]="cc.id">Cc</label>
  <div email-address-input #cc [formField]="envelope.cc"></div>
</div>`,
  },
  'address-chip': {
    title: 'Address chip',
    lede: 'One address as a chip — the address input renders these for its value; a host renders its own for a read-only header.',
    exports: ['AddressChip', 'AddressChipRemove', 'ADDRESS_DRAG_TYPE'],
    points: [
      'It asks, it does not do: `removed` is a request the host answers by dropping the address.',
      'A typo is `data-invalid`, a `{{placeholder}}` is `data-pending` — neither is an error to the chip’s eye.',
      'Hold to copy (`holdDelay`, 500ms): mouse or touch, it copies the header form and emits `copied`.',
      'The × is a template slot: `ng-template[emailAddressChipRemove]` gets the label, the state and a `remove()`.',
    ],
    usage: `<ul>
  @for (address of sent.to; track address) {
    <li email-address-chip [address]="address" [removable]="false"></li>
  }
</ul>`,
  },
  'attachment-chip': {
    title: 'Attachment chip',
    lede: 'One file as a chip: its icon, name and size, and every stage of its transfer — a sweep with no number, a bar with one, quiet while queued, a retry once failed.',
    exports: [
      'AttachmentChip',
      'Attachment',
      'AttachmentStatus',
      'AttachmentChipIcon',
      'AttachmentChipProgress',
      'ATTACHMENT_CHIP_OPTIONS',
    ],
    points: [
      '`Attachment` is structural: a browser `File` binds straight in.',
      '`status` takes the uploaders’ vocabulary — `preprocessing`, `queued`, `uploading`, `postprocessing`, `complete`, `failed` — and `progress` is 0–1 while uploading.',
      '`simulateProgress` runs a fake transfer once, paced by size, for a host that already has the bytes.',
      'Icon, progress and both buttons are template slots, sized by the chip’s tokens.',
    ],
    usage: `<li
  email-attachment-chip
  [attachment]="file"
  [status]="uploads.status(file.key)()"
  [progress]="uploads.progress(file.key)()"
  (removed)="remove(file)"
  (retried)="uploads.retry(file.key)"
>
  <mat-icon *emailAttachmentIcon="let kind = kind" inline>{{ icons[kind] }}</mat-icon>
</li>`,
  },
  'attachment-chips': {
    title: 'Attachment chips',
    lede: 'The strip a message’s chips sit in — and the form’s control: its value is the list, and a chip’s × takes its item out with no wiring.',
    exports: ['AttachmentChips'],
    points: [
      'The host renders one `<li email-attachment-chip>` per item of the value and decides, chip by chip, what each shows.',
      'Removal is by identity: the chip that asked is exactly the item that goes.',
      'Focus moves to the neighbour when the focused chip goes.',
      'Hidden while it holds no chips; `aria-busy` while any chip is busy.',
    ],
    usage: `<ul email-attachment-chips [formField]="envelope.attachments">
  @for (file of envelope.attachments().value(); track file.key) {
    <li email-attachment-chip [attachment]="file"></li>
  }
</ul>`,
  },
  'chat-input': {
    title: 'Chat input',
    lede: 'A one-box message field on a tiny editor: it grows with its text to five lines, then scrolls. Enter sends, Shift+Enter breaks the line.',
    exports: ['ChatInput', 'ChatInputField', 'chatInputText'],
    points: [
      'A signal-forms control over the text (`[(value)]` or `[formField]`).',
      '`sent` carries the text on Enter; `escaped` says Escape was pressed — the host closes what it opened.',
      '`ChatInputField` is the behaviour alone, for a host that styles its own box.',
      'The growing is a `height` transition (`--email-chat-input-motion`); reduced motion turns it off.',
    ],
    usage: `<div
  email-chat-input
  placeholder="Tell the assistant what to change…"
  [(value)]="instructions"
  (sent)="ask($event)"
  (escaped)="close()"
></div>`,
  },
  'split-button': {
    title: 'Split button',
    lede: 'Two icon buttons as one control: unsplit it is one icon button; `split`, a chevron opens out of its side.',
    exports: ['SplitButton', 'SplitButtonLeading', 'SplitButtonTrailing'],
    points: [
      'The halves are the host’s own buttons — content, name, tooltip, click, `disabled` — each wearing one attribute.',
      'Themed as Material’s icon button is: `--hk-split-button-*`, then `--mat-icon-button-*`, then M3’s values.',
      'Focus never falls to the page: closing while the chevron has focus moves it to the leading half.',
    ],
    usage: `<hk-split-button split aria-label="Attachments">
  <button hkSplitButtonLeading aria-label="Attach files" (click)="pick()">
    <mat-icon>attach_file</mat-icon>
  </button>
  <button hkSplitButtonTrailing aria-label="Show attachments" [attr.aria-expanded]="shown()" (click)="toggle()">
    <mat-icon>expand_more</mat-icon>
  </button>
</hk-split-button>`,
  },
  'suggestion-menu': {
    title: 'Suggestion menu',
    lede: 'The floating box `createSuggestionMenu` reports to: it renders the state — roles and ids, the next page as the list scrolls, and what is going on, said twice.',
    exports: [
      'SuggestionMenu',
      'SuggestionMenuItem',
      'SuggestionMenuSection',
      'SuggestionMenuHeader',
    ],
    points: [
      'One pair serves every trigger (`/`, `{{`): they never open together.',
      'Rows are options and never take focus: the caret stays in the editor, the combobox.',
      'A group opens a second level with a back header — the default, or the host’s `emailSuggestionMenuHeader` slot.',
      '`placement="docked"` makes it a band in the flow — a phone’s, over the keyboard.',
    ],
    usage: `<div email-suggestion-menu #menu [state]="state()">
  @for (item of state()?.items; track item.id) {
    @if (item.heading; as heading) {
      <div email-suggestion-menu-section>{{ heading }}</div>
    }
    <div email-suggestion-menu-item [item]="item">{{ item.title }}</div>
  }
</div>`,
  },
  'toggle-button-group': {
    title: 'Toggle button group',
    lede: 'A radio group of buttons with a thumb that slides to the picked one — round for an icon, a pill for text, morphing between them.',
    exports: ['ToggleButtonGroup', 'ToggleButtonGroupIcon', 'ToggleButtonGroupText'],
    points: [
      'The items are attributes on any element — `hkTgbIcon` or `hkTgbText` on a button, a link, a div.',
      'A signal-forms control over the picked value; `aria-disabled` on an item takes it out.',
      'The thumb is placed from the picked item’s box, so items may differ in width.',
      'Sized by `--hk-tgb-size` and `--hk-tgb-inset`; the thumb is neutral by default.',
    ],
    usage: `<hk-tgb aria-label="Theme" [(value)]="theme">
  <button hkTgbIcon value="light" aria-label="Light"><mat-icon inline>light_mode</mat-icon></button>
  <button hkTgbIcon value="dark" aria-label="Dark"><mat-icon inline>dark_mode</mat-icon></button>
  <button hkTgbText value="auto">Auto</button>
</hk-tgb>`,
  },
  material: {
    title: 'Material form field',
    lede: 'The address input as the control of a `mat-form-field` — the one entry point that imports Material. Opt in per field with `emailMatFormField`.',
    exports: ['AddressFormField'],
    points: [
      'The label floats while the field is focused or holds anything — chips or typing.',
      '`mat-error` shows once the field is touched and invalid; hint and error are read out.',
      'A click anywhere in the field puts the caret in.',
      'No `NgControl`: signal forms bind through `[formField]`.',
    ],
    usage: `<mat-form-field>
  <mat-label>To</mat-label>
  <div email-address-input emailMatFormField [formField]="envelope.to"></div>
  <mat-hint>Separate addresses with a comma</mat-hint>
  <mat-error>{{ envelope.to().errors()[0]?.message }}</mat-error>
</mat-form-field>`,
  },

  // ── Utilities: directives, functions and data ─────────────────────────
  editor: {
    title: 'Editor',
    lede: 'An editor mounted on an element of the host’s own, its value bound: a signal-forms control that never writes into the text being typed and always hands back the canonical form.',
    exports: ['EmailEditor', 'injectEditor', 'EMAIL_EDITOR', 'HTML_CODEC', 'EditorCodec'],
    points: [
      'The kit is an array, or a function called as the editor mounts; another kit is another editor, mounted in the old one’s place a render later.',
      'A value from outside waits while the text is typed in — a draft saved in another tab lands when the writer leaves the text, not under their cursor.',
      '`baseline()` is the body as the editor first published it, so “unsaved” is `value() !== baseline()` — never on open. `replace()` writes into a focused editor as one undo step: a Revert the user can take back.',
      'A codec says how value and editor meet — HTML by default; a source pane reads and writes text. `emailEditorPaused` holds outside values for a pane out of sight.',
    ],
    usage: `<div [emailEditor]="kit" [formField]="form.body" #body="emailEditor"></div>
<button [disabled]="form.body().value() === body.baseline()"
        (click)="body.replace(body.baseline()!)">Revert</button>`,
  },
  keyboard: {
    title: 'Field keys',
    lede: 'A field that sits inside something with keys of its own — a number in a menu, a panel, a toolbar — keeps its keys, commits on Enter and goes back on Escape.',
    exports: ['FieldKeys'],
    points: [
      'Typed keys stay in the field: a digit is never the menu’s typeahead, an arrow steps the number, not the rows. Shortcuts with Ctrl or ⌘ still go up.',
      'Enter commits and says so (`emailFieldKeysCommitted`); Escape puts the field back as its model says (`emailFieldKeysDismissed`). A menu closes on either.',
      'With `[formField]` debounced to its blur, a field writes once it is done with — and shows what its model took, even when that is the value already there (9 typed on a 4px grid that says 8).',
      'Its natural model is an `editorModel` (`/actions`): the document’s value, written as one undo step.',
    ],
    usage: `<div ngMenu>
  <input
    type="number"
    step="4"
    [formField]="padding.top"
    emailFieldKeys
    (emailFieldKeysCommitted)="close()"
    (emailFieldKeysDismissed)="close()"
  />
</div>`,
  },
  actions: {
    title: 'Actions',
    lede: 'The editor’s actions, bound and live, for the host’s own buttons: `injectActions` lists what the kit declares, and `[emailAction]` makes any control the trigger of one.',
    exports: [
      'injectActions',
      'ActionTrigger',
      'editorState',
      'HostAction',
      'editorModel',
      'sectionPaddingModel',
      'atRest',
    ],
    points: [
      'A trigger says its state as ARIA — `aria-pressed` for a toggle, `aria-disabled` when it cannot run — and never a class or a style: how that looks is the host’s, bound from `pressed()` and `disabled()`.',
      'The list follows the editor it is given, so one toolbar serves a composer and its code view; an action the kit lacks is simply disabled.',
      '`host` adds actions of the host’s own (a link dialog); `override` replaces the kit’s `run` by id and keeps its state.',
      'After a run the caret goes back to the editor, unless `[emailActionFocus]="false"`.',
      'The same entry holds the document’s values as writable signals — `editorModel` and the typed models (a band’s padding and fill, a column’s spacing, the page layout) — and `atRest`, a value as typing settles.',
    ],
    usage: `<div role="toolbar" emailKeepFocus>
  @for (action of actions.all(); track action.id) {
    <button
      mat-icon-button
      #trigger="emailAction"
      [emailAction]="action.id"
      [emailActionFrom]="actions"
      [class.on]="trigger.pressed()"
    >
      <mat-icon>{{ action.action?.icon }}</mat-icon>
    </button>
  }
</div>`,
  },
  focus: {
    title: 'Keep focus',
    lede: 'A press on this element never takes focus from wherever it is: the editor keeps its caret and its selection while a toolbar button is clicked.',
    exports: ['KeepFocus', 'KEEP_FOCUS_EXCEPT'],
    points: [
      'Behaviour only: no attribute, no class — on a Material button, an Aria toolbar, a CDK overlay’s panel, or through `hostDirectives`.',
      'Only the pointer’s press is kept out: Tab and the arrow keys still reach the tools, and the click still runs.',
      'Text entry inside it may still take focus (`emailKeepFocusExcept`, inputs by default), and a press on something `draggable` is left alone.',
      'It needs no editor: whatever has focus keeps it.',
    ],
    usage: `<div role="toolbar" emailKeepFocus>
  <button mat-icon-button (click)="bold()"><mat-icon>format_bold</mat-icon></button>
  <input aria-label="Font size" />
</div>`,
  },
  anchor: {
    title: 'Anchor',
    lede: 'A real element kept over a box the editor reports — a selection, a caret, a block — for whatever floats to hold on to: the CDK’s overlay origin, a Material menu trigger, CSS anchor positioning.',
    exports: ['Anchor', 'AnchorRect'],
    points: [
      'Behaviour only: it places its element, fixed and out of the pointer’s way, and renders nothing.',
      'While the box is `null` it stays where it last was, so what hangs off it closes in place.',
      'The box is in viewport coordinates: it must not sit inside a transformed ancestor, and it is as current as the box it is given.',
    ],
    usage: `<span [emailAnchor]="menu().boundingBox" cdkOverlayOrigin #origin="cdkOverlayOrigin"></span>
<ng-template
  cdkConnectedOverlay
  [cdkConnectedOverlayOrigin]="origin"
  [cdkConnectedOverlayOpen]="menu().open"
>
  …
</ng-template>`,
  },
  image: {
    title: 'Image alt',
    lede: 'Makes the host’s own text field the alt text of the editor’s selected image. Everything but the field and its words is done.',
    exports: ['ImageAlt'],
    points: [
      'The field shows the selected image’s alt and follows the selection; typing is a draft until `apply()`, which writes it as one undo step.',
      'Enter applies, Escape puts the alt back; both hand the caret back to the editor and emit `emailImageAltClosed`.',
      'As a popover it takes focus with its text selected; as a panel field, `[emailImageAltAutoSelect]="false"`.',
      'The image stays selected while the field has focus, so the popover can sit where the host likes.',
    ],
    usage: `<input dir="auto" [emailImageAlt]="editor" #alt="emailImageAlt"
       (emailImageAltClosed)="open.set(false)" />
<button [disabled]="!alt.active()" (click)="alt.apply()">Apply</button>`,
  },
  proposal: {
    title: 'Proposal',
    lede: 'Content proposed into the text — written in, not the writer’s yet — and the three things to do about it. The Angular face of `proposeContent`, for an assistant panel.',
    exports: ['injectProposal', 'Proposal', 'ProposalAccept', 'ProposalDiscard', 'ProposalKeys'],
    points: [
      'Needs `createContentStream()` and `createContentProposal()` in the kit.',
      'A proposal stays out of the undo history: Accept commits it as one change, Discard leaves the document as it was.',
      '`thinking`, `streaming`, `range` and `box` are signals, for a panel that shows what the model is doing and stands under the writing.',
      '`emailProposalKeys` hears Ctrl-Enter (⌘-Enter) from anywhere while a proposal stands; Escape is handed to the host.',
    ],
    usage: `<div [emailProposal]="editor" #p="emailProposal" emailProposalKeys (escape)="p.discard()">
  <button (click)="ask(p)">Propose</button>
  <button emailProposalAccept #apply="emailProposalAccept" [disabled]="apply.disabled()">Apply</button>
  <button emailProposalDiscard [disabled]="!p.active()">Discard</button>
</div>`,
  },
  metrics: {
    title: 'Text metrics',
    lede: 'Words, characters, wrapped lines and an estimated height, live — pure arithmetic over cached glyph widths, with no layout read on a keystroke.',
    exports: ['createTextMetrics', 'TextMetrics', 'measureDoc'],
    points: [
      'Its own entry because it is the only part that needs `@chenglou/pretext`, an optional peer.',
      'A block that did not change is never measured again; a resize reruns only the line arithmetic.',
      'An extra, never a dependency: a measurement that throws goes to `onError` and the editor carries on.',
      'Images add no height to the estimate: their size is not known without loading them.',
    ],
    usage: `createEditor({
  parent,
  extensions: [
    ...emailExtensions,
    createTextMetrics({ onMetrics: (metrics) => this.metrics.set(metrics) }),
  ],
});`,
    usageLang: 'ts',
  },
  address: {
    title: 'Address rules',
    lede: 'The address rule — what an address is, how a header splits into mailboxes and how each is read and written — as functions every address piece asks through.',
    exports: [
      'ADDRESS_RULES',
      'provideAddressRules',
      'isMailbox',
      'isPending',
      'addressKey',
      'joinAddresses',
    ],
    points: [
      'Split, parse, format, validate, placeholders and identity are one contract (`AddressRules`); `provideAddressRules` swaps any part for the whole app.',
      'A `{{placeholder}}` is pending — neither valid nor invalid until a template fills it.',
      '`addressKey` makes two spellings of one recipient one; `joinAddresses` writes a list as one header that `split` reads back entry for entry.',
      'RFC 2047 encoded words are decoded, quoted names unquoted, comments skipped.',
    ],
    usage: `providers: [provideAddressRules({ isValid: isValidEmail })];

const rules = inject(ADDRESS_RULES); // ours, or the provided one
const to = rules.split(header); // header form, one entry each
const value = joinAddresses(form.to().value()); // back to one header`,
    usageLang: 'ts',
  },
  palette: {
    title: 'Palette',
    lede: 'The colours a host offers — for text and for a fill — each with its dark-mode variant, held to a rule that keeps it readable on a light and a dark client.',
    exports: ['providePalette', 'injectPalette', 'resolvePalette', 'colorSuggestions'],
    points: [
      'Text colours pass 3:1 against white and near-black (`passesDualContrast`); an exception is always on record, with its reason.',
      'Every colour carries the variant a dark-mode client draws; the email emits them itself.',
      '`providePalette` takes either list, or a function of the library’s to add a brand colour or take some out.',
      '`colorSuggestions` turns the palette into `/` menu rows.',
    ],
    usage: `providers: [
  providePalette((defaults) => ({
    text: [...defaults.text, { name: 'Brand', value: '#0a5c36' }],
  })),
];`,
    usageLang: 'ts',
  },
  fonts: {
    title: 'Fonts',
    lede: 'The fonts an email is written in — Gmail’s set, in Gmail’s order — as plain data: no Angular, no ProseMirror, so another editor can offer the same set.',
    exports: [
      'emailFontFamilies',
      'emailDefaultFont',
      'emailFontSizes',
      'matchEmailFont',
      'fontClients',
    ],
    points: [
      'Each font is a stack — the face, then a near fallback, then the generic — and the clients that draw the face itself.',
      '`matchEmailFont` reads any `font-family` back as one of the set: a builder’s web font becomes the face a client would fall back to.',
      'The default (Sans Serif) is never emitted: unstyled text is drawn in the client’s own default, as Gmail’s is.',
    ],
    usage: `// summernote, offering the same set
$('#editor').summernote({
  fontNames: emailFontFamilies.map((font) => font.face),
  fontName: emailDefaultFont.face,
});`,
    usageLang: 'ts',
  },
};
