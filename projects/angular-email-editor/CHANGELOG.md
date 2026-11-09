# Changelog

All notable changes to `@h-k-dev/angular-email-editor`. The library is pre-1.0: a minor
version may change behaviour, and says so here.

## Unreleased

### Changed — behaviour

- **An empty value keeps its token.** `createMergeTagResolution`'s `resolve` answering
  `''` for an expression used to remove its tokens; it now leaves them, like `null`
  (still reported in `MergeTagResolutionReport.empty`). An evaluator says `''` both for a
  field without a value and for one that computes to nothing, so the fill cannot tell a
  gap from an intent: removing a token is now always explicit (`removeMergeTag`). A host
  that relied on `''` deleting tokens calls `removeMergeTag(expr)` for those it means.

### Added

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
- **Signal-forms check at send** (`/editor`) — `checkMergeTagValues(field, editor,
  { resolve })` returns a `MergeTagUnfilled` error (`mergeTag.unfilled`, with its `expr`)
  for each placeholder without a value; `isMergeTagUnfilled`. `EmailEditor` takes the
  field's `errors` and its `focus()` — the form's `focusBoundControl` — selects the named
  token and emits `(emailEditorMergeTagRevealed)` with the element, for a card beside it.
- **`styles/merge-tags`** — the pill and the filled-value look as a Sass mixin
  (`@include merge-tags.merge-tags` on `.aee-editor`), on `--email-merge-tag-background`
  and `--email-merge-tag-edited`.
- `clearFormatting` leaves a mark whose spec says `clearable: false`.
