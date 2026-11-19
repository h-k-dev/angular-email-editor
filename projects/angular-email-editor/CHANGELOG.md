# Changelog

All notable changes to `@h-k-dev/angular-email-editor`. The library is pre-1.0: a minor
version may change behaviour, and says so here.

## Unreleased

### Changed — dependencies

- **Needs `@h-k-dev/dawn` 1.3.2 or later** (was `^1.1.0`). The dark paper reads
  `DAWN_LIGHT_INK` from it since 0.7.7: with an older Dawn installed the import fails and
  the app does not load. A consumer that pins Dawn itself raises its own range too.

## 0.7.7 — 2026-11-19

### Fixed

- **A list can be started in an empty `<p>` kept as written.** An empty `<p></p>` is kept as
  the source wrote it (no line in a mail client), so it is not the composer's own line, and
  the list commands — bulleted, numbered, and their layout forms — were refused in it: a
  dead button on what looks like an empty line. A command built with `guarded` that does
  not run there now makes the `<p>` the composer's line first (its alignment carried over)
  and runs on that, in one transaction and one undo. A `<p></p>` nobody asks a block of
  stays as written.
- **A divider or a spacer keeps the caret where it was put.** Asked for in a list item, a
  column or a section — as its last block — it threw the caret out of the container, onto
  whatever line came after it. The caret now stays right under it in the same container:
  on the line that follows there, or on a new empty line made for it. On a line of the page
  nothing changes, and in a table cell the caret stays in the cell.
- **A block cut into a line leaves no space at the cut.** A divider, a spacer, a section,
  columns or a table inserted between the words of a line (`Hallo Welt| hier`) left the
  second half starting with the space — shown by no browser and dropped at the next
  opening, so the saved HTML was not what reopened. The one space right before the caret
  and the one right after it now go with the cut; a `/divider` typed after `Hallo ` leaves
  `Hallo`. One undo brings the line back as it was.
