# Angular Email Editor

[![npm version](https://img.shields.io/npm/v/@h-k-dev/angular-email-editor.svg)](https://www.npmjs.com/package/@h-k-dev/angular-email-editor)
[![license](https://img.shields.io/npm/l/@h-k-dev/angular-email-editor.svg)](https://github.com/h-k-dev/angular-email-editor/blob/main/LICENSE)

An email editor for Angular, built on [ProseMirror](https://prosemirror.net): a visual
composer and an HTML source editor over **one schema that is the vocabulary of email
HTML** — what Gmail, Outlook and Apple Mail apply survives, nothing else is emitted.
Headless where it can be: you own the markup and the pixels; the library brings the
engine, the behaviour and accessible building blocks.

**[Try the live demo →](https://h-k-dev.github.io/angular-email-editor/)**

> **Pre-1.0.** The API still moves between `0.x` versions; releases are deliberate, not
> per commit. Pin a version and read the release notes before upgrading.

## What you get

- **Email-safe by construction** — markup is parsed into the email vocabulary and
  re-emitted deterministically: inline styles, `<div>` lines, tables that render in
  Outlook. Builder exports (MJML) keep their structure; pasted Word/Docs markup is cleaned.
- **Corrects what other editors stored** — opening HTML saved by WYSIWYG editors such as
  Summernote repairs `mailto://` links, `http://{{placeholder}}` links, Word's `<o:p>`,
  Bootstrap-only table borders and formatting wrapped around block lines, without losing
  the author's intent.
- **Two editors, one document** — the visual composer and an HTML source pane
  (highlighting, lint, formatter) run the same commands over the same schema.
- **Placeholders** — `{{ expression }}` tokens as merge-tag pills, an optional AngularJS
  expression dialect with live syntax diagnostics, and **placeholder filling**
  (`createMergeTagResolution`, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>):
  your evaluator gets each expression raw, the values go back in as text, in one undo step.
- **Compose workflow** — reply/forward seeds with localized labels, quoted history kept
  beside the body, inline images (`cid:`), a send intent with `text/plain` alternative.
- **Address fields that implement the RFCs** — RFC 5322/5321/6531 parsing and
  formatting behind a pluggable rule, chips, signal-forms validation, placeholders as
  pending (not invalid) addresses, and an Angular Material form-field adapter.
- **Attachment chips** with upload stages (Uppy/tus vocabulary) and progress.

## Installation

```bash
npm install @h-k-dev/angular-email-editor prosemirror-commands prosemirror-gapcursor prosemirror-history prosemirror-inputrules prosemirror-keymap prosemirror-model prosemirror-schema-list prosemirror-state prosemirror-tables prosemirror-transform prosemirror-view
```

Requires Angular `22`. The ProseMirror packages are peers so your app holds exactly one
copy of each.

| Optional peer | Needed for |
| --- | --- |
| `@angular/forms` | `/address-input`, `/attachment-chips`, `/toggle-button-group` (signal-forms controls) |
| `@angular/material`, `rxjs` | `/material` (the `mat-form-field` adapter) |
| `@chenglou/pretext` `^1.0.0` | `/metrics` (word, line and height metrics) |

## Quick start

```ts
import { Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Editor, createEditor, emailExtensions } from '@h-k-dev/angular-email-editor';

@Component({
  selector: 'app-mail-body',
  template: `<div #host></div>`,
})
export class MailBody {
  readonly html = signal('<div>Hello</div>');
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  #editor?: Editor;

  constructor() {
    afterNextRender(() => {
      this.#editor = createEditor({
        parent: this.host().nativeElement,
        extensions: emailExtensions,
        content: this.html(),
        onUpdate: (editor) => this.html.set(editor.getHTML()),
      });
    });
    inject(DestroyRef).onDestroy(() => this.#editor?.destroy());
  }
}
```

`emailExtensions` is the full email kit; add extensions next to it (`createSendIntent`,
`createMergeTagResolution`, `createSuggestionMenu`, …) or build a kit of your own.

## Entry points

Every UI piece is its own secondary entry point, so you only bundle what you import.

| Import | What it is |
| --- | --- |
| `@h-k-dev/angular-email-editor` | The engine: `createEditor`, kits, schema, HTML parse/serialize, extensions |
| `…/actions` | Editor actions as signals — `injectActions`, `[emailAction]` for your own buttons |
| `…/address` | The address rule (RFC 5322/5321/6531): parse, format, split, join, `ADDRESS_RULES` |
| `…/address-input` | The address field: chips, `FormValueControl<string[]>`, `addressList` validator |
| `…/address-chip` | One address chip |
| `…/attachment-chips` | The attachment strip, a `FormValueControl` over the list |
| `…/attachment-chip` | One attachment chip with upload stages and progress |
| `…/toggle-button-group` | `<hk-tgb>` with `hkTgbIcon` (round) and `hkTgbText` (pill) items on any element, a sliding thumb, a `FormValueControl` |
| `…/suggestion-menu` | The `/` and `{{` menus' floating box, with roles and ids |
| `…/palette` | The colour palette (readable on light and dark) |
| `…/proposal` | A streamed proposal's state for your panel (accept / discard) |
| `…/chat-input` | A chat-style prompt input on the same engine |
| `…/image` | `[emailImageAlt]` — your text field as the selected image's alt text |
| `…/anchor` | `[emailAnchor]` — position an overlay at a rect |
| `…/focus` | `[emailKeepFocus]` — controls that keep the caret in the editor |
| `…/material` | `[emailMatFormField]` — an address input inside `mat-form-field` |
| `…/metrics` | Live text metrics (`createTextMetrics`), measured without DOM reads |

## Styling

The components theme through a token cascade: their own `--email-*` tokens first, then
Material's `--mat-sys-*` system tokens, then a built-in light/dark fallback — a Material 3
app is themed out of the box.

The editable surface is yours to style; it carries the `aee-editor` class. Include
ProseMirror's required CSS (`prosemirror-view/style/prosemirror.css`, and
`prosemirror-tables/style/tables.css` for tables). The shared scrollbar look is a Sass mixin:

```scss
@use '@h-k-dev/angular-email-editor/styles/scroll';
```

The [demo app](https://github.com/h-k-dev/angular-email-editor/tree/main/projects/app) is
the reference composer — toolbar, menus, compose windows — built only on this public API.

## License

[MIT](https://github.com/h-k-dev/angular-email-editor/blob/main/LICENSE)
