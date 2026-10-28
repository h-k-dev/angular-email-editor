/**
 * How a host uses an export, by the export's id (`ApiEntry.id`) — copied
 * from what the demo app does and checked against the library's
 * signatures. Kept apart from the prose so each reads as code.
 */
export const API_EXAMPLES: Readonly<Record<string, string>> = {
  'create-editor': `import { signal } from '@angular/core';
import { createEditor, emailExtensions } from '@h-k-dev/angular-email-editor';

const html = signal('');
const editor = createEditor({
  parent: document.querySelector<HTMLElement>('#body')!,
  extensions: emailExtensions,
  content: '<div>Hi {{ contact.firstName }},</div>',
  attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Message body' },
  onUpdate: (editor) => html.set(editor.getHTML()),
});

// When the host goes away:
editor.destroy();`,

  'editor-type': `import { Editor } from '@h-k-dev/angular-email-editor';

declare const editor: Editor;

editor.commands['toggleBold']();          // runs now, returns whether it applied
editor.commands['setHeading'](2);
const bold = editor.isActive('bold');

editor.setContent('<div>Replaced</div>'); // a minimal diff: no undo step, no onUpdate
const quoted = editor.getQuoted();        // the reply / forward history, or null
editor.setQuoted(null);                   // drop it`,

  'create-bubble-menu': `import { signal } from '@angular/core';
import {
  BubbleMenuState, createBubbleMenu, createEditor, emailExtensions,
} from '@h-k-dev/angular-email-editor';

const bubble = signal<BubbleMenuState>({ isOpen: false, boundingBox: null });

const editor = createEditor({
  parent: host,
  extensions: [
    ...emailExtensions,
    createBubbleMenu({
      onStateChange: (state) => bubble.set(state),
      anchor: 'selection', // default 'first'
      scroll: 'follow',    // 'close' (default) | 'follow' | 'keep' | (event, menu) => void
    }),
  ],
});`,

  'create-block-marquee': `import { createBlockMarquee, createEditor, emailExtensions } from '@h-k-dev/angular-email-editor';

const editor = createEditor({
  parent: paper,
  extensions: [
    ...emailExtensions,
    createBlockMarquee({
      surface: (view) => view.dom.parentElement!, // where a press may start the box (the default)
      canvas: () => composeWindow,                // where the box is drawn: give it a CSS position
      threshold: 4,                               // px before a press becomes a box
    }),
  ],
});`,

  'create-suggestion-menu': `import { signal } from '@angular/core';
import {
  SuggestionMenuState, createEditor, createSuggestionMenu, emailExtensions,
  extensionSuggestions, mergeTagTrigger,
} from '@h-k-dev/angular-email-editor';

const suggestion = signal<SuggestionMenuState | undefined>(undefined);

const editor = createEditor({
  parent: host,
  extensions: [
    ...emailExtensions,
    createSuggestionMenu({
      element: menuElement, // the host renders the rows into it from the state
      onChange: (state) => suggestion.set(state),
      triggers: [
        { trigger: '/', label: 'Insert block', items: extensionSuggestions },
        mergeTagTrigger({ label: 'Personalization tokens', source: mergeTagSource }),
      ],
    }),
  ],
});`,

  'merge-tag-trigger': `import { createSuggestionMenu, mergeTagTrigger } from '@h-k-dev/angular-email-editor';

createSuggestionMenu({
  element: menuElement,
  onChange: (state) => suggestion.set(state),
  triggers: [
    mergeTagTrigger({
      // Asked each time the menu opens, so a language switch reaches it.
      label: () => translate.instant('tokens.label'),
      placeholder: () => translate.instant('tokens.placeholder'),
      source: mergeTagSource, // or items: [...]
    }),
  ],
});`,

  'paged-source': `import { SuggestionSource, insertMergeTag, pagedSource } from '@h-k-dev/angular-email-editor';

// api.find(filter: { q: string; skip: number; limit: number }, signal: AbortSignal)
//   => Promise<{ path: string; label: string }[]>
export function createMergeTagSource(api: MergeTagApi): SuggestionSource {
  return pagedSource({
    from: api,
    with: (query, { skip, limit }) => ({ q: query.trim(), skip, limit }),
    map: (row) => ({
      id: row.path,
      title: row.label,
      detail: '{{ ' + row.path + ' }}',
      command: insertMergeTag(row.path),
    }),
    pageSize: 20, // also: debounce (300), cache ({ ttl: 60_000, max: 50 } | false)
  });
}`,

  'list-source': `import { SuggestionGroup, insertMergeTag, listSource } from '@h-k-dev/angular-email-editor';

// customFields.find(filter: { where: { groupId: string } }, signal) => Promise<Field[]>
const contactFields: SuggestionGroup = {
  id: 'contact',
  title: 'Contact',
  placeholder: 'Search contact fields…',
  children: listSource({
    from: customFields,
    with: () => ({ where: { groupId: 'contact' } }), // no query: the menu searches the list
    map: (field) =>
      field.tokenable
        ? { id: field.key, title: field.label, command: insertMergeTag(field.key) }
        : null,
  }),
};`,

  'create-placeholder': `import {
  PlaceholderWords, createEditor, createPlaceholder, emailExtensions,
} from '@h-k-dev/angular-email-editor';

const words: PlaceholderWords = {
  line: "Type '/' for commands",
  empty: 'Write your message…',
  heading: ['Heading 1', 'Heading 2', 'Heading 3'],
};

const editor = createEditor({
  parent: host,
  extensions: [...emailExtensions, createPlaceholder({ text: words, show: 'caret' })],
});

// On a language switch:
editor.commands['setPlaceholder']({ line: "Tippe '/' für Befehle" });`,

  'create-content-stream': `import {
  createContentStream, createEditor, emailExtensions, streamContent,
} from '@h-k-dev/angular-email-editor';

const editor = createEditor({
  parent: host,
  extensions: [...emailExtensions, createContentStream({ reveal: 'block' })],
});

const run = streamContent(
  editor.view,
  editor.state.selection.from, // or a { from, to } range the first piece replaces
  async ({ getWritableStream, signal }) => {
    const response = await fetch('/api/draft', { method: 'POST', body: prompt, signal });
    await response.body!.pipeTo(getWritableStream());
  },
  { format: 'html' },
);
const finished = await run.done; // false when stopped (Escape, or run.stop())`,

  'parse-html': `import {
  createSchema, emailExtensions, parseHTML, serializeToHTML,
} from '@h-k-dev/angular-email-editor';

const schema = createSchema(emailExtensions);
const doc = parseHTML(rawHtml, schema, { mode: 'email' }); // 'repair' (default) | 'email' | 'preserve'
const canonical = serializeToHTML(doc, schema);`,

  'email-document': `import { emailDocument } from '@h-k-dev/angular-email-editor';

const document = emailDocument(intent.html, {
  title: subject,
  previewText: 'Your order has shipped',
  lang: 'en',
});`,

  'render-for-client': `import { RenderingClient, renderForClient } from '@h-k-dev/angular-email-editor';

const client: RenderingClient = 'gmail'; // 'apple-mail' | 'gmail' | 'outlook-desktop'

iframe.setAttribute('sandbox', '');
iframe.srcdoc = renderForClient(editor.getHTML(), client, { dark: true, pane: 'phone' });`,

  'lint-html': `import { lintHTML } from '@h-k-dev/angular-email-editor';

// (source, scan = scanHTML(source), options)
const diagnostics = lintHTML(source, undefined, { mode: 'email' });

for (const { from, to, severity, message } of diagnostics) {
  console.warn(severity, from, to, message);
}`,

  'to-inbound-message': `import { importedDocument, toInboundMessage } from '@h-k-dev/angular-email-editor';

async function openEml(file: File): Promise<string> {
  const { default: PostalMime } = await import('postal-mime'); // costs nothing until used
  const parsed = await PostalMime.parse(file);
  const inbound = toInboundMessage(parsed); // optional: { addressRules }
  return importedDocument(inbound);         // or replyDocument(inbound) to answer it
}`,

  'reply-quote': `import { createEditor, emailExtensions, replyQuote } from '@h-k-dev/angular-email-editor';

const editor = createEditor({
  parent: host,
  extensions: emailExtensions, // includes QuotedHistory
  content: '<div><br></div>',
  quoted: replyQuote(inbound, { locale: 'de-DE' }),
  onUpdate: (e) => {
    body.set(e.getHTML()); // the body only: the history is kept beside it
    quoted.set(e.getQuoted());
  },
});`,

  'reply-envelope': `import {
  type ReplyKind, forwardQuote, replyEnvelope, replyQuote,
} from '@h-k-dev/angular-email-editor';

const kind: ReplyKind = 'reply-all'; // 'reply' | 'reply-all' | 'forward'
const seed = { locale: 'en-GB', self: 'me@example.com' };

const { to, cc, subject } = replyEnvelope(inbound, kind, seed);
const quoted = kind === 'forward' ? forwardQuote(inbound, seed) : replyQuote(inbound, seed);`,

  'provide-address-rules': `import { ApplicationConfig } from '@angular/core';
import { provideAddressRules } from '@h-k-dev/angular-email-editor/address';

export const appConfig: ApplicationConfig = {
  providers: [
    // The parts you give replace ours; the rest stay ours.
    provideAddressRules({
      isValid: (address) => myValidator(address),
      isPlaceholder: () => false, // {{…}} addresses count as invalid
    }),
  ],
};`,

  'address-list': `import { Component, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { AddressInput, addressList } from '@h-k-dev/angular-email-editor/address-input';

@Component({
  selector: 'app-envelope',
  imports: [AddressInput, FormField],
  template: \`<div email-address-input [formField]="envelope.to"></div>\`,
})
export class Envelope {
  readonly model = signal({ from: [] as string[], to: [] as string[], cc: [] as string[] });
  readonly envelope = form(this.model, (p) => {
    addressList(p.from, { max: 1 });
    addressList(p.to);
    addressList(p.cc, { min: 0 });
  });
}`,

  'create-merge-tag-resolution': `import {
  createEditor, createMergeTagResolution, emailExtensions,
} from '@h-k-dev/angular-email-editor';

const editor = createEditor({
  parent: host,
  extensions: [
    ...emailExtensions,
    createMergeTagResolution({
      // Raw expressions in; values back in the same order
      // (a string fills, '' removes the token, null keeps it).
      resolve: (expressions) => api.evaluate(expressions, contactId),
      onResolved: ({ filled, empty, kept }) => notify(filled, empty.length, kept.length),
      onPendingChange: (pending) => busy.set(pending),
    }),
  ],
});

editor.commands['resolveMergeTags'](); // also Mod-Shift-Enter`,

  'create-send-intent': `import {
  SendIntent, createEditor, createSendIntent, emailExtensions,
} from '@h-k-dev/angular-email-editor';

const editor = createEditor({
  parent: host,
  extensions: [
    ...emailExtensions,
    createSendIntent({
      onSend: ({ html, text, inlineImages, requiredFields }: SendIntent) =>
        transport.send({ html, text, inlineImages, requiredFields }),
    }),
  ],
});

editor.commands['requestSend'](); // also Mod-Enter, or /send`,

  'inline-images-service': `import { Component, ElementRef, afterNextRender, inject, viewChild } from '@angular/core';
import {
  InlineImages, createEditor, createInlineImages, emailExtensions,
} from '@h-k-dev/angular-email-editor';

@Component({
  selector: 'app-composer',
  template: '<div #body></div>',
  providers: [InlineImages], // one per composer, never in root
})
export class Composer {
  readonly images = inject(InlineImages);
  readonly body = viewChild.required<ElementRef<HTMLElement>>('body');

  constructor() {
    afterNextRender(() =>
      createEditor({
        parent: this.body().nativeElement,
        extensions: [...emailExtensions, createInlineImages({ registry: this.images })],
      }),
    );
  }
}`,

  'email-size-budget': `import { computed } from '@angular/core';
import { emailSizeBudget } from '@h-k-dev/angular-email-editor';

// { bytes, limit: 104448 (Gmail's 102 KB clip), level: 'ok' | 'warning' | 'error' }
const budget = computed(() => emailSizeBudget(html()));
const clipped = computed(() => budget().level === 'error');`,

  'email-palette': `import { ApplicationConfig } from '@angular/core';
import { providePalette } from '@h-k-dev/angular-email-editor/palette';

export const appConfig: ApplicationConfig = {
  providers: [
    providePalette((defaults) => ({
      text: [...defaults.text, { name: 'Brand', value: '#0a5c36' }],
    })),
  ],
};`,

  'create-text-metrics': `import { signal } from '@angular/core';
import { createEditor, emailExtensions } from '@h-k-dev/angular-email-editor';
import { TextMetrics, createTextMetrics } from '@h-k-dev/angular-email-editor/metrics';

// { words, characters, lines, estimatedHeight }
const metrics = signal<TextMetrics | null>(null);

const editor = createEditor({
  parent: host,
  extensions: [
    ...emailExtensions,
    createTextMetrics({ onMetrics: (m) => metrics.set(m), onError: (e) => console.warn(e) }),
  ],
});`,

  'email-keep-focus': `import { Component } from '@angular/core';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';

@Component({
  selector: 'app-toolbar',
  imports: [KeepFocus],
  template: \`
    <div role="toolbar" emailKeepFocus>
      <button type="button" (click)="bold()">B</button>
      <!-- text entry still takes focus: the default exception -->
      <input aria-label="Font size" />
    </div>
  \`,
})
export class Toolbar {
  bold() {}
}`,

  'inject-actions': `import { Component, input } from '@angular/core';
import { Editor } from '@h-k-dev/angular-email-editor';
import { ActionTrigger, injectActions } from '@h-k-dev/angular-email-editor/actions';

@Component({
  selector: 'app-format-bar',
  imports: [ActionTrigger],
  template: \`
    <button emailAction="bold" [emailActionFrom]="actions" #bold="emailAction"
            [class.on]="bold.pressed()">B</button>
    <button emailAction="link" [emailActionFrom]="actions">Link</button>
  \`,
})
export class FormatBar {
  readonly editor = input<Editor>();
  protected readonly actions = injectActions(() => this.editor(), {
    host: [{ id: 'link', run: () => this.openLinkDialog() }],
  });

  openLinkDialog() {}
}`,

  'email-editor': `import { Component, computed, signal, viewChild } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { emailExtensions } from '@h-k-dev/angular-email-editor';
import { EmailEditor } from '@h-k-dev/angular-email-editor/editor';

@Component({
  selector: 'app-template-editor',
  imports: [EmailEditor, FormField],
  template: \`
    <div [emailEditor]="kit" [formField]="fields.body" #body="emailEditor"></div>
    <button [disabled]="!dirty()" (click)="body.replace(body.baseline()!)">Revert</button>
  \`,
})
export class TemplateEditor {
  protected readonly kit = emailExtensions;
  protected readonly fields = form(signal({ body: '<p>Hello {{ contact.firstName }},</p>' }));

  private readonly body = viewChild.required(EmailEditor);
  /** Changed since it opened — never a false alarm: the baseline is the
      canonical form the editor published, not the HTML as stored. */
  protected readonly dirty = computed(() => {
    const baseline = this.body().baseline();
    return baseline !== null && this.fields.body().value() !== baseline;
  });
}`,

  'editor-model': `import { Component, input } from '@angular/core';
import { FormField, debounce, form, max, min } from '@angular/forms/signals';
import { Editor, SECTION_PADDING_MAX } from '@h-k-dev/angular-email-editor';
import { sectionPaddingModel } from '@h-k-dev/angular-email-editor/actions';
import { FieldKeys } from '@h-k-dev/angular-email-editor/keyboard';

@Component({
  selector: 'app-band-padding',
  imports: [FormField, FieldKeys],
  template: \`
    <input type="number" step="4" [formField]="padding.top" emailFieldKeys />
    <input type="number" step="4" [formField]="padding.bottom" emailFieldKeys />
    <input type="number" step="4" [formField]="padding.inline" emailFieldKeys />
  \`,
})
export class BandPadding {
  readonly editor = input<Editor>();
  /** The caret's band, its room — each field written once it is done with,
      one undo step, shown as the band took it (on the 4px grid). */
  protected readonly padding = form(sectionPaddingModel(() => this.editor()), (room) => {
    for (const side of [room.top, room.bottom, room.inline]) {
      min(side, 0);
      max(side, SECTION_PADDING_MAX);
      debounce(side, 'blur');
    }
  });
}`,

  'email-field-keys': `import { Component, output, signal } from '@angular/core';
import { Menu, MenuItem } from '@angular/aria/menu';
import { FormField, debounce, form } from '@angular/forms/signals';
import { FieldKeys } from '@h-k-dev/angular-email-editor/keyboard';

@Component({
  selector: 'app-size-menu',
  imports: [Menu, MenuItem, FormField, FieldKeys],
  template: \`
    <div ngMenu>
      <div ngMenuItem value="reset">Reset</div>
      <!-- Digits stay in the field, never the menu's typeahead; Enter
           commits and closes, Escape puts it back and closes. -->
      <input
        type="number"
        [formField]="size.px"
        emailFieldKeys
        (emailFieldKeysCommitted)="closed.emit()"
        (emailFieldKeysDismissed)="closed.emit()"
      />
    </div>
  \`,
})
export class SizeMenu {
  readonly closed = output<void>();
  protected readonly size = form(signal({ px: 14 }), (size) => debounce(size.px, 'blur'));
}`,

  'email-anchor':`import { Component, signal } from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';
import { BubbleMenuState } from '@h-k-dev/angular-email-editor';
import { Anchor } from '@h-k-dev/angular-email-editor/anchor';

@Component({
  selector: 'app-bubble',
  imports: [Anchor, OverlayModule],
  template: \`
    <span [emailAnchor]="state().boundingBox" cdkOverlayOrigin #origin="cdkOverlayOrigin"></span>
    <ng-template cdkConnectedOverlay
                 [cdkConnectedOverlayOrigin]="origin"
                 [cdkConnectedOverlayOpen]="state().isOpen">
      <div role="toolbar">…</div>
    </ng-template>
  \`,
})
export class Bubble {
  readonly state = signal<BubbleMenuState>({ isOpen: false, boundingBox: null });
}`,
};