- **Text on a background that stays light is readable on dark paper.** A marker's yellow
  (and the few other saturated light colours WebKit's transform leaves bright) kept its
  background on a dark paper while its text took the paper's light ink: white on yellow.
  Dawn now knows such a background as a band of its own (`DawnBand` `'light'`,
  `dawnStaysLight`): the text on it is written in the light scheme's ink
  (`DAWN_LIGHT_INK`), and an ink the element says itself stays as written. In the reading
  pane a child's own colour on such a band stays as written too. Needs the next
  `@h-k-dev/dawn` after 1.3.1.
- **A block asked for in a table cell no longer tears the table apart.** A divider, a
  spacer, a section, columns or another table inserted with the caret in a cell (`/divider`
  typed there) split the table round the caret: the cell's words left in a table of one
  cell, the block, and the rest as a second table. A cell holds inline content only, so the
  block now goes under the table, which stays whole — in a bordered table and a layout
  table alike. What a cell can hold (a button, an image) still goes into the cell.

## 0.7.6 and earlier

Kept as it was written, before the releases were told apart here: the placeholder card
shipped in 0.7.6; an entry older than that says its version where it matters.

### Added

- **One card for every placeholder: `createMergeTagHover` and `mergeTagCard`.** A message's
  composer and a template's design desk can show the same card on ⌘ (Ctrl off a Mac) held
  over a placeholder — before a parse and after it. The card itself is the host's; the
  library gives what is behind it.
  - `createMergeTagHover({ onHover })` reports every placeholder of the text under the
    pointer while the peek is on — a token, a previewed value, a filled value
    (`MergeTagHover.state`) — each with the ways this kit has for it: `parse`, `write`,
    `remove`, `unparse`, `edit`, `reset`, `restore`. A way that does not apply is not there
    (a template has no `write`), so a card offers the rows it finds. It takes the place of
    the fill's `onFilledHover`, which knows filled values only and stays as it was.
    `mergeTagHoverOf(view, element)` reads the same off an element, for a card opened some
    other way.
  - `mergeTagCard({ done, fieldOpened })` (the `editor` entry) is the binding a host draws
    its card from: `tag`, `token`, `expr` (what a **type** is looked up by — said before a
    parse and after), `rows` in the order they read, the value field (`editing`, `draft`,
    `canApply`, `fieldKeys`, `apply`) and `choose(row)`. Signals only; no template, no
    styles, no words — the host's menu, icons and overlay stay its own.
  - **Parse one placeholder.** `resolveMergeTagAt(pos)` fills in the one token there, the
    host asked for its expression alone; `previewMergeTag(expr, shown?)` draws one
    expression as its value while the rest stays as written (or takes one back out of a
    whole preview), with `mergeTagPreviewShows(state, expr)`. `writeMergeTagAt` and
    `removeMergeTagAt` are `writeMergeTag` / `removeMergeTag` for the one token at a
    position. `hasMergeTagResolution(state)` / `hasMergeTagPreview(state)` say what a kit
    holds.

### Changed — behaviour

- **The peek is ⌘ on a Mac.** `LayoutGuides` shows every layout block's guides — and with
  them a filled or previewed merge tag's token — while the platform's shortcut modifier is
  held: ⌘ on a Mac, Ctrl everywhere else, as `Mod-` in a keymap. It was Ctrl on every
  platform, which on a Mac opens the context menu with a click. `guidesPeekKey()` says
  which key it is, for a host's hint.
- **A suggestion trigger's `items` function is asked as the menu opens.** It used to be
  called once, as the editor was made: rows that came later (a catalogue still loading) or
  changed with the host's state never showed, and a group among them could not be entered.
  It is now asked at the start of every session, like `i18n`, `label` and `placeholder`; a
  session already open keeps the rows it opened with. (In 0.7.3.)
- **Dark paper keeps what is dark already.** `createDarkRendering` draws as Dawn 1.1 does: a
  background is never drawn lighter and text never darker, so an ink band stays ink (a white
  logo on it stays readable) and white text on it stays white. It used to invert every
  colour. A border, an outline or a shadow follows the band it lies on — as written on a
  background kept as written, drawn on any other; its sheet says which through two
  inherited custom properties (`--aee-not-kept`, `--aee-not-drawn`) that every element
  painting a background sets. `dawnDarkDeclarationsOf` may return a third value (what was
  written) for such a border. Needs `@h-k-dev/dawn` 1.1 or later.
- **A page written by hand converts with what stands unseen beside it.**
  `convertAuthoredPageToRows` used to refuse a hand-coded page unless it was the body's
  only block. A comment, a block hidden by its own `display: none` (a preheader) or a block
  holding only 1×1 images (a tracking pixel) may now stand beside it: they move into the
  nearest row — the first before the page, the last after — still first or last in the
  body, still unseen. Anything seen beside the page refuses, as before.
- **A converted row keeps its classes and what a row has no word for.** A hand-coded row's
  cell classes (the hooks of the head's phone rules) and its declarations beyond padding,
  fill and type (a `border-radius`) used to be dropped by `convertAuthoredPageToRows`.
  They now ride on the row as authored markup: sent on the row's cell, read back as
  written. A cell that says nothing more still becomes a plain row.

- **Removing a token closes the text up.** `removeMergeTag` (and `writeMergeTag` with an
  empty value) used to take the token alone, leaving the two spaces round it side by side.
  One of them now goes along — `invite {{ a }} to` reads `invite to`; at a line's start or
  end, or before a comma or full stop, the space on the other side — and tokens side by
  side, or a space apart, go as one. A token in an attribute goes alone, as before.
  `removeMergeTag` no longer scrolls to the selection.
- **A document's `prefers-color-scheme` rules follow the paper.** In the editor they used to
  follow the viewer's browser, which says nothing of the paper: a dark browser drew an
  email's dark rules on light paper. They now apply while the root matches the dark-paper
  selector, and `light` ones while it does not. `createDocumentStyles({ darkScope })` takes
  that selector — the one `createDarkRendering` takes as `scope`, same default
  (`DARK_PAPER_SCOPE`); a host with its own passes it to both. `scopedDocumentCss` now
  returns one `@scope` block per run of rules (any, dark, light) instead of always one.
- **An empty value keeps its token.** `createMergeTagResolution`'s `resolve` answering
  `''` for an expression used to remove its tokens; it now leaves them, like `null`
  (still reported in `MergeTagResolutionReport.empty`). An evaluator says `''` both for a
  field without a value and for one that computes to nothing, so the fill cannot tell a
  gap from an intent: removing a token is now always explicit (`removeMergeTag`). A host
  that relied on `''` deleting tokens calls `removeMergeTag(expr)` for those it means.
- **A held column says its own share.** `column.attrs.hold` is now the share itself, percent
  of the row (`ColumnHold`: a number, or `false` for a column that stacks), read from the
  `width: 50%` an author wrote and emitted as written. It used to be `true` and emit the
  cap's share of the 560px budget, so two 300px halves came out 54% each and wrapped on a
  phone. The boundary drag and the `+` / `−` pills keep the shares of a held row in step
  with its caps; `true` still reads, as before.

### Added

- **`/clear` clears what is written.** `ClearContent` (in the email and rich-text kits)
  declares the `clear-content` action and the `clearContent` command: the body goes, all of
  it, in one undo step — and nothing else: the quoted history a reply answers and a page's
  layout stay. Not offered on a message that is empty already.
- **A placeholder preview, for a template's desk.** `createMergeTagPreview` shows each
  `{{ token }}` of running text as its value and writes nothing: the tokens stay the
  document's text (hidden behind a decoration, the value a widget in the token's
  formatting), so what is saved, the source pane and `getHTML()` never know it is on, and
  off again there is nothing to restore. `resolve` has the fill's contract (each distinct
  expression once, raw; `''`/`null` keeps the token showing, `REMOVE_MERGE_TAG` shows
  nothing); a token written while it is on is asked for when complete, and
  `previewMergeTags(true)` while on asks afresh — another record. `onChange` reports
  `{ on, pending }`; the action is `preview-placeholders`, bound to no key. The
  `merge-tags` style mixin paints the values under the Ctrl peek, as it does filled ones.
  Tokens in attributes stay as written.
