# ROADMAP

Two editors, one document, zero lies: a visual email composer and an HTML
source editor developed as peers over the same extension contract, kept in
sync through Angular signals, with ProseMirror as the parsing engine on both
sides.

## Progress snapshot — 2026-08-20

Foundations and the two-editor core are in; the content and layout-blocks side
is mature. Tests: **409 library + 5 app, all green** (2026-09-02).

| Milestone                                                       | State            | Left to do                                                                                  |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| Foundations (two editors, mark parity, canonical `html` signal) | ✅ done          | —                                                                                           |
| **M1 — Round-trip fidelity**                                    | ✅ core done     | selection mirroring (stretch)                                                               |
| **M2 — Missing composer features**                              | ✅ done          | —                                                                                           |
| **M3 — Deliverability lint engine**                             | ✅ done          | —                                                                                           |
| **M4 — Preview & proof**                                        | 🟢 mostly done   | per-client simulation; Outlook conditional comments                                         |
| **M5 — Layout blocks**                                          | 🟢 flagship done | UX polish pass (see “Known dissatisfactions”); section-schema + `{{template}}` placeholders |
| **M6 — Compose workflow**                                       | ✅ done          | — (the inline image registry closed it, 2026-09-02)                                         |

Most recent work: **M6 opened, and it closed M2 on the way** — the
**reply/forward seed constructors** (`replyDocument`/`forwardDocument`:
inbound data → canonical HTML through the host's one `html` signal; envelope
stays the host's), the **quote fold** (Gmail's `⋯` — presentation-only, the
trailing blockquote hides behind a toggle and every escape hatch expands it),
and the **send intent** (`createSendIntent`: `/send`, Mod-Enter, or a toolbar
button emit `{html, text}` upward — M2's last item, unblocked once the scope
decision removed the transport). Before that: the **block menu** with
add/remove-column commands, background fills, layout guides, and the
`aee-editor` scoping so our global styles can never touch a host's other
ProseMirror instances. Since then M6 has closed drafts (nothing to build,
by design), the `.eml` import through the **parser bridge**
(`toInboundMessage`), and its **loss report** (`importLoss`). Next — and last
for M6: **inline images**, scoped below as the `cid:` story, not an
attachments surface.

## Why this is worth building

Email is a strange dialect of HTML. It is parsed by rendering engines that
range from "a browser from 2012" to "Microsoft Word", it gets rewritten by
providers in transit, and it fails silently — the recipient just sees a broken
message. Every WYSIWYG email editor eventually hits the same wall: the visual
layer promises things the HTML underneath can't deliver.

Our answer is to make the HTML a first-class, always-visible, always-editable
projection — and to make one schema the single source of truth for what email
HTML is allowed to be.

## Principles (opinionated on purpose)

1. **The schema is law.** The email ProseMirror schema defines the entire
   vocabulary: which tags, which marks, which inline styles. Anything outside
   it does not survive — not as a bug, as the contract.
2. **Parsing is repair.** Broken or foreign markup is never rejected; it is
   parsed, normalized, and re-serialized into canonical form. The linter tells
   you _what_ would change, the round-trip _makes_ it change.
3. **Canonical output is deterministic.** Same document → byte-identical
   HTML: zero formatting whitespace, `<div>` lines (never `<p>` margins),
   `<div><br></div>` empty lines, inline styles only, stable attribute order.
4. **Formatting is presentation-only.** Indentation and line breaks in the
   source pane are exactly the whitespace the parser discards. Pretty source
   can never change the rendered email — this is enforced by test.
5. **Both editors run the same commands.** Ctrl-B in the source pane executes
   the visual editor's own toggle through the shared schema. Behavior can't
   diverge, because there is only one behavior.
6. **Signals carry the truth.** One `html` signal per composer; each editor
   projects into it and reacts to it. No event soup, no manual sync calls.
7. **If a mainstream client can't render it, we don't emit it.** Gmail,
   Outlook (Word engine), Apple Mail, Yahoo, and the big webmailers define
   our floor. When in doubt: caniemail says no.
8. **Responsive by default.** Every email we emit must read well on a phone —
   not as an option, as a property of the output. And because of principle 7,
   responsiveness is achieved _fluidly_ (max-widths, percentage widths,
   wrapping structures with inline styles), never via `<style>` media
   queries that half the clients strip.