- **The preview, bound.** `[emailMergeTagPreview]` (the `editor` entry) binds it two-way to
  a signal — `[(emailMergeTagPreview)]="filled"` on or inside an `[emailEditor]` — and
  follows a preview turned on by anything else (the action's button, a `/` row).
  `[emailMergeTagPreviewOf]="recordId()"` asks every value afresh when the record changes
  while it is on; `pending()` is the spinner. `injectMergeTagPreview(() => editor())` is
  the same from code (`on`, `pending`, `available`, `show()`, `refresh()`), and
  `mergeTagPreviewOn` / `mergeTagPreviewPending` read an editor state. A kit without
  `createMergeTagPreview()` is said so when the binding turns true.
- **Columns written by hand, offered as a columns block.** A 100% table of one row whose two
  cells or more all carry a class the head's `@media` rule turns into `display: block` — how
  a hand stacks cells on a phone — is now recognised (`authoredStackRow`,
  `authoredStackRowPositions`, `stackingClasses`) where the row it stands in says its
  width: a row of a page of rows, or a section. `convertAuthoredStackRow` makes each cell a
  column (its padding, fill and vertical alignment; capped at the width it says plus its
  side padding, or an equal share of the rest), its words in a block with the type the cell
  gave them, and a `border-top` / `border-bottom` of the table a rule of that colour and
  height. A cell of a class of its own, corners, a fill on the table keep the table as
  written. Nothing converts on parse. `createSectionHandles` puts a grip before each
  (`SectionHandleTarget.kind` `'stack'`, `stackLabel`, class `aee-grip--stack` — a host
  reveals it as it does `aee-grip--band`).

- **iOS's own links read as text.** `emailDocument`'s head carries a second rule, in a sheet
  of its own (`DATA_DETECTORS_RULE`): the links iOS Mail makes of dates, addresses and phone
  numbers (`a[x-apple-data-detectors]`) take the colour, face, size and weight of the words
  round them and lose their underline. They still open on a tap; an author's own links are
  not touched. A sent email now has two `<style>` elements in its head (three with a
  Stylesheet page).
- **MJML's group, offered as held columns.** A band whose cell holds one `mj-group` — a
  full-width `div` round columns that say their share themselves — is now recognised
  (`authoredBand`, `authoredColumns`): its band grip offers the section and a columns block
  whose columns keep that share on a phone instead of stacking (`AuthoredColumn.hold`,
  `heldShare`). Nothing converts on parse. A row shorter than a line of the type round it
  stands a line tall once converted (MJML's group says `line-height: 0`, our columns block
  says none).
- **The editor island** — a trigger takes its editor from where it stands, with nothing
  bound. `[emailActions]="editor | actions"` (`/actions`) on a toolbar gives every
  `[emailAction]` inside its list; `[emailEditor]` gives what is inside it its actions;
  a composer whose menus sit beside the editor, or open in an overlay, provides
  `EMAIL_EDITOR` and `EMAIL_ACTIONS` once for all of them. `injectActions()` with no
  editor reads the island's; a bare `emailImageAlt` / `emailImageSource` does too.
  `[emailActionFrom]` is now optional (`ActionTrigger.from()` may be `undefined`) and
  still wins where bound; a bare trigger on no island throws, saying what to bind.
  `EMAIL_EDITOR`, `injectEditor` and `EditorRef` now live in `/actions` and are still
  exported from `/editor`.
- **Filled values remember their token** — the `FilledMergeTag` mark (in
  `emailExtensions`, editor-only) on every value the fill puts in: `filledMergeTagAt`,
  `editFilledValue` (write over it by hand, still the token's), `resetFilledValue`,
  `restoreMergeTag`. An edited value carries `aee-filled-merge-tag--edited`.
- **Ctrl shows them** — while Ctrl is held (`LayoutGuides`' peek, which now dispatches
  `GUIDES_PEEK_EVENT` and exports `isPeeking`), `createMergeTagResolution`'s new
  `onFilledHover` reports the filled value under the pointer, with `edit`, `reset` and
  `restore` for a host's card.
- **One token by its expression** — `distinctMergeTagExpressions` (text and attributes,
  once each), `selectMergeTag`, `revealMergeTag`, `writeMergeTag` (a value by hand in
  every token's place), `removeMergeTag`.
- **The evaluator may take a token out** — `resolve` answering `REMOVE_MERGE_TAG` for an
  expression removes its tokens in the fill's own transaction (one undo step with the
  values), the text closed up behind them; `''` still keeps the token. For the host that
  can tell an intent from a gap. Reported in `MergeTagResolutionReport.removed` (a new,
  always present field); `MergeTagAnswer` is the type of one answer.
  `checkMergeTagValues` takes such an answer as no error.
- **Several tokens removed at once** — `removeMergeTags(expressions)`: every token holding
  one of them, one undo step, the text closed up as above. Also the `removeMergeTags`
  editor command.
- **Signal-forms check at send** (`/editor`) — `checkMergeTagValues(field, editor,
{ resolve })` returns a `MergeTagUnfilled` error (`mergeTag.unfilled`, with its `expr`)
  for each placeholder without a value; `isMergeTagUnfilled`. `EmailEditor` takes the
  field's `errors` and its `focus()` — the form's `focusBoundControl` — selects the named
  token and emits `(emailEditorMergeTagRevealed)` with the element, for a card beside it.
- **`styles/merge-tags`** — the pill and the filled-value look as a Sass mixin
  (`@include merge-tags.merge-tags` on `.aee-editor`), on `--email-merge-tag-background`
  and `--email-merge-tag-edited`.
- `clearFormatting` leaves a mark whose spec says `clearable: false`.

### Fixed

- **A suggestion menu keeps its arrows inside a section.** With a `/` or token menu open on
  a line that is the only one of an isolating block (a section, a column), ArrowUp and
  ArrowDown left for the gap beside the block instead of moving the highlight: the gap
  cursor stands before a host's menu in the kit and took the key. It now lets those two
  arrows through while a menu shows, as the table's keymap does — both ask the new
  `suggestionMenuOpen(view)`, which is true only while a menu is on screen (the table used
  to step aside for any text that read as a query, shown or not).
- **An empty table's first row keeps its height.** With `createTableHandles` every cell of
  the first row holds a column grip, a widget — and ProseMirror puts a separator after a
  widget, so the host rule that hides its caret aids (`TrailingBreakLine`) hid the break
  that is an empty cell's whole height: the row went flat once the caret left it. The
  documented rules have one more, which keeps the break of a line holding only widgets;
  a host that copied them needs it too.
- **No empty pill beside a previewed value.** The `merge-tags` style mixin hides a token's
  pill while `createMergeTagPreview` shows its value; only its text was hidden, and the
  pill's padding and fill were left drawn after the value.
- **A document's body rules reach the editor's root.** `DocumentStyles` put the `<body>`'s
  inline style on the root, but a rule of the head for the body (`body { … }`, `body.page`,
  `[dir="rtl"] body`) matched nothing inside the editor's `@scope`. Such a rule is now read
  against the body the document has and, where it matches, said of the root — over a host's
  own surface rules, under the inline style. Its box stays out: `margin*` / `padding*` go
  to `--aee-body-*`, and `width`, `height`, `display`, `position` and the like are left
  behind. `body td` is read the same way and keeps its weight. An email whose body turns
  black by a head rule in dark no longer shows a white strip under its last line.
- **On dark paper the body's own fill is drawn dark too.** `createDarkRendering` drew every
  inline colour dark except the root's — the `<body>`'s `bgcolor` or inline background, which
  stayed light under a dark email. The root's own style is now drawn dark like any other, and
  so are the colours of a body rule.
- **A floating menu keeps to the paper on screen, across too.** `measureMenuPlacement`
  held the box to the container's `scrollWidth`: in an email wider than its paper (a 600px
  table in a narrower window) the `/` and `{{` menus stood past the paper's edge, cut off
  there — and, standing there, widened the very width they were held to. The box now keeps
  to what the container shows across, cut down by every scroller round it and the window,
  as it already did down it.
- **A page's room stays dark on dark paper.** Drawing the root's own style dark
  (above) also took its custom properties: the page layout's
  `--aee-page-background-dark`, already the dark fill, was drawn dark once more
  and came out light — light strips above and below a page on dark paper.
  `createDarkRendering` now leaves the root's custom properties as written.
- **A block link is no stored mistake.** `storedMistakes` counted an `<a>` round a table or a
  block — a card that is one link, `<a style="display:block"><table>…` — as
  `inline-around-blocks`, and `fixStoredMistakes` pushed the link inside. A link that says
  its own `display`, or that holds a table, now stays as written (`isBlockLink`). A link an
  editor wrapped round plain lines is still lowered into each.
- **A wrapper round a table goes into its cells.** `<font color><table>…</table></font>` was
  "fixed" to a `<font>` between the table and its rows, which a client moves out, empty — the
  cells lost the colour. It is now put inside each cell of that table.