9. **We don't fight dark mode.** There is no reliable control — Gmail and
   Outlook forcibly recolor, and the official mechanisms don't survive
   transit — so we never emit dark-mode CSS or anti-inversion hacks. Instead
   the output _inverts gracefully by construction_: colorless by default
   (uncolored email is every inverter's happy path), and every color _we
   offer_ passes the **dual-contrast rule** — readable against both white
   and near-black. Enforcement lives at the affordance: the color picker is
   a curated palette, not an arbitrary hex input. The source pane stays
   free — a hand-typed hex is the author's own responsibility; we never
   rewrite, block, or police colors from the code side.

## UI/UX & platform stance

- **Headless first: Angular Aria over Angular Material.** Behavior and
  accessibility come from headless primitives (Angular Aria patterns, CDK
  overlays); we own the markup and the pixels. Ideally we use no Material
  _components_ at all — but we'll see, and we say so honestly: today's
  toolbar still sits on `mat-icon-button`. What we keep regardless is
  Material's **design token system**: `mat-sys-*` as the theming default is
  too nice and simple to pass on.
  - [ ] Migrate the composer UI (toolbar, menus) from Material components to
        headless Aria/CDK primitives styled purely by the token cascade.
  - **Our own where Aria's pattern does not fit — never both in one widget.**
    Aria's combobox assumes an `<input>` (it reads `value`, sets the
    selection range) and its toolbar focuses a tool on click; an editor-bound
    menu has ProseMirror's editable as its text field and must never take
    focus from it. So the suggestion menus (`/`, `{{`) are the library's own
    pair (`email-suggestion-menu`, 2026-09-15), shaped like Aria's (listbox,
    options, ids for `aria-activedescendant`) but with no Aria in it. Aria
    stays fine for app chrome (the toolbar's ⋯ menu).
- **One token cascade, always.** Every visual knob resolves in this exact
  sequence: `--email-*` / `--html-email-*` (our component tokens) →
  `--mat-sys-*` (Material system tokens) → hard fallback value. Host apps
  theme by overriding the first layer, Material themes flow through the
  second, and the fallback guarantees a sane look with no theme at all.
  - [ ] Migrate the existing names (`--mat-sys-prose-mirror-*`,
        `--mat-sys-aee-*`, `aee-*` token classes) onto this cascade.
- **Angular only — and all of Angular.** We will never care about other
  frontend frameworks or a framework-agnostic/vanilla-JS wrapper. That budget
  goes into seamless Angular integration instead: signals and `model()` for
  state, `effect()` for projections, `afterNextRender` for DOM mounting,
  OnPush everywhere, zoneless-ready.
- **No hacking into ProseMirror or Angular.** ProseMirror is extended only
  through its public contract (schema specs, plugins, props, decorations);
  Angular only through documented APIs. If a feature needs a private
  override or monkey patch, the feature waits or the design changes —
  maintenance beats cleverness.
- **Tests pin logic, not lines.** No 100%-coverage worship. We test the
  contracts that keep us honest — canonicalization, round-trip invariance,
  lint semantics, toggle parity — so refactors fail loudly exactly where it
  matters and nowhere else.

## Where we are (done)

- [x] Extension architecture: nodes, marks, keymaps, input rules, plugins,
      commands, slash items — kits are just arrays of extensions.
- [x] **Email kit**: div-line paragraphs, bold/italic/underline/strike,
      links, text color, blockquote, lists, headings, images, history,
      bubble menu, slash menu, math-only text metrics.
- [x] **HTML source kit**: one `codeLine` per line, syntax highlighting,
      linting (unclosed tags, stray closers, void misuse, non-email-safe
      warnings), pretty-printer that is also a repairer, Shift-Alt-F,
      format-on-blur (refuses on errors, Prettier-style), Tab = 2 spaces,
      auto-indent on Enter, tag auto-closing (`>` and `</`), line-aware paste.
      **Formats to 80 characters (2026-09-02)** — Prettier's width; the HTML
      is built for arbitrary lengths, the source is optimized for reading:
      running text wraps at spaces, a wide open tag breaks one attribute per
      line with the `>` back on the margin (a `style` that still does not fit
      prints as embedded CSS, one declaration per line, Prettier's way), an
      over-wide `{{ }}` token prints
      the way Prettier prints an Angular interpolation (braces on their own
      lines, the expression filled between them, never broken inside a string
      literal), and nothing ever breaks inside a tag or an attribute value —
      only whitespace the parser collapses or discards is added, so the
      invariance test still holds and the email never sees a newline.
- [x] **Mark parity**: mark keymaps/commands of the email kit mirrored into
      the source editor via sentinel round-trip through the shared schema.
- [x] **Composer app**: `Compose` owns one canonical `html` signal; the two
      panes are attribute-selector components with `model()` two-way binding;
      focus-guarded effects prevent echo loops and cursor yanking.
- [x] Output-invariance test: `format(html)` and `html` canonicalize
      identically through the email schema.

## Milestone 1 — Round-trip fidelity

The sync works; now make it lossless and gentle.

- [x] **Diff-based `setText`/`setContent`**: syncs apply as minimal diff
      transactions (`findDiffStart`/`findDiffEnd`), flagged `addToHistory:
false` + `externalSync`. The receiving editor keeps its own undo
      history (external changes aren't yours to undo — collab semantics),
      its selection maps through the diff, and `onUpdate` stays silent so
      mirrored editors cannot echo.
- [x] **Comment policy — decided: comments are never content.** They drop on
      parse, but _loudly_: the linter warns on every comment ("the schema
      drops them on the next parse") and errors on unterminated ones. No
      comment node in the schema, ever. Where Outlook conditionals are needed
      (M5 ghost tables), the block extension's _serializer_ generates them
      deterministically and its parser ignores them — comments as derived
      serializer artifacts, never editable state, so the round trip stays
      stable and nothing hides in the document.
- [x] **Entity discipline**: the linter warns on _ambiguous_ ampersands —
      entity-like forms missing the `;` (`&copy`, `&#38`) that browsers
      legacy-decode, silently changing the text. Plain `&` in prose and bare
      `<` in text are left alone: the round trip normalizes them without
      changing meaning, and normalization is not worth a nag. Character
      references are atomic to the sentinel round-trip — selection endpoints
      inside `&amp;` expand outward, never splitting the reference.
- [ ] **Selection mirroring** (stretch): click in the source highlights the
      corresponding text in the email pane and back — generalize the sentinel
      offset-mapping into a reusable source map.

## Milestone 2 — The missing composer features

Everything a Gmail-class composer has that we don't, always expressed as
schema extensions first, toolbar second.

- [x] **Paste sanitization**: the `PasteHygiene` extension cleans clipboard
      HTML before the schema parse — `<style>`/`<script>` subtrees (whose
      text would leak through), Word's namespaced tags (`<o:p>`, `<w:*>`),
      and Word's fake list glyphs (`mso-list:Ignore` spans). Everything else
      (class soup, `mso-*` styles, Google Docs' `font-weight:normal` `<b>`
      wrapper) dies in the schema parse, where it belongs. Known limit: Word
      lists arrive as plain paragraphs (glyphs stripped, structure not
      reconstructed) — real `<ul>` reconstruction from `mso-list` levels is
      its own future item.
- [x] **Link editing UI**: selection-anchored popover (edit/apply on Enter,
      open, unlink) replaces `window.prompt`; a bare cursor inside a link
      edits the _whole_ link via the new `linkRangeAt` helper, and
      `setLink`/`unsetLink` learned the same. Typed URLs auto-link on the
      committing space (`www.` gets `https://`, trailing punctuation stays
      outside). Script URLs: refused by the schema on parse _and_ on the
      command, and flagged as errors in the source pane. **Paste-to-link**:
      pasting a bare URL onto selected text links the text instead of
      replacing it (`linkPastePlugin`; `www.` gets `https://`, script URLs
      refused, non-URL/multi-word pastes fall through to normal paste).
- [x] **`/image` slash command**: opens the OS file picker and inserts the
      chosen image(s) at the cursor — the slash path mirroring the existing
      drop/paste pipeline.
- [x] **Images are inline — decided 2026-09-02, Gmail's and Proton's model.**
      The node was a block; the caret could only stand above or below it as
      a gap cursor. Both reference clients keep the image _in the text line_
      (`<div><img …><br></div>` in Gmail's compose DOM), which is what gives
      the tall caret right beside the image and lets typing continue next to
      it. Now `inline: true, group: 'inline'`, an atom like the merge tag:
      an image on its own line serializes as `<div><img …></div>` (Gmail's
      own shape — the golden corpus was bumped deliberately), inside text it
      stays in the line. Hybrid sizing is unchanged: `width: 100%` on an
      inline-replaced element resolves against the containing block exactly
      as it did on the block form, and Outlook renders inline images
      natively. Dropped files insert at the caret; at a block boundary the
      transform wraps the image into a line of its own. Being an inline atom
      it is _selectable_: a click makes it the node selection — kept on
      purpose, the resize pads below will hang on it. ProseMirror hides the
      native highlight for node selections, and an `<img>` cannot carry an
      overlay, so the editor renders the image in an editor-only wrapper
      (`span.aee-image > img`, a NodeView: the `<img>` inside is exactly
      `toDOM`, and serializer and clipboard never see the span) and the app
      paints the selection on the wrapper — a primary tint overlay plus the
      outline, selected the way a text highlight reads. Backspace/Delete
      remove it, arrows step over it.
- [x] **The editor's text column is the email's 600px box (2026-09-02).**
      `.aee-editor` is `width: 600px` in the app — a width, not a max-width:
      the composer never shrinks below the email's box (Gmail's compose is
      fixed-width for the same reason; it reaches ~587px, Proton ~585, we
      reach the full 600), and the host lays its panes out around it — the
      example app's grid gives the editor a content-sized column and the
      source pane what is left. Same ceiling `CONTAINER_MAX` and
      `MAX_IMAGE_WIDTH` use, so what wraps in the editor wraps in the email,
      the columns block goes side by side at exactly the editor's width, and
      a max-size image fills the line. First attempt capped the image to the
      _pane's_ line instead, which on a three-pane screen was ~400px — the
      cap was right, the column was wrong.
- [x] **Image resize — shipped 2026-09-02.** Two pads inset on the wrapper's
      left and right edges, shown on hover and on the selected image (and
      throughout a drag, since the pointer may leave the image). Dragging a pad draws
      only a primary _frame_ at the would-be size — ratio-preserving by
      construction, since only `width` is ever written and the serialized
      style keeps `height: auto` — and the actual resize (`setNodeMarkup`
      with the new width, clamped between `MIN_IMAGE_WIDTH` and the line's own
      width, never past `MAX_IMAGE_WIDTH` — at the ceiling the image fills
      the line and the next caret position is the next line)
      happens once, on release: `ColumnsResize`'s deferred-commit drag, on
      an image. The node selection survives the commit, so the pads stay.
      A pad press never reaches ProseMirror (`stopEvent`), so it is never a
      node drag or a click; a press without movement commits nothing. The
      app owns the pixels: `--email-image-pad` / `--email-image-resize-frame`
      → `--mat-sys-primary` → fallback.
- [x] **Drop line (2026-09-02).** A dragged image drops _inline at the
      caret_ — where the cursor sat before the drag, Gmail's rule: the
      pointer only says the drag is over the editor. While the drag is in
      flight a horizontal line runs under the caret's visual line, the line
      the image is about to join — the caret's own box gives the line's
      bottom, the surrounding block its width (`imageDropTarget`). The line is a bare `div.aee-drop-line` positioned
      the way prosemirror-dropcursor positions itself (absolutely, against
      the editor's offset parent — never inside the document); the app owns
      the pixels through one token, `--email-drop-line` → `--mat-sys-primary`
      → fallback. Shown only for drags the editor would claim — a mixed drag
      draws nothing here, the host's zone lights up instead.
- [x] **Image placeholder (2026-09-02) — the slide-deck model.**
      `/image placeholder` inserts a _sized frame awaiting its file_: an Image node
      with no `src`, no new node type — one schema rule, one serialization
      (`<img width="320" style="…">`, honest: nothing pretends to be a
      picture), the same resize pads for free. In the editor it is a dashed
      frame (`span.aee-image__placeholder`, app-styled, 4:3); size it first,
      then click it and the picker's file fills it in place, keeping the
      frame's width and the author's alt (`filledPlaceholderAttrs`). The
      source pane lints an unfilled one ("Image placeholder — no source
      yet"), once, instead of the alt warning. Precedent, for the record:
      no compose client has this (Gmail, Outlook, Proton, Apple Mail never
      separate _where_ an image goes from _which_); Keynote/PowerPoint/Pages
      media placeholders and Canva frames do exactly this, Notion/Gutenberg
      insert an unsized empty block, email builders (Mailchimp, Beefree) an
      empty block sized by settings. Ours is the image counterpart of the
      merge tag — template-ready by construction.
- [x] **Images**: the Image node now serializes the ledger's hybrid sizing
      (`width` attribute for Outlook + `width:100%; max-width:<n>px;
height:auto` for everyone else), caps widths at 600px on parse and on
      drop, never parses or emits `float`, and handles dropped/pasted image
      files (data-URL source, alt defaulted from the filename, natural width
      measured). Missing/empty alt is linted in the source pane, and so is
      a data-URL source (2026-09-02) — the data URL is what the editor holds,
      the send intent turns it into a `cid:` part (M6). Open end,
      deliberately: there is no alt/width _editing UI_ yet — the source pane
      is the editor for those attrs for now.
- [x] **Alignment & direction**: paragraphs carry an `align` attr — center
      and right serialize as inline `text-align`, left canonicalizes to
      _nothing_ (the default carries no declaration, and `dir="auto"` stays
      meaningful for RTL). Justify is refused: Outlook's Word engine mangles
      it. Toolbar group + Gmail keybindings (Mod-Shift-L/E/R); empty lines
      keep their alignment through the `<div><br></div>` serialization.
- [x] **Indent & outdent** (2026-09-14): paragraphs carry an `indent` attr in
      steps of 40px — Gmail's step, so its indented mail round-trips — that
      serializes as inline `margin-left` and canonicalizes to nothing at 0;
      capped at 8 steps. Toolbar pair beside the lists + Gmail keybindings
      (Mod-] / Mod-[). In a list the same gesture nests or lifts the item
      instead (Tab / Shift-Tab already did). Enter at a line's end now keeps
      the line's indent _and_ alignment on the new line, as Gmail does. The
      text/plain projection indents four spaces a step.
- [x] **Clear formatting** (`Mod-\`, toolbar): strips every mark from the
      selection; block structure (lists, quotes, alignment) is layout, not
      formatting, and stays. Note: not yet mirrored into the source pane —
      `createSourceMarks` mirrors mark extensions only; widening it to
      opt-in functional commands is a small follow-up if wanted.
- [x] **Font size/family** as a constrained set of email-safe stacks
      (Sans-serif `Arial, Helvetica, sans-serif`, Serif `Georgia, Times,
serif`, Monospace `Courier, monospace`, System `system-ui, sans-serif`)
      — no free-form fonts. Both hang off the shared `textStyle` span as
      attributes (like `color`), so size + family + colour merge into one
      `style` string instead of nesting wrappers. Toolbar pickers offer only
      the curated set (the affordance is the enforcement, mirroring the colour
      palette); the picker's size list is the phone-safe subset (≥14px per the
      ledger) while the parser still accepts a hand-typed source-pane size, and
      the source pane is likewise free to type any font — anything outside the
      curated set simply drops on parse. Stacks are deliberately built from
      bare single-word identifiers + a generic fallback so they survive the
      CSSOM serialization round-trip byte-identically in both jsdom and Chrome
      (a quoted `"Courier New"` would diverge — the same trap the
      longhand/`rgb()` rule guards). Lint-clean (only the `font` _shorthand_ is
      flagged, never the longhands); pinned by golden + round-trip tests.
      **Persistence (Gmail-parity):** a font/size/colour chosen on a bare
      cursor sticks for the rest of what you type, across both Enter and
      Shift-Enter — because `textStyle` no longer carries the (mistaken)
      `splittable: false` flag, and Enter is now bound to a mark-preserving
      split (`SplitKeepingMarks`, the `splittable`-aware sibling of
      prosemirror-commands' `splitBlockKeepMarks`, placed after lists/quotes
      but before the base keymap). One rule now governs both break paths:
      `splittable: false` = "stop at any break" — kept only by `link`, so a
      break inside a link never drags it onto the next line. (Lists already
      kept marks via `splitListItemKeepMarks`; this closes the same gap for
      plain `<div>` lines.) Pinned by [split-keeping-marks.spec].
- [x] **Dual-contrast color palette** (principle 9): replace the native
      arbitrary-hex color input with a curated swatch set whose every color
      reads against both white and near-black. Enforcement at the picker
      only — no color checking, rewriting, or nagging from the source pane.
- [x] **Background colour / fill**, in three scopes behind one affordance.
      Principle 9 makes fills the _hardest_ colour feature: a background is a
      **pair** constraint — near-black text sits on it, and forced dark mode
      recolours fill _and_ text together. So `passesDualBackground` selects
      **pale tints** (readable with black text now, and their complements read
      with white text after inversion); the text palette's mid-tones are
      explicitly _not_ fills, pinned by test. One curated
      `emailBackgroundPalette` feeds every scope:
  - **Text highlight** — a `backgroundColor` attr on the shared `textStyle`
    span, merging with colour/size/family into one `style` string.
  - **Table cell** — a `background` attr on `tableCell` (`background-color`
    on `<td>` is the most bulletproof background in email; renders even in
    Outlook). Legacy inbound `bgcolor="…"` parses into it.
  - **Column** — a `background` attr on `column`, for coloured callout panels.
    The toolbar has a single **fill** picker that routes by cursor: selected
    text → inline highlight; a bare cursor in a cell or column → fills that
    container; otherwise → inline highlight. All longhand rgb(), lint-clean,
    byte-stable fixpoints, pinned by golden + round-trip tests.
- [x] **Word/line counter placement**: the `textMetrics` extension already
      computes words/lines/height as pure arithmetic (no DOM reads on the
      keystroke path); this surfaces it. The email pane's `bodyMetrics` signal
      is lifted to the compose shell via `viewChild` and rendered in the status
      strip's right-hand group (beside the size gauge) as "N words · N lines",
      singular-aware. Width-dependent line count rides the extension's existing
      `ResizeObserver`, so it re-measures fluidly on resize.
- [x] **`/send`** — shipped once M6's scope decision dissolved both blockers:
      there is no transport to wait for (the composer emits a send _intent_),
      and the `SlashItem` contract fits after all — an item's command is just
      a ProseMirror `Command`, and a `Command` may act without dispatching
      (probing calls get no dispatch and emit nothing). See the M6 send-intent
      entry for the shape. This closes M2.

## Milestone 3 — The deliverability lint engine

Turn the linter from "is this valid HTML" into "will this render in Outlook".
This is where the source editor earns its seat.

- [x] **Client-support data module** (`client-support.ts`): a curated
      caniemail subset — CSS property entries with value/tag scoping
      (display:flex yes, display:block no; padding on div/p, not td) and
      client labels. Curation rule: only what we're confident about, phrased
      as what _actually happens_. Accuracy beats coverage; grows entry by
      entry.
- [x] **Own-output blind spots closed (2026-09-02).** `padding` on `<a>` is
      now an entry — Outlook ignores it, so the button no longer uses it: it
      is the _border-based_ bulletproof button (borders in the background
      colour give the ≥ 44px target; Outlook draws borders on inline
      elements), and our output stays lint-clean honestly rather than by
      omission. `display: inline-block` is an entry too (Outlook renders
      inline or stacks), exempt where we degrade on purpose: paired with
      `width: 100%` (the fluid columns stack) and on anchors (the button
      keeps its box). Deliberately _not_ entries: `box-sizing` and
      `overflow-wrap`, which Outlook ignores harmlessly in our cells and
      columns — flagging them would be noise on every email.
- [x] **Style linting**: every inline declaration is checked against the
      data module, positioned on the exact declaration. The image hybrid
      (max-width paired with a width attribute) is exempt by design, and our
      own canonical output is lint-clean — pinned by test.
- [x] **Size budget**: the status strip grades the canonical HTML against
      Gmail's 102 KB clip (warning at 80%, error above), in UTF-8 bytes.
- [x] **Hover documentation**: tooltips name the client and the consequence
      ("max-width — Outlook (Windows): it sizes from the width attribute
      instead…") straight from the data module.
- [x] **Problems panel, first form**: a status strip under the panes —
      error/warning counts that jump the source pane to the first offender,
      plus the size gauge. A full listed panel can grow from the same
      diagnostics stream when needed.
- [x] **Autocomplete** for the email-safe vocabulary
      (`createHtmlAutocomplete`, same interaction contract as the slash
      menu): tags after `<` (accepting inserts the pair with the cursor
      between), the _currently open_ tags after `</`, per-tag attributes
      (cursor lands inside the `=""`, already-present ones excluded), and
      safe style properties inside `style="…"` — never in prose, never in
      non-style attribute values. Context is derived from the document, not
      keystrokes, via the pure `completionContextAt`.

## Milestone 4 — Preview & proof

"Sure shot that our email renders" needs evidence, not confidence.

- [x] **Rendered preview pane** (`section[email-preview]`): the canonical
      HTML in a fully sandboxed iframe (no scripts, no same-origin) — a
      strictly read-only third projection of the same signal, opening at
      **320px phone width first** per the ledger, with a 600px toggle.
- [ ] **Client simulation modes**: today the preview applies a generic
      client surface (default typography on white); per-client resets
      (Gmail, Outlook Word-engine approximation) are still open. Honest
      label: simulation, not screenshot testing.
- [x] **Dark mode preview**: simulated Gmail-style forced inversion
      (`invert + hue-rotate`, images double-inverted back) — mid-tones
      survive, extremes flip, exactly the dual-contrast story made visible.
      Labeled as a simulation in the UI.
- [x] **Plain-text projection** (`emailPlainText`): blockquotes become `>`,
      lists `-`/`1.`, links keep URLs, images fall back to alt text —
      visible as the preview's "Text" tab, ready for multipart/alternative.
- [x] **Golden-file test suite**: exact canonical outputs pinned byte-for-
      byte plus round-trip fixpoint tests on foreign markup. Paid for itself
      immediately: it caught our styled link re-parsing its own
      `text-decoration` as an Underline mark — fixed by giving marks
      `emitDOM` (clean `<a>` in email output, pretty link in the editor
      view only).
- [ ] **Outlook conditional comments** (`<!--[if mso]>`): policy decided in
      M1 — if layout blocks need them, their serializer generates them and
      their parser ignores them; they are never document content.
      Marketing-grade table layouts remain a non-goal.

## Milestone 5 — Layout blocks, our way

MJML is the only well-known answer here, and we don't like it — it's clumsy,
and it's a foreign dialect. The bet instead: **if our responsive opinions are
strong enough, native blocks replace MJML entirely.** A `/columns` block is
just another schema extension that emits fluid, email-safe markup directly —
no compiler pass, no intermediary format, nothing the user (or the source
pane) can't see and edit.

- [x] **Slash-menu layout blocks** — four shipped blocks:
      **`/divider`** (a filled 1px bar, `width: 100%`, ledger-clean),
      **`/button`** (an atom serializing to a padded `inline-block` anchor —
      ≥44px touch target via padding, no `height`, no `border-radius`, so
      it's lint-clean; `display: inline-block` doubles as the parse
      discriminator that keeps a button distinct from a link), **`/table`**
      (see below), and **`/columns`** — the flagship. All appear in the slash
      menu automatically (the menu aggregates `slashItems` from the kit).
      Learned along the way (button): a block node rendered as an inline `<a>`
      can't hold editable content — contentEditable unwraps it on typing — so
      the button is an atom whose label/href are edited in the source pane
      (like image alt). An inline label editor is a polish follow-up.
- [x] **`/columns` — the MJML-killer (responsive layout, no media queries)**:
      `columns` > `column` nodes. Each column is an `inline-block` div with
      `width: 100%` capped by `max-width: container/n` and
      `box-sizing: border-box`; on a wide screen the caps let columns sit side
      by side, on a phone `width: 100%` wins and they **stack** — verified
      live (side-by-side at 640px, stacked at 320px). Outlook ignores
      `inline-block` and simply stacks too: the same graceful, phone-first
      result, no ghost tables needed for v1. `/columns` inserts 2 (each
      `max-width: 300px`), `3 columns` inserts 3 (`200px`); columns hold full
      block content (paragraphs, images, buttons, nested blocks). Parse is
      discriminated by the `display: inline-block` style (column) and by
      having inline-block child divs (container) — no data attributes, inline
      styles only. All longhand/fixed-px, so it's a byte-stable fixpoint in
      both engines. The lint's `max-width` warning is exempt when paired with
      `width: 100%` (the fluid pattern degrades gracefully in Outlook), so our
      own output stays clean. ArrowDown from a column's last block escapes to
      a paragraph below (like the table). **Centred by default**: the container
      pairs its cap with longhand `margin-left/right: auto`, because
      `max-width` alone leaves the block hugging the left of any viewport wider
      than it — and an email body that isn't centred reads as broken. Auto
      margins are normally the thing to distrust in email (Outlook's Word
      engine handles them poorly), but they are safe here _by the same pairing
      logic as `width: 100%` + `max-width`_: Outlook ignores `max-width`
      entirely, so the container spans full width there and has nothing to
      centre — the only clients where the cap is visible are the ones that
      honour auto margins. Verified: 600px block, 150px gaps either side, in a
      900px body. **Add/remove columns after insertion** — shipped, via the
      block menu (below): `addColumn` inserts an empty column after the
      cursor's, capped at `MAX_COLUMNS = 4` (at four the even split is already
      ~140px — a feature-row width, and the floor for readable prose; the cap
      lives on the command, so authored markup with more columns still parses);
      `removeColumn` deletes the cursor's column and refuses on the last one
      (emptying the block is `deleteColumns`' own explicit affordance, the
      table's deleteRow/deleteTable split). Every structural edit **re-splits
      the caps evenly** — the geometry derives from the count, so an authored
      asymmetric cap doesn't survive a structure change (rebuilding is repair);
      fills and content are kept. Not yet: richer gutters beyond the 8px
      padding; Outlook ghost tables for true
      side-by-side there remain a deliberate non-goal. Note the **data
      `/table` is `width: 100%`** — it always spans, so there is nothing to
      centre; centring a table would first need a width control — which now
      exists (the 2026-08-22 edge drag gives tables a percentage width), so
      table centring is unblocked and merely undecided.
- [x] **`/table` — constrained data table**: a real `<table role=
"presentation">` (the most client-compatible layout) restricted to a
      plain rectangular grid — no colspan/rowspan, so the model is a clean 2D
      array. Nodes: `table` > `tableRow` > `tableCell` (`paragraph+`, so
      cells hold rich text). Working: slash/command insertion (cursor lands
      in cell 0,0), cell editing, **Tab/Shift-Tab navigation** (Tab past the
      last cell appends a row), and structural commands (`addRow/Column
Before/After`, `deleteRow/Column`, `deleteTable`) that rebuild-and-
      replace the table node rather than juggle positions. Round-trips through
      the source pane, lint-clean, `<tbody>` fixpoint. Note: this is a _data_
      table (stays tabular, scrolls on a phone); the spongy stacking layout is
      the future `/columns`. **Deliberately kept simple** (an earlier
      Notion-style hover overlay — add/delete handles, padding steppers,
      pointer tracking — was tried and reverted; it was fiddly and got in the
      way): the only affordance is a **subtle editor-only grid** — see
      **Layout guides** below, the one mechanism tables and `/columns` share.
      It is _never_ in the serialized email — the exported table is borderless
      with fixed, responsive padding (`8px 12px`). Structure is keyboard/command-driven:
      Tab/Shift-Tab navigation, and **ArrowDown from the last row escapes to a
      paragraph below** (created if the table is the last block) so you can
      always write underneath. The structural commands (`addColumnAt`,
      `deleteRowAt`, …) remain in the library for a future, calmer UI.
  - **Cells hold inline content** (`inline*`), not wrapped paragraphs: an
    empty cell is `<td></td>`, never `<td><div><br></div></td>`. The stray
    `<br>` made ProseMirror's parser grow a phantom cell on every round
    trip — a real corruption bug the text-cell tests had missed. Bonus:
    text marks (bold, links, colour) now work inside cells. Pinned by an
    empty-cell round-trip test.
- [x] **Layout guides — one mechanism for every layout block.** Tables and
      `/columns` both export structures that are _invisible_ in the email (a
      borderless table; bare inline-block divs), so the editor has to show their
      shape — and it now shows it the same way for both, via the `LayoutGuides`
      extension. A decoration tags whichever layout block holds the cursor with
      `aee-guides-active`; the app's global CSS resolves the pixels against a
      border that is **always reserved as transparent**, so revealing a guide
      never shifts layout. Three ways in:
  1. **Cursor inside** the block (the original table behaviour, now shared).
  2. **Hover** — pure CSS, revealing the _whole_ block (not just the cell or
     column under the pointer), so it reads as one grid.
  3. **Peek: hold Ctrl (~300ms)** → `aee-guides-peek` on the editor root reveals
     every block at once. The hold delay is the point: Ctrl is also the
     prefix of every shortcut, so an instant reveal would flash the grid on
     each Ctrl-B/C/Z — any other keypress cancels the pending reveal, and a
     window blur clears a stranded hold. (Alt steals the browser menu bar on
     Windows, Shift flashes on every capital, and Meta opens the Start menu —
     Ctrl is the only safe modifier. A toolbar toggle remains the more
     discoverable option if a persistent mode is ever wanted.)
     Columns get their CSS hooks (`aee-columns` / `aee-column`) from `toDOM`,
     while `emitDOM` drops them — the same serialization-only split the email
     paragraph uses, so no class ever reaches the email. Pinned by test.
- [x] **Block menu — the bubble menu's sibling for layout blocks.** Block-level
      commands kept piling up with nowhere to live: the table's structural
      commands were library-only, and add/remove-column would have been the
      third feature to hit the same wall. The `blockMenu` extension reports
      which layout block holds a **bare cursor** (plus the block's rect); the
      app renders one calm toolbar anchored _below the block_ — it describes
      the whole structure, not the line being typed, and under the block it
      never covers the first row while writing. The bare-cursor trigger makes
      it mutually exclusive with the text bubble menu (which needs a non-empty
      selection) by construction — never stacked. Keyboard-reachable:
      **Alt-F10** (CKEditor's convention; bare F10 belongs to the browser)
      moves focus into the menu, Escape hands it back; focus sitting inside
      the menu counts as still-active, so reaching for it by keyboard isn't
      the thing that closes it. Today it carries the table's row/column/delete
      commands and the columns block's add/remove/delete. Deliberately _not_
      the reverted Notion-style overlay: no pointer tracking, no hover
      handles — one toolbar, positioned by the app.

### Known dissatisfactions — parked on purpose (noted 2026-08-19)

We're moving forward (M6) before polishing these; the schema/UI split makes
that safe (the canonical HTML is the only durable contract — all of the below
is UI-layer or additive). Honest framing: the table/columns _editing UX is
still clunky and unintuitive_ overall; these are the concrete symptoms.

- [x] **Block menu doesn't track its block.** _Fixed by construction
      (2026-09-25)._ Adding a row grew the table but the toolbar stayed where
      it was: the extension re-measured the block on every transaction, but
      the CDK overlay never followed an origin that moved. Every floating
      menu — the bubble menu, the block menu, a grip's row menu, the link
      and alt-text editors — used to be its own overlay with an anchor and a
      position strategy of its own, each landing afresh whenever a neighbour
      closed (pass an image by one character with Shift-Arrow and the image's
      bubble popped in over the text's, then the text's popped back). They
      are now **panels of one popover** (`Popover` service +
      `popover-outlet`, provided per composer beside `FormattingCommands`):
      which panel is up is derived — dialogs over toolbars, the most recently
      opened within a layer — the outlet re-places the overlay whenever the
      shown panel's box changes, and only the content and the anchor change
      while it stays up, so the landing plays once per opening. Pinned by
      `popover.spec.ts`; the block's own move is geometry jsdom cannot paint.
- [ ] **Click-below should escape the block.** _Mechanism shipped
      (2026-08-20), confirmation outstanding._ `prosemirror-gapcursor` now
      gives every isolating block a real cursor position beside it, so the
      click lands a gap cursor and typing there creates the paragraph — the
      ProseMirror idiom, and better than eagerly growing an empty paragraph
      nobody asked for. Left open on purpose: click geometry is exactly what
      jsdom cannot prove and the hidden preview cannot paint, so this stays
      unchecked until someone confirms it in a real browser.
- [ ] **Real borders are impossible.** The editor grid is editor-only by
      design, but there is no affordance to give the _serialized_ table a
      visible border at all. Needs a curated border option (longhand, on the
      `<td>`s — the Outlook-safe way), routed through the block menu.
- [x] **Columns and tables — decided (2026-08-23): separate semantics, shared
      interaction vocabulary.** The framing that settled it: _a table is data,
      columns are layout._ So columns do **not** become a table under the skin
      — different nodes, different models, different email output — and they
      borrow a table gesture only where the gesture's _meaning_ survives the
      change of semantics. The port matrix:
  - **Boundary drag** — yes, **shipped 2026-08-23** (`ColumnsResize`; the
    wrapper carries the container style so it _is_ the 600px box, lines
    at the cumulative caps in px, `MIN_COLUMN_CAP` 120px floor, verified
    stacked-hides and side-by-side drag in-browser). Same deferred-commit
    drag, different model: a
    table splits 100% of itself, columns redistribute the email's px
    _budget_ (the `max-width` caps, the ledger's hybrid); phones still
    stack because every cap exceeds the viewport. Lines are
    model-derived in px (cumulative caps from the container's edge), and
    a CSS container query hides them when the block is stacked — the
    budget is a constant, so "stacked" flips at a constant width, no
    measurement.
  - **Add pill** — yes, same affordance and sensor zone, same meaning.
  - **Add-row pill** — no: columns have no rows; a second row of columns is a
    new block, the slash menu's job.
  - **Delete gesture** — yes, but a different gesture: there is no cell
    selection, so the layout-native rule is the list item's — Backspace at
    the start of an empty column removes the column, in the last empty
    column removes the block.
  - **Selection rectangle, merge/split** — no: nothing to merge in layout.
  - **Container edge drag** — parked: columns own `align` already, and a
    narrower centred set is low value.
    Nothing flows the other way: no stacking, no px caps in tables — a data
    table stays tabular and scrolls on a phone. Once the three yeses land,
    the columns block menu has nothing left either and the block-menu
    extension can retire wholesale.
- [ ] **Merged cells have no affordance yet.** `mergeCells`/`splitCell` are
      exposed as commands and cell selection works (shift-drag a rectangle),
      but the block menu opens only on a _bare cursor_, and a cell selection is
      by definition not empty — so the one moment you'd reach for "merge" is
      the one moment the menu is closed. Fixing it is a menu-rule decision, not
      a table one: open on a cursor _or_ a cell selection, and keep the text
      bubble menu out of the way so the two never stack.
- [ ] **Schema growth to hold them**: constrained table/section nodes with
      strict parse/serialize rules — the gate for this milestone, and it must
      not loosen the canonical guarantees for plain text emails.
- [x] **Round-trip stance**: holds for every shipped block (divider, button,
      table, columns) — each is canonical HTML, editable in the source pane,
      linted, re-parsed. No hidden state, no "locked" regions; the schema, as
      always, is law.
- [x] **Merge tags are text with a mark, not atoms — decided 2026-09-02.**
      The atom pill could not be entered (no cursor inside, no hand editing)
      and could not wrap (a 171-character ternary overflowed the 600px column
      by 459px). Now the raw `{{expression}}` is ordinary text and `mergeTag`
      is a mark that only paints the pill — editor-only, the email carries
      the bare text (`emitDOM: null`, the serializer skips the mark). Two
      invariants, kept by `appendTransaction` after every change and by
      `promoteMergeTags` at parse: (1) the mark covers exactly what reads as
      a token — derived from the text, never stored, so type `}}` and the
      pill appears, delete a brace and it is gone; (2) formatting is
      _all-or-nothing on a token_: Ctrl-B with the cursor inside bolds the
      whole `{{…}}` (stored marks become a whole-token mark), a mark added or
      removed over part of a token is widened to the token (its steps are
      widened), and a token pasted partially formatted is repaired to whole —
      so the value it renders to ("Mr Wild") is formatted as one. The bubble
      menu stays away inside a token. Lost on purpose: one-Backspace deletion
      and dragging a token as a block — it is text now.
- [x] **Tokens are padded canonically: `{{ expr }}` (2026-09-02).** One
      space each side of the trimmed expression — the formatter's rule
      (Shift-Alt-F, Mod-S, format-on-blur) and, because formatting must stay
      presentation-only, the _schema's_ form too: the parser repairs incoming
      padding, the editor pads a token once it is complete and the cursor has
      left it (never under the typist's cursor), the `{{` menu inserts the
      form directly. The expression itself stays byte-verbatim; edge
      whitespace is insignificant to AngularJS and Handlebars alike.
      Handlebars' `{{~ … ~}}` and `{{& …}}` keep their sigils against the
      braces. The invariance test still holds: `format(html)` and `html`
      canonicalize identically.
- [x] **AngularJS expressions — the first dialect, opt-in (2026-09-02).**
      The merge-tag mark is dialect-neutral; a _dialect_ (`ExpressionDialect`,
      one per editor as plugin state) layers meaning on the tokens. The
      sponsor's dialect came first: `createAngularExpressions()` — a
      recursive-descent parser for `$parse`'s grammar (literals, members,
      calls, unary/binary operators, the ternary, filters with `:` args,
      assignments, `;` statements). From the parse: **syntax diagnostics**
      (an unbalanced quote, a dangling `?`, a stray `#` — positioned inside
      the token, underlined in place via `.aee-expr-error`, reported to the
      host through `onDiagnostics`; the example app counts them as errors
      in the status strip and reveals them in the editor pane) and **exact
      required fields** on the send intent (the root of a member chain,
      both sides of a computed member, call and filter arguments; never a
      bare callee, a filter name, a property tail, a literal or a local
      assigned anywhere) — the generic lexer stays the fallback for editors
      without a dialect. Recognises, never evaluates or rewrites. Next
      slices: highlighting inside the pill, filter/field completion inside
      a token, evaluation with sample data for the preview; a Handlebars
      dialect (block pairing awareness) alongside.
- [ ] **Template-ready, not templated.** We expect a handlebars-like dialect
      to emerge naturally once the blocks exist: placeholder nodes that
      survive the round trip and serialize as `{{name}}`-style tokens. We
      design the schema so nothing blocks that — and promise nothing more.

## The responsiveness ledger

Principle 8 dies in the details: each extension is built on a desktop, looks
fine on a desktop, and quietly breaks at 320px. This ledger exists because we
_will_ forget. Rule of thumb for everything below: no media queries (they get
stripped), so every answer must be fluid and inline.

**Definition of done for any node extension: its JSDoc states what happens at
320px, and its serialize rules implement that answer.**

| Extension                      | The trap at 320px                                                                                         | Our fluid answer                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Image**                      | Fixed pixel width overflows the screen; Outlook ignores `max-width` entirely                              | Hybrid sizing: `width` _attribute_ for Outlook + `style="width:100%; max-width:<n>px; height:auto"` for everyone else                                                                                                                                                                                                                                              |
| **Table / layout blocks (M5)** | Columns keep their desktop widths and force horizontal scroll                                             | ✅ **Shipped (`/columns`)**: `inline-block` columns with `width:100%` capped by `max-width: container/n` + `box-sizing:border-box` — side by side when the caps fit, stacked when they don't. Outlook ignores `inline-block` and stacks too. Ghost tables for true Outlook side-by-side remain a non-goal for now. (Data `/table` is separate — it stays tabular.) |
| **Lists**                      | Default `padding-inline-start: 40px` per nesting level — two levels eat a third of the screen             | ✅ **Shipped 2026-09-02**: `margin: 0px; padding-left: 24px` on `ul`/`ol` — 24px per level, no margins, tested nested                                                                                                                                                                                                                                              |
| **Blockquote**                 | Nested reply chains accumulate margins until text is one word per line                                    | ✅ **Shipped 2026-09-02**: `margin: 0px; padding-left: 12px; border-left: 2px solid` — 14px per nesting level, never a stacked margin                                                                                                                                                                                                                              |
| **Headings**                   | Desktop-sized `h1` wraps into a wall at phone width                                                       | ✅ **Shipped 2026-09-02**: 24/20/18/16px scale as inline `font-size`, `margin: 0`; no `line-height` on purpose (Outlook substitutes its own — the lint would say so)                                                                                                                                                                                               |
| **Paragraph / document width** | Full-width lines are unreadable on desktop, so someone will add a fixed container that then breaks phones | If we ever emit a wrapper, it is `max-width` + `width:100%` — the hybrid, never a fixed width                                                                                                                                                                                                                                                                      |
| **Links / long text**          | An unbroken URL or token wider than the viewport forces the whole email to scroll                         | `word-break`-friendly serialization for link text where possible; lint long unbroken strings                                                                                                                                                                                                                                                                       |
| **Button block (M5)**          | Padding-based fake buttons too small to tap                                                               | Touch target ≥ 44px via padding (never `height`), generous inline `padding`                                                                                                                                                                                                                                                                                        |
| **Font sizes**                 | Below ~13px, iOS auto-inflates text and reflows the layout                                                | Minimum emitted font size ≥ 14px; the lint engine (M3) enforces it                                                                                                                                                                                                                                                                                                 |
| **Horizontal rule**            | Fixed pixel width                                                                                         | `width:100%`, done                                                                                                                                                                                                                                                                                                                                                 |

Two enforcement hooks so the ledger stays alive:

- [x] **Lint rules from the ledger** — shipped 2026-09-02: a fixed pixel
      `width` on anything but an `<img>` ("use the hybrid"), `font-size`
      below 14px (iOS inflates; the picker never offers less, a hand-typed
      size is caught), and unbroken runs past 40 characters (a 320px line at
      14px; merge tags masked out first) — each positioned on the offending
      declaration or run, like the client-support warnings.
- [x] **320px preview default** (M4): the preview pane opens phone-width
      first. If it looks right narrow, desktop is almost free — never the
      other way around.

## Milestone 6 — Compose workflow

**Scope decision (2026-08-19): the envelope is the host's.** We never build
to/cc/subject fields — this project is the editorial engine, and the host app
owns addressing, transport, and everything envelope. Headers matter to us only
where they become _document content_: the attribution line above a reply's
quoted block ("On {date}, {name} wrote:") is generated from inbound From/Date
**passed in as data** — never from fields we render.

- [x] **`/send` = a send intent, not a transport.** Shipped as
      `createSendIntent({ onSend })` — the bubble/slash-menu factory pattern:
      the extension computes the payload (canonical HTML + the `emailPlainText`
      projection, the two parts of `multipart/alternative`) and hands it to the
      callback; the host attaches envelope and transport. Three ways in, one
      payload: the `/send` slash item (the menu deletes the query text before
      the command runs, so the payload is always clean of it), **Mod-Enter**
      (Gmail's shortcut — unclaimed, hard break only owns Shift-Enter), and the
      `requestSend` command for toolbar buttons. Probing calls (no dispatch)
      emit nothing, so menus can test enablement safely. The example app wires
      it to an `output<SendIntent>()` on the email pane and shows the payload
      stats in the status strip — the demo stand-in for a mailer.
- [x] **Draft persistence — nothing to build, by design.** A draft is the host
      persisting the canonical `html` signal on its own clock (an `effect` +
      debounce + database) and restoring with `html.set(saved)`; both halves
      exist since the foundations. No draft format, no draft mode, no draft
      API — a signal read needs no ceremony. Two editor-side footnotes: a
      restored draft carries no undo history (external syncs never enter it —
      collab semantics, pinned by test, correct), and the **restore hazard**
      below is the one real piece of work drafts make load-bearing.
- [x] **External writes survive editor focus.** The panes' sync effects skip
      an incoming value while their editor has focus (protecting the typing
      loop) — and now a **blur listener catches up with whatever the signal
      says at that moment**. No pending-value state: last writer wins by
      construction (if the user's own typing published after the external
      write, the values already agree and blur is a no-op). Both panes carry
      the twin listener; an async draft restore or import landing mid-edit is
      protected while focused and applied on blur, pinned by an app spec.
      (Test-env note: jsdom needs ResizeObserver + canvas-context stubs
      before the email pane can mount at all — without them, `createEditor`
      threw mid-mount and app specs silently exercised nothing.)
- [x] **The example app keeps a real draft** (2026-09-13) — the host half
      above, built the way a mail client does it, with no server: the
      message in localStorage (`LocalStorage.pairSignal(key)`, live across
      tabs through the `storage` event), its inline parts in IndexedDB by
      cid (`BlobStore`), one `Draft` service between them. Saved once the
      message rests and at once on hide/pagehide/leaving the page; no draft
      for an untouched sheet; parts put before the body that references
      them; a tab's own write never mistaken for news, and no save written
      over a draft another tab saved that has not been taken in yet; gone
      after a send or a Discard, in every tab. What it made load-bearing:
  - [x] **Generated Content-IDs are unique across stores** —
        `image-{n}.{random}@aee`. A counter alone is only unique within one
        registry: a restored draft's part met a new image under its cid (after
        a reload, or in a second tab), and a host keying parts by cid
        overwrote one with the other. Plus `inlineImageCids(html)`, the parts
        a draft has to keep.
  - [x] **Focus means the window's too.** ProseMirror's `hasFocus()` stays
        true for a background tab's editor, so a pane skipped another tab's
        save and waited for a blur that had already happened; the panes now
        ask `isTyping(view)` (the view _and_ its document) and also catch up
        on focus.
  - [x] **Mount takes the value before publishing.** The email pane
        published its empty mount document over a value that was already
        there — a synchronous draft restore was wiped and the empty draft
        saved over it.
- [x] **Reply/forward seed constructors** — `replyDocument(inbound)` /
      `forwardDocument(inbound)`: pure functions (inbound data → canonical
      HTML) that the host feeds through the one `html` signal it already
      binds. Deliberately **not** a component input: a reply is an event, not
      state, and a content-bearing input would be a second source of truth
      beside the canonical signal. Reply = an empty paragraph (typing starts
      above the history), the attribution line ("On {date}, {from} wrote:",
      degrading gracefully with partial data; a `Date` formats via Intl with
      a caller-supplied locale, a string date is used verbatim), and the
      inbound in a blockquote. Forward = the conventional header block
      (From/Date/Subject/To — only the supplied lines) and the message
      _unquoted_. The inbound body parses through the email schema like any
      paste (one law — sanitization included), and Gmail's
      `class="gmail_quote"` markup absorbs cleanly: classes drop, nesting
      survives, all pinned by golden-style tests. **The quoted history _is_
      the blockquote** — deliberately not a dedicated node: canonical output
      carries no classes, so a `quotedHistory` node would have no honest
      parse discriminator against a plain blockquote; if a collapse-history
      UX ever wants one, that design starts at the discriminator. Building
      this caught a real hole: `<img src="javascript:…">` survived the parse —
      the Image node now refuses script URLs exactly like the link mark
      (shared `isSafeUrl`, refused on parse and on `insertImage`, pinned).
      Still open: the import _report_ (loss counts through the diagnostics
      channel) lands with the `.eml` work below.
- [x] **Fold history behind an ellipsis (Gmail's `⋯`) — presentation, never
      document state.** Shipped as the `QuoteFold` extension (email kit only —
      reply folding isn't rich-text behaviour), zero app wiring: the hide is
      an inline `display: none` decoration so behaviour needs no CSS, the `⋯`
      is a widget decoration (`aee-quote-fold` — the app owns the pixels), and
      expanded-ness is _the mapped position of the quote the user expanded_ —
      a fresh seed replaces the document, the mapping dies with the replaced
      range, and the new quote starts folded by algebra, not by special case.
      Escape hatches pinned by test: the toggle, ArrowDown from the block
      above (steps in), and an appendTransaction guard that expands whenever
      _any_ selection reaches the hidden range (Ctrl-End, Ctrl-A) — the editor
      never works invisibly. `foldQuotedHistory` (which Gmail doesn't offer)
      rescues the cursor before hiding it. Original design sketch follows: No `collapsed` attr, no marker markup: anything the
      serializer can't emit honestly would be hidden state that lies through
      the round trip. Instead the _discriminator is derived from the document_
      like everything else: the **trailing top-level blockquote** is history —
      exactly what `replyDocument` produces, deterministic, zero markup. An
      editor-only `quoteFold` extension renders it folded behind a `⋯` toggle
      (nodeView/decoration — the layout-guides serialization split); open/
      folded is ephemeral plugin state, so a reopened draft starts folded
      again, like Gmail. The projections never fold: the email always carries
      full history, the source pane always shows it (code doesn't lie), the
      plain-text projection is untouched. Keyboard: ArrowDown into the fold
      (or clicking it) expands — the table/columns escape convention, mirrored.
      Known tradeoff, accepted: an _authored_ trailing quote starts folded and
      is one click to open — the same heuristic bet Gmail makes.
- [x] **`.eml` drop & HTML paste — one law** (core shipped; report below).
      **We do not parse MIME — decided, after briefly shipping our own.** A
      ~200-line `parseEml` covered the easy 80% (multipart, QP/base64,
      RFC 2047), but the hard 20% — malformed real-world mail, charset
      long-tail, RFC 5322 address grammar, TNEF — is a decade of bug-report
      scar tissue that postal-mime/mailparser already own; competing is a
      losing bet for an editor library, so it was scrapped the same day.
      What we own instead is the _integration_: `InboundMessage` is the
      contract, and `toInboundMessage(parsed)` — a zero-dependency,
      duck-typed adapter over the shape modern parsers return (postal-mime's
      `Email`, front- or backend-parsed alike, every field null-tolerant) —
      is the whole bridge:
      `importedDocument(toInboundMessage(await PostalMime.parse(file)))`
      imports a dropped file (a `File` is a `Blob`,
      so the parser gets raw bytes — correct charsets, no lossy `.text()`
      step); `replyDocument(...)` answers it. `importedDocument` is the law:
      the body parses through the schema (full strip = sanitization) and
      _becomes_ the document; `text/plain` is the content when no HTML part
      exists; headers are discarded — envelope is the host's — except as
      attribution/forward-header inputs. `cid:` images arrive unresolvable
      until the attachments story lands. The example app makes the email pane
      an `.eml` dropzone (`@h-k-dev/angular-file-drop`, accept-filtered so
      image drops still flow to ProseMirror) with postal-mime lazy-imported
      on first drop and a sample fixture in `test/`.
- [x] **Import loss report** — the _legibility of loss_ half of the import
      law. `importLoss(inbound)`: pure, derived from the same HTML the import
      consumes, measured against the **schema's own parse vocabulary** (every
      `parseDOM` tag across nodes and marks; tbody/thead/tfoot exempt as
      structure). Reports elements outside the vocabulary (count + distinct
      tags, most frequent first — tag-level granularity, so a legacy
      `<font>` counts as known because `font[color]` parses) and `cid:`
      images separately (they parse in but stay unresolvable until
      attachments). Our own canonical output round-trips as zero loss, pinned
      by test. The example app joins it with the parser's side
      (`parsed.attachments.length` ignored) into the status strip: "Imported
      lossy.eml — 3 elements outside the schema removed (center, o:p,
      script) · 1 inline image awaits attachments". A structured diagnostics
      surfacing can grow from the same `ImportLoss` object when a problems
      panel exists.
- [x] **Inline images — the `cid:` story, not an attachments surface.**
      _Closed 2026-09-02 with the registry (below)._
      **Scope decision (2026-08-20): we build no attachment UI.** A paperclip,
      a file list, upload progress, MIME assembly — envelope, all of it, the
      host's for exactly the reasons to/cc/subject are. What _is_ ours is the
      half that lives in the document: an `<img>` is content, and the editor
      is the only party that knows which binaries the body points at. That
      knowledge is editorial, and today it stays trapped in the document.
      Two loose ends, both real, neither a UI:
  - [x] **Inline or attachment — decided 2026-09-02: the drop decides, the
        editor never asks.** Place first (Gmail's rule): the body is the
        inline zone, the host's shell around it is the attachment zone. Type
        second, inside the body: the editor claims a drop only when _every_
        file is an image (`claimedImageFiles`) — pure images are content and
        embed inline; a mixed drop (an image with a PDF) is an attachment
        gesture and bubbles _whole_, untouched, to the host's dropzone —
        nothing to decide, nothing silently lost. The two zones never fight
        because they nest: ProseMirror sees the event first and calls
        `preventDefault` only when it claims, and the host's dropzone
        (`angular-file-drop`) backs off on `defaultPrevented` — the same
        arrangement the `.eml` import already runs on. What is _inline_ in
        the payload is derived from the document, not from a flag: a part the
        body references by `cid:` is inline (`multipart/related`), anything
        else is the host's attachment (`multipart/mixed`); delete the image
        from the body and it leaves `inlineImages`. No Proton-style prompt —
        a host that wants one puts its own zone around the editor and calls
        `readImageFile` + `insertImage` for the inline choice.
        **No dropzone is a dependency (2026-09-19).** The drag-phase claim was
        a static import of `claimDragEvent` from `@h-k-dev/angular-file-drop/core`
        — one `WeakSet.add` that forced the package on every consumer as a
        peer. Now the host says how a drag is claimed:
        `createImageDrag({ claim })`, called on `dragenter`/`dragover` of an
        image-only drag and on the drop the editor takes. angular-file-drop:
        `claim: claimDragEvent`; dropzone.js, ngx-file-drop, a hand-written
        zone: `claim: (event) => event.stopPropagation()`. No `claim`, no
        zone, no difference. The peer dependency is gone.
  - [x] **A `cid:` resolver input** (`cid → object URL`), display-only —
        shipped 2026-09-02 as the _registry_, see the shipped note below. An
        imported `cid:` image renders broken today: the MIME parts went to the
        host, and nothing connects them back to the node that references them.
        The resolver is a _view_ concern — the canonical `src` stays `cid:`,
        so the round trip never learns about it and the schema stays law
        (same split as layout guides: editor-only, never serialized). The
        preview pane takes the same map.
        **Shipped as the registry — the Gmail model.** One
        `InlineImageRegistry` per composer (`InlineImageStore`,
        framework-free: add bytes → cid, resolve cid → display URL, blob)
        handed to the editor by `createInlineImages({ registry })` — plugin
        state that the Image node, the send intent and the host all read.
        With it a drop registers its bytes and inserts `src="cid:image-1@aee"`
        _at once_: the document stays light, the size gauge honest, and a
        draft is html + the referenced parts. Node views display a `cid:`
        through the registry's URL (a view concern — the round trip never
        learns), render a "missing" frame for a part the registry lacks, and
        re-resolve when it arrives late (a registry change is a meta
        transaction bumping a version carried by a node decoration on every
        `cid:` image). The send intent reads its bytes from the registry.
        The Angular side is `InlineImages`, an `@Injectable()` wrapping the
        store with a signal, provided _per composer_ (never root — two
        composers must not share parts) and revoking its URLs with it: the
        example app feeds it an import's parts _before_ setting the document,
        the editor pane hands it to the extension, and the preview renders
        `previewHtml(html)` — `cid:` sources as data URLs, because a
        sandboxed, opaque-origin frame cannot load the editor's blob URLs.
        Parts stay registered after their image is deleted (undo); the send
        intent and a draft report only what the document references. No
        registry configured → the data-URL path, unchanged.
  - [x] **`SendIntent` reports what the document references** — shipped
        2026-09-02 as `inlineImages: InlineImage[]` on the payload, computed
        by the pure `promoteInlineImages(doc)`. The payload's `html` is
        serialized from a _copy_ of the document in which every data-URL
        image points at a generated Content-ID (`cid:image-1@aee`, … —
        deterministic, so the same document always yields the same payload;
        identical data URLs share one part; ids the document already
        references are skipped), and each promoted image carries its decoded
        `Blob`. Pre-existing `cid:` references (an imported reply's parts)
        are listed by id with `blob: null` — the host received those with the
        import and owns them. The document itself is never touched: no
        transaction, the editor keeps displaying its data URLs, the round
        trip never learns about the promotion. An undecodable data URL is
        left as-is rather than sent as garbage — the lint below names it.
        We report the truth about the document; the host assembles the MIME
        (`multipart/related` around the `alternative`) and owns the
        transport, unchanged.
  - [x] **Lint the data-URL stopgap** — shipped 2026-09-02: an `<img>` with
        a `data:` source is a warning positioned on the source value, naming
        Gmail and Outlook (Windows) and saying what sending does about it.
        Footnote to "our canonical output is lint-clean": a document holding
        a dropped image is the one deliberate exception — the warning is
        the point, the data URL is what the editor must hold until send.

    Framing this corrects: it was filed as the last slice of the compose
    _workflow_, which is why it read as envelope work. It isn't — it is M2's
    image work meeting M6's import law, and it is the only thing between M6
    and done.

## Non-goals (so we stay opinionated)

- **No envelope UI — ever.** To/cc/subject, addressing, transport: all the
  host app's. We are the editorial engine; the compose _workflow_ (M6) deals
  in payloads and intents, not fields. Header data enters only as input to
  content (reply attribution), never as UI we own.
- **No attachments surface.** No paperclip, no file list, no upload, no
  MIME assembly — a corollary of the envelope rule, not a separate one.
  Inline images are the exception that proves it: they are _document content_,
  so we resolve `cid:` for display and report referenced parts on the send
  intent — and stop precisely there (M6).
- **Not a drag-drop marketing builder.** No block canvas, no template
  gallery. This is a _compose_ editor — but an ambitious one: the output is
  always responsive and phone-first (principle 8), and rich layout arrives
  through our own responsive schema blocks (M5), not through a page builder.
- **No MJML.** We tried it; it's clumsy, and it would make a foreign dialect
  the real source of truth. Being opinionated enough about fluid, responsive
  output is precisely what makes MJML unnecessary — that's the M5 bet.
- **No `<style>` blocks, no classes, no JS** in output. Inline styles only —
  everything else is stripped by enough clients to be a lie. This holds for
  responsiveness too: fluid layout, not media queries.
- **No template language — yet, but template-ready.** No promises before
  M1–M4 are solid; when it comes, it will be a handlebars-like dialect as a
  schema extension (M5), not a preprocessor bolted on top.
- **No free-form HTML passthrough.** If you need a tag the schema doesn't
  know, the answer is a new extension with parse/serialize/lint rules — not
  an escape hatch.

## Architecture notes for future us

- **The table model is `prosemirror-tables` (adopted 2026-08-20).** We ran a
  hand-rolled rectangular grid for a while and it was wrong in the way
  hand-rolled grids always are: real mail arrives ragged, our indices assumed
  a rectangle, and every index-addressed edit then hit the wrong cell. The
  official package owns the `TableMap`, `CellSelection` and `fixTables`, so we
  own only the email opinions on top. Two departures from its defaults, both
  deliberate: **no `columnResizing`** (its output is pixel `colwidth`, the
  responsiveness ledger's central trap — the attr exists because the library's
  commands read it, stays null, and is never serialized), and **no header
  cells** (`<th>` parses as a plain cell; an email table is presentational and
  a header that renders bold in one client and not another is a lie).
  `colspan`/`rowspan`, by contrast, are email-safe everywhere including
  Outlook's Word engine — merged cells are a feature, and imported mail keeps
  its shape. Repair runs on both paths: a plugin `appendTransaction` for
  anything arriving as a transaction (paste, drop, `setContent`), and
  `repairTables` inside `parseHTML` so the pure constructors
  (`importedDocument`, `replyDocument`) produce the same rectangle.
  **2026-08-22, two follow-ups:** (1) `table-layout: fixed` (+
  `overflow-wrap: break-word` on cells) is now part of the _serialized_
  style — without it every keystroke re-laid the grid out from content and
  pushed the neighbouring columns; styling it editor-only would have made
  the editor stable and the received mail jumpy, so it ships in both. (2)
  **`ColumnResize`** — drag a column boundary, Tiptap's UX with an
  email-honest mechanism: percentages into the same `colwidth` attr px would
  have gone into (serialized as `width: n%` on the cells; a px width never
  parses in), an editor-only NodeView (`div.aee-table-wrap > table >
colgroup + tbody` + a boundary-lines overlay) none of which serializes
  (clipboard uses the schema `toDOM`, so it stays clean too), a 10% floor
  instead of Tiptap's px min-width, full-height boundary lines _positioned by
  the model_ (`left` = cumulative share — no measurement, no mousemove
  tracking: the reverted-overlay rule), and a **Word-style deferred commit**:
  mid-drag only the guide line moves — live reflow was tried and reverted,
  because a table rewrapping its text on every pointermove reads as the grid
  flying apart — and release applies one transaction, one reflow, one undo
  step. Hover-reveal targets the wrapper (grabbing the line must not un-hover
  the grid it sits on), the grid pins solid while a drag is live, and adding
  a column to a fully-declared table rescales widths by (n-1)/n so the new
  column gets an equal share instead of the zero leftover. The table's own
  box is draggable from **both outer edges**: attrs `{width, offset}` in
  percent (defaults 100/0 — canonical output unchanged), the offset
  serialized as `margin-left: n%` (what Outlook's own Word composer emits;
  clients that strip it degrade gracefully to left-aligned), pixel table
  widths (the fixed-600px newsletter) repaired to fluid on parse,
  offset + width clamped to ≤ 100 with a 20% width floor, same
  deferred-commit drag. **Edge drags absorb, Word-style**: column widths are
  percentages _of the table_, so a naive table resize slides every interior
  boundary proportionally — instead the edge-adjacent column takes the whole
  change and the others rescale by oldWidth/newWidth, keeping interior
  boundaries absolutely fixed (pinned by test and measured in-browser). This
  also makes table centring trivial when it's wanted: offset arithmetic.
  **Add pills (2026-08-22):** the `+` pills append a column / row at the end
  (Tiptap's `…-end-add-remove` affordances, NodeView-owned). The column pill
  spans the table's full height and is **pinned just outside the wrapper's
  right edge**, in the editor's inner-spacing gutter — a fixed, learnable
  spot that never chases the table, never covers the grid, and stays inside
  the scroll container's client area so it can't wake a scrollbar — and reveals only around the last column:
  hovering it — a contiguous sensor zone runs from the table's edge to the
  pill (the YouTube-gesture-layer pattern, over non-editable ground only), so
  the pointer never crosses dead space — or standing in it with the caret (a selection-derived node decoration on
  the wrapper, `aee-table-wrap--in-last-column`). The row pill mirrors all of it along the bottom edge: full-width and
  wrapper-latched (its own sensor — from any last-row cell, straight down
  lands on it), straddling the edge because below the table sits the next
  block's text, not a gutter, and revealed only around the last row (hover
  or caret, `aee-table-wrap--in-last-row`). They
  replaced the block menu's add buttons, and **deleting the table is now a
  gesture, not a menu item**: select every cell (shift-drag, or shift-arrows
  growing the cell selection) and press Backspace/Delete — deleting _all_ of
  a table's content is deleting the table; an empty husk is the one thing
  that selection didn't ask for. Anything less than the full grid falls
  through to the library's deleteCellSelection (clear contents). The gesture family covers every unit
  (2026-08-23): full-width rows delete those rows, full-height columns delete
  that column — anything less still falls through to clear-contents.
  Registered in the pre-`tableEditing` keymap plugin (the ArrowDown-escape
  trick), because the library claims Backspace/Delete first. **The block menu
  no longer opens for tables at all** — every operation lives on the table
  (pills, gestures, boundary/edge drags, the toolbar fill); the menu remains
  only for the columns block, which hasn't (yet) grown the same affordances.
  A cell selection also hides the text caret (`:has(.selectedCell)` +
  `caret-color`) — Chrome otherwise keeps blinking it at the hidden anchor
  inside the selected rectangle. Keyboard: rows keep an append path (Tab past
  the last cell), the delete gestures are fully keyboard-reachable
  (shift-arrows); **append-column currently has no keyboard route** — an
  accepted gap until the pills become focusable or a keybinding lands. Note for decoration
  writers: with the NodeView in place, node decorations (layout guides'
  `aee-guides-active`) land on the wrapper div, not the `<table>`.
  **Arrow keys are ours too (2026-08-23).** The library's cell navigation is
  dead for this schema: its `atEndOfCell` walks from `$head.depth - 1`
  expecting a paragraph _inside_ the cell, and our cells hold inline content
  directly — so it never finds a cell and arrows fell through to the
  browser (cells crossed by accident, Shift-arrows cell-selecting only when
  the native selection spilled over). And because our cells are textblocks,
  the gap cursor considered the slot _between two cells_ a valid stop. Both
  fixed in the pre-`tableEditing` keymap: an arrow at a cell's edge moves to
  the neighbouring cell (rows wrap, the outer edges hand off to surrounding
  blocks), a Shift-arrow there grows a cell selection (one cell per press,
  stays put at the table's edge), a plain arrow collapses one; and
  `allowGapCursor: false` on table and row keeps the gap cursor outside.
  Columns got the horizontal hop too (`columnArrow`), **and Tab
  (`columnTab`)**: unbound, Tab in a columns block fell through to the
  browser's own focus navigation and jumped clean out of the editor — into
  the source pane, in the example app — leaving the caret behind. It now
  walks the columns like a table's cells, hands off to the surrounding blocks
  at the ends (writing a paragraph when the block is last, as ArrowDown
  already does), and is _claimed for the whole block_ so focus can never be
  yanked away mid-edit. Outside a layout block Tab still escapes the editor
  normally, which is the accessible behaviour.
- **The block gutter (2026-08-23).** Both NodeView wrappers carry editor-only
  padding (`--aee-block-gutter-x/y`, 20px) — the ground the block's
  affordances stand on, so none of them hangs over the text around the block
  (the add-row pill used to cover the following line). It reserves room for
  the row/column action handles still to come. Two consequences worth
  knowing: (1) the geometry layer (`.aee-col-lines`) is CSS-inset to the
  wrapper's _content_ box, so every child percentage is a share of the block
  itself and the gutter can change without a number moving in the NodeView —
  table-relative shares are converted once, in `#toBoxPct`, and a drag
  measures `#contentBox()` rather than `clientWidth` (which counts padding).
  (2) **Wrapper and box are two elements, and that split is the point.** The
  wrapper carries only the editorial gutter; the box inside it carries the
  block's own area — for columns, the email's 600px container (and the
  `container-type` that answers "is this stacked?"). Collapsing the two, as
  the first attempt did, let editorial padding narrow the width the columns
  lay out in, which would have made the editor stack at a pane width where
  the recipient still sees them side by side. Separated, the gutter costs the
  layout nothing: at a 654px pane the box still measures exactly 600px.
- **Gap cursor for block escapes.** `prosemirror-gapcursor` gives every
  `isolating` block (table, columns) a real cursor position beside it, which is
  the mouse half of the escapes we had hand-rolled per node. It claims the
  arrow keys, and extension plugins run before extension keymaps, so a node
  that wants its own arrow behaviour must register that as a plugin keymap
  ahead of it (the table's ArrowDown does exactly this) and must sit earlier
  in the kit.
- New capability = new extension. If it needs UI, it exposes state through a
  callback and the app renders it (see bubble/slash menus, diagnostics).
- **One entry point per UI piece (2026-09-17).** The main entry,
  `angular-email-editor`, is the engine and its Angular glue (the editor,
  every extension, `InlineImages`). Each UI piece is a secondary entry of
  its own, Material-style — `angular-email-editor/address-chip`,
  `/address-input`, `/attachment-chip`, `/attachment-chips`,
  `/suggestion-menu` — a folder beside `src/` with its `ng-package.json`
  and `public-api.ts`. Smallest bundle and smallest install: an entry
  brings only its own peers (`@angular/forms` is optional — only the two
  form controls need it). Entries reach each other through the package
  name, never a relative path; specs resolve those names to the sources
  (`tsconfig.spec.json`), the app to `dist/`. A new UI piece, or a
  behaviour directive, starts as its own entry; the library never imports
  a UI kit — a framework that needs code gets an entry of its own
  (`/primeng`), after a recipe in the demo has shown it must.
  Behaviour directives so far (2026-09-17), each proven by the demo's own
  glue before it was written: `/focus` — `emailKeepFocus`, which replaced
  nine hand-written `mousedown` handlers; `/anchor` — `emailAnchor`, which
  replaced three copies of a fixed origin `<span>`. Generated bare with
  `ng g directive <name> --project angular-email-editor --path projects/angular-email-editor/<topic> --prefix email`.
  **Actions (2026-09-17).** An extension declares what it can do once, as
  `actions` (it was `suggestions`): id, title, icon, keywords, `command`,
  and — new — `isActive(state)` and `isEnabled(state)`, pure functions;
  `isEnabled` defaults to asking the command without a dispatch. The same
  list is a `/` menu's rows (`extensionSuggestions` is a view of
  `extensionActions`) and a toolbar's buttons: an _action_ is permanent and
  named, a _suggestion_ in the narrow sense is a source's answer to a
  moment; both end in the same row. Ids are kebab-case and are the contract
  with a host's translation files. `editor.actions` lists them;
  `editor.subscribe(listener)` tells of every state change and can be asked
  of an editor that already exists — it replaced the demo's `angularSync`
  extension. `/actions` is the Angular side: `injectActions`,
  `editorState`, `[emailAction]`. Host-only concerns stay the host's: order
  and grouping, responsive `wide`, labels shown (translated by id in the
  template), and items that open host UI (link, pickers) — to come in as
  `injectActions(editor, { host, override })`: a `HostAction` has a `run`,
  never a `command` — a command is _asked_ (called without a dispatch) on
  every transaction, and what opens a dialog must never be called to ask;
  `host` stands alone (the demo's Link), `override` exists only over a
  kit's action. The demo's toolbar reads every item by id (lists, indent,
  quote — now a toggle —, `align-left/center/right`, `clear-formatting`
  are actions in their extensions since 2026-09-17, under the same
  kebab-case ids the demo's layout now uses); its bubble menu is
  `[emailAction]` on Material buttons. Two rules that came out of it:
  `isEnabled` lives on the suggestion row, and a `/` menu leaves out a row
  whose explicit `isEnabled` says no (Clear formatting at a caret) but
  never asks a plain command; and **every extension command answers a dry
  run before it builds anything** — `editor.spec.ts` asks every action of
  every kit and checks nothing is dispatched, nothing sent. Not actions:
  undo/redo (a `/undo` row would undo its own trigger's deletion) and the
  demo's colour and table pickers (overlays with an "applied" state, the
  toolbar's own).
  **Translations and a writing assistant, in the demo (2026-09-18).** Built
  on the library as it was, to find where it pinches. Library changes it
  needed: a trigger's `i18n` may be a function of the item id, and its
  `label` and `placeholder` functions too — all asked afresh whenever a new
  session starts (one that starts somewhere else, also straight after one
  that found nothing), so a language switch reaches the rows, the search and
  the placeholders with nothing re-created. What `i18n` answers is _added_ to
  the item's own words: the menu searches English and the chosen language at
  once — and English alone in English, where `i18n` answers nothing. For
  scripts that write no spaces (Japanese, Chinese) a trigger that wants the
  start of a word opens after any such character, and a full-width space
  enters a group. The demo uses `@ngx-translate/core` with one lazily
  imported TypeScript module per language (`src/i18n/`: German, Japanese;
  readings like ふとじ are keywords, so the menu filters before an input
  method converts); English is what the code says — `I18n.t(key, fallback)` —
  so a spec that provides nothing reads English. The language picker is an
  Angular Aria menu of radio items (`language-menu`, over the app's one
  `toolbar-menu`). The assistant is **one action, not a level**: the demo's
  own extension `createAiWriter` declares `ai` — first in the kit, so first
  in the `/` menu — and streams the service's words in at the caret like
  someone typing: the place it writes at lives in plugin state and moves
  with the text, a marker shows it, the editor says `aria-busy`, Escape
  stops it mid-sentence, and the words undo as one. Nothing about AI is in
  the library. Still out of reach, the agenda for making this easier: an
  action cannot take an argument (`/ai shorter` — the command never sees
  its query), a list cannot be opened from a button or for a selection
  ("rewrite this"), a source is not told the editor state or its own range,
  rows cannot carry host data, and a source answers once (no streaming
  rows).
  **The assistant proposes, in the text (2026-09-25).** The answer no
  longer lands as it streams: it is _proposed_ — written into the message
  where it will stand, marked (`aee-proposal`, the accent colour), outside
  the undo history — and decided on from a panel floating under it.
  Library, opt-in and tree-shakeable: `createContentProposal()` +
  `proposeContent` / `acceptProposal` / `discardProposal` (the main entry,
  on the content stream, which gained `history: false` and `streamedRange`
  so a proposal follows the stream's range exactly); accept takes the same
  slice out and in again as one ordinary change — one undo — and discard
  leaves the document and its history as they were. Angular:
  `angular-email-editor/proposal` — `injectProposal(editor)` (active,
  streaming, range, the box to stand under, propose/stop/accept/discard)
  and two triggers for a host's own buttons, `[emailProposalAccept]` /
  `[emailProposalDiscard]`; and `angular-email-editor/chat-input` — the
  chat input, a ProseMirror editor with lines and bullet/numbered lists
  (Enter sends outside a list and goes on to the next item inside, Ctrl-
  Enter always sends, `- ` / `1. ` begin a list), its text carried out as
  dash lines. The demo's `chat-based-suggestion` is what a host writes
  around them: a bar docked above the formatting toolbar while the
  proposal stands (a panel chasing the proposal's last line moved too
  much) — above, on no surface, three dots that dance while the model
  thinks (`proposal.thinking`) and Discard / Apply as words; below, the
  chat input in a pill with a place for voice input and a send button.
  Only Escape or Discard let it go — Escape one thing at a time: a menu up
  over the text (`Popover.close()`, which asks the shown panel) closes
  first — a click in the text is editing, and Apply takes the proposal as
  it stands, the writer's edits with it; `AiRequest.instructions` carries
  the words (the stand-in understands "short", and thinks 1.2s first).
  Later the same day: one message at a time — the send button is a stop
  button while the model works, Enter is refused meanwhile, and Ctrl-Enter
  (⌘-Enter) with a proposal standing is Apply, heard before the editor's
  own send (a capture listener while the bar is up; swallowed while the
  model writes); Discard and Apply are small outlined buttons alike, the
  toolbar starts off. And a _part_: with a range of the proposal selected
  in the text, the ask writes that part again — `reviseProposal` in the
  library (the proposal's range maps through the stream instead of
  following it, never below the stream's end), `revise` and
  `selectedPart` on `injectProposal`, `AiRequest.selection` for the
  stand-in, which rewrites the part (short: its first sentence). Which also answers the first item of the
  agenda above, from the other side: the argument does not ride the `/`
  query, it has a field of its own. Found on the way: a stopped stream
  ended twice — at once on abort and again as `done` settled — and the
  second ending closed the range of the stream that had taken its place; a
  run now ends once. **From the template's side (2026-09-26):** the
  proposal is also a directive, `[emailProposal]="editor"` on the panel's
  element — it _is_ the `EditorProposal` (`#p="emailProposal"`, `p.active()`,
  `p.propose(…)`) and everything inside takes it by injection, so the
  triggers go bare (`<button emailProposalAccept>`; a bound value still
  wins, and neither is an error that says so). The keys are a directive
  too, `[emailProposalKeys]`: Ctrl-Enter (⌘-Enter) accepts while a
  proposal stands and is swallowed while it is written, `accepted` says so;
  Escape is handed to the host (`escape`, with the event), because what
  else is up is the host's to know — the demo closes a popover first. And
  the chat input is a behaviour first: `[emailChatInput]` mounts the field
  into the host's own element with no look of its own (`ChatInputField`),
  a `FormValueControl<string>` besides — `[formField]` drives `value` both
  ways, `disabled`/`readonly` in, `touch` on blur, `reset()` — and
  `<div email-chat-input>` is the same directive as a host directive in
  the styled box. The form holds the _message_; the ask stays `sent`, an
  action with a stream behind it is the host's, not the form's submit.

- **The cell's own menu (2026-09-26).** Notion's: a dot on the caret cell's
  right edge at rest, the six-dot handle under the pointer, and a press
  opens the cell's menu — Color (the palette's text colours and fills, as
  "Red text" / "Red background" rows with a swatch, plus default text and
  no background), Alignment (left, centre, right; top, middle, bottom) and
  Clear contents — the caret staying where it is. The grip is the
  table-handles extension's third kind (`kind: 'cell'`, with `row` and
  `index` the column), a selection-driven widget decoration keyed by the
  cell, so it moves with the caret and is never rebuilt while the cell is
  typed in. The menu is a component of its own (`CellMenu`) on Angular
  Aria's menu (`ngMenu`, `ngMenuItem` with `submenu`), not the band grips'
  paged panel: its lists are cascading submenus that open beside their row
  on hover or the right arrow, and the keys are the menu's while it is up —
  arrows walk it, Right and Enter open a list, Left closes one, typing
  jumps to a row, Escape leaves — and the pointer has macOS's grace on its
  way from a row to its list (`MenuSafeTriangle`, on the root menu: while
  the pointer stays inside the triangle from where it just was to the
  list's near edge, a hover on a row it crosses is stopped before Aria
  hears it; rest there and the hover is replayed after a moment). A list
  overlaps the menu's edge by a few pixels, Windows's way, its first row
  level with the row that opened it. So, unlike the band menus, it _takes_
  focus when it opens (onto its first row, one render after the popover
  shows it) and hands the caret back to the cell when it closes. No new
  library directive was needed for that: Aria's primitives carry the
  hover-open and keyboard behaviour, the app only styles and positions
  them. `clearCells` (the caret's cell, or every selected one) joins the
  table's commands; a text colour goes on all the cell's words through a
  selection the menu makes and puts back.

- **Sections: the full-width band (2026-09-26).** A `section` node — a
  fill running edge to edge across the reader's window with the content
  centred in the 600px column inside it, MJML's `mj-section` rendered our
  way. Rendered once, for every client: MJML renders a section twice (a
  div for the clients that read `max-width`, the same content again in a
  600px table inside an Outlook-only comment) because Outlook's Word
  engine ignores `max-width` and `inline-block`; Gmail drops every
  comment and its app strips the head for non-Google accounts, so what
  both keep is what the node emits — one `role="presentation"` table,
  100% wide, its one cell carrying the fill as `bgcolor` _and_ inline
  `background-color` with the paired text colour (`fillTextColor`), and
  inside it a div capped at 600px with auto margins; where the cap is
  ignored (Outlook) the content runs the band's full width, the graceful
  half of the columns block's own bargain. What cannot be said inline is
  left out. On parse a section is a one-cell presentation table whose cell
  holds nothing but elements and carries a fill or a padding — MJML's,
  with the fill on its wrapping div, as much as our own — a right-to-left
  cell handing its children over reversed; a one-cell table with words in
  it stays a table. `/section` inserts a band in the palette's quiet grey,
  the toolbar's colour button fills the band the caret is in, the block
  menu takes a band away with its content staying, the layout guides mark
  its edges. Read through the CSSOM where it expands a builder's
  `background:` shorthand, and through the attribute's own words where
  it does not.

- **A builder's export comes in whole (2026-09-26).** An MJML (or any
  builder's) document leans on two things the canonical email HTML never
  has, and the editor read neither: its `<style>` sheet — the mobile-first
  pattern, `width: 100%` inline and `width: 50% !important` in a `min-width`
  media query — and a one-cell `role="presentation"` wrapper table round
  every section, column and image, each of which parsed as a table of ours
  with its content hoisted out beside it: an empty grid, then the column
  block, again and again, the columns all one width. `parseHTML` now runs
  two passes before the schema (`import-html.ts`): `inlineStyles` folds the
  sheet into the elements it matches — document order, `!important` over
  inline, media queries answered for a 600px screen — and
  `unwrapLayoutTables` takes the builders' wrappers out (only theirs: the
  attributes they write, `cellpadding`/`cellspacing`/`border="0"`, and a
  cell holding nothing but elements — a table with words in its one cell
  stays a table, and so does every table of our own), a right-to-left cell
  handing its children over reversed, the way a client draws MJML's
  image-on-the-right sections. A column's `max-width` in percent is now a
  share of the budget, so two halves sit side by side exactly as two of
  ours. Not carried: a section's own background and padding (the model has
  no section), and MJML's button (a filled `<td>` round a `<p>`, not a
  link). In the editor besides: the layout guides linger 400ms before they
  fade, so a hand crossing a cell's edge never sees them blink; the caret's
  own row and column grips stay on screen while a cell is typed in (Tiptap's
  and Notion's way); the `/` menu's sections stand further apart; Send is
  sized through Material's button tokens (32px, 16px inline). Found on the
  way, and the reason the import first looked right and then went wrong
  the moment the source pane handed the formatted HTML back — two things.
  The source pane formats its text on blur, and `formatHTML` printed the
  body's children alone: a pasted document's head, its stylesheet with it,
  was gone by the time the composer read the text again, and the columns
  fell back to their default width. The formatter now prints a document's
  `<style>` elements first, the head's included, their CSS as written —
  formatting stays presentation-only, so what the parse read before it
  reads after. And an external `setContent` applies the new document as a
  minimal diff whose slice is open at both ends — where those ends stand
  at different depths ProseMirror _fits_ it instead of refusing, closing
  and reopening the nodes round the gap: a duplicated empty row, a column
  at its default width. The sync now checks the fitted result against the
  parsed document and falls back to replacing the whole document when
  they differ.

- **The `/` menu in sections, with colours and examples (2026-09-26).**
  Every suggestion row may declare a `section` — a stable id, worded by the
  trigger's `sections` (a map or a lookup, so a language switch reaches the
  headings) with the library's wording beneath (`suggestionSectionTitles`),
  read through `state.sectionTitle(id)`; the library's actions declare
  theirs (blocks, styling, media, layout, message), a host its own (the
  demo: ai, color, templates, examples), lists its rows in section order,
  and shows `[email-suggestion-menu-section]` where the section changes.
  Colours are rows too, the way a chat's slash menu lists them: "Red text",
  "Red background" — `colorSuggestions(ctx, palette)` in the new
  `angular-email-editor/palette` entry, each row a `swatch`, picked onto the
  selection or the caret's next words. The palette is a token there,
  `EMAIL_PALETTE`: the library's by default, an app's own through
  `providePalette`, either side or a function of the defaults to mix; the
  pickers read it too. The examples left the status strip for the menu:
  `/examples`, a plain local list of every example document (filtered and
  ranked like the kit's rows, no source, no loading), each put in the
  message's place by `replaceHTML`. The examples themselves are assets now —
  `public/examples/index.json` names the sets, a file per example beside it
  (a reply's inbound message as JSON, a template as HTML) — fetched once by
  the `Examples` service when the app starts; the template store lists the
  dialect sets from the same catalogue. In the app besides: Send is the
  word, first on the writer's bar, Discard last; Compose is a floating
  action button at a phone's lower right; the phone toolbar's buttons stand
  1px apart; and with the chat up, the field and the toolbar share one box
  on a wide screen, the dock's, painted behind them from under Discard and
  Apply.
  **Names are flat, as Angular's are** (`@angular/material/button`,
  `@angular/cdk/overlay`) — no `components/…` or `directives/…` segment:
  - one level, `angular-email-editor/<name>`; the only nesting is
    `<name>/testing`, for harnesses, the way Material and Aria do it;
  - a component entry is named for the thing (`address-input`), a
    directive entry for the behaviour it gives (`focus`, `anchor`,
    `keyboard`) — so the two never want the same name;
  - a directive entry is a _topic_ that ships its directives together, as
    `@angular/cdk/overlay` does — not one entry per directive: tree-shaking
    already drops the classes nobody uses, entries are for peers and chunks;
  - never a catch-all entry (`/components`, `/directives`): it would pool
    every piece's peers again;
  - kits stay in the main entry until the extensions themselves are
    entries — a kit entry alone would save nothing.

- **One suggestion menu, configured by its trigger (2026-09-15).** Every
  trigger-at-the-caret menu is `createSuggestionMenu({ trigger, … })`, the
  way Tiptap's Suggestion and Lexical's typeahead do it — and since
  2026-09-17 one call takes several:
  `createSuggestionMenu({ element, onChange, triggers: [{ trigger: '/', … }, { trigger: '{{', … }] })`. The
  triggers never open together, so they share one element and one stream of
  states (the state names its `trigger`, `label` and `listboxId`); a new
  one — `@`, `||`, any string — is one more entry, no new markup. There is no
  `createSlashMenu` / `createMergeTagMenu` any more (no compatibility kept,
  pre-release). What differs is options: `trigger`, `startOfWord` (default
  true; `{{` sets false), `query` (a RegExp the text after the trigger must
  match — `{{` narrows it to a path, `/^ ?[\w.]*$/`), `items` and `source`.
  A trigger right after its own first character never opens (`//`, `{{{`).
  Items are one shape for every menu:
  `{ id, title, keywords?, detail?, icon?, command }` — what picking does is the item's `command`
  (`insertMergeTag(path)`, `insertHTML(html)`, a kit command), run after the
  trigger and query are deleted. Extensions offer theirs as `suggestions`;
  `extensionSuggestions(ctx)` gathers them for a `/` menu.
  - **Search grows over time.** `items` (a list, or a function of the
    extensions) are filtered and ranked **title-first** (exact > prefix >
    includes > keyword-only, given order as tiebreak — "/columns" must
    highlight Columns, not the table whose keywords include it). `source` is
    the dynamic side:
    `{ query, cursor, signal } → items | { items, nextCursor }`, sync or async, appended unfiltered (the source owns its
    matching). `debounce` (default 300ms, 0 = at once) holds a new query's
    request, never a page's. A
    newer query, a dismissal or a destroyed editor **aborts** what is out
    (`signal`) and drops its answer; a failed answer is `error` in the state,
    and the menu stays open to say so.
  - **Two levels, and the document is the only state.** A `SuggestionGroup`
    (`children` instead of `command`: a list, or a source) is entered by
    rewriting the query to `<word> ` — its title lowercased, spaces as
    hyphens. `<trigger><word> <rest>` whose word names a group (title, id or
    keyword) _is_ level 2, so Backspace over the space, undo and a pasted
    query all land right. Two levels by type: a group's children are
    `SuggestionCommandItem`s. Level 2 stays open with no matches ("No
    results") and keeps Enter/Tab/arrows. Every item has a stable `id`;
    `i18n` (by id) replaces a title and adds keywords — the original title
    and keywords stay searchable, and both words enter a group.
  - **One at a time.** Menus on one editor register with each other; where
    sessions overlap (`/templates zz{{`) the trigger nearest the caret opens
    and owns the keys, and the outer one comes back once the inner session is
    gone. ARIA attributes on the editor are only ever cleared by the menu
    that set them.
  - The editor is the combobox: while open it carries `aria-controls`,
    `aria-autocomplete="list"` and `aria-activedescendant`, written on the
    element directly (ProseMirror only patches attributes it was given).
    Rows are `role=option`, never focusable.
  - **Paging.** The state carries `hasMore` / `loadingMore` / `loadMore()`.
    Keyboard: arrows stop at the ends and emit nothing there — except
    ArrowDown on the last row with more pages, which fetches once however long
    it is held and steps onto the new first row when it lands. Pointer: the
    component watches an end marker inside the listbox with an
    IntersectionObserver (root = listbox, 64px ahead), armed only while a page
    can load — no scroll listener, and a page too short to fill the box asks
    for the next at once. The demo backs `/templates` (12 a page) and `{{`
    (20 a page) with the app's `Templates` and `MergeTags` services, both
    `find(filter, { signal })` on one LoopBack 3 filter mock
    (`loopback-filter.ts`: `like`/`ilike`/`inq`/`and`/`or`, `order` with
    German, numeric collation, `skip`/`limit`, backslash-escaped wildcards,
    AbortError on cancel).
  - **DOM economy (measured 2026-09-15, in the composer).** The engine never
    writes to the menu element: it hands the renderer `range` and a lazy
    `clientRect()`, and `email-suggestion-menu` places itself in its own
    render phases (`measureMenuPlacement` in earlyRead, left/top/visibility in
    write) after its rows are in, re-measuring only when rows, level, query
    or status change — an arrow press measures nothing. A new query keeps the
    previous rows on screen as `stale` (listbox `data-stale`, dimmed;
    `aria-busy`) until the answer replaces them, so the list is diffed by id
    instead of rebuilt: typing that narrows 20 rows to 1 went from ~80 node
    mutations to 21, an unchanged result set from 82 to 2. Enter/Tab wait on a
    stale row rather than applying the last query's pick. Editor aria-*
    attributes are written only when their value changes (an arrow press:
    3 writes → 1); a transaction that leaves the session as it was emits
    nothing; rows find their index from one per-state map, not `indexOf`.
    App side: the preview (`active` input, a linkedSignal holding the last
    shown html) and the source pane (`active`; hidden it lints the text with
    `lintHTML(formatHTML(html))` so the status strip stays live) no longer
    touch the DOM per keystroke while hidden, and catch up when shown.
  - **No virtualization (decided 2026-09-15).** Paged search keeps the DOM to
    a few pages of rows; virtual scrolling would unrender the option
    `aria-activedescendant` points at and fight the host-rendered
    `@for` rows. Revisit only if a list really holds hundreds of loaded
    rows — then CDK's fixed-size virtual scroll, not our own.
  - [ ] Phone: a full-height sheet for the menu (Slack-style). Typing still
        goes into the covered editor, so the sheet must echo the query and
        the extension needs a mode that skips its own positioning.
- Anything both panes must agree on lives in the **email schema**, never in
  either pane. The source pane consumes it via `createSourceMarks`-style
  round-trips.
- The library ships behavior, the app ships pixels. Token classes
  (`aee-tok-*`, `aee-lint-*`) are the styling contract — and the editable
  root always carries **`aee-editor`**, stamped by `createEditor` itself.
  Global styles scope to `.aee-editor`, never to bare `.ProseMirror`: a host
  app may run other ProseMirror instances, and our CSS must never reach them.
- The app consumes the library from `dist/` — rebuild it (`ng build
angular-email-editor`) or run `npm run watch`; if changes "don't arrive",
  clear `.angular/cache` (stale Vite prebundle).
- **Canonical serialized styles must use longhand properties and `rgb()`
  colours only — never CSS shorthands or hex.** Serialization round-trips
  through the CSSOM (`DOMSerializer` builds real elements, we read
  `innerHTML`), which re-serializes shorthands non-deterministically — and
  jsdom even _orders_ them differently from Chrome, so a shorthand breaks
  canonical stability _and_ makes tests disagree with the runtime. Longhands
  in written order and `rgb(r, g, b)` colours are stable everywhere. This
  gates every future block's styling (the M5 columns table especially). The
  golden suite exists to catch violations.
