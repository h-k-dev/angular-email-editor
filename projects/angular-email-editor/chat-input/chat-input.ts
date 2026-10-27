import { Component, Directive, inject, input, output } from '@angular/core';
import { Command, Plugin, PluginKey } from 'prosemirror-state';
import { Node as ProseMirrorNode } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import {
  BaseKeymap,
  BulletList,
  Document,
  Extension,
  HardBreak,
  History,
  ListItem,
  NoTextDrag,
  OrderedList,
  Paragraph,
  Text,
  defineExtension,
} from '@h-k-dev/angular-email-editor';
import { EditorCodec, EmailEditor } from '@h-k-dev/angular-email-editor/editor';
import { followTextHeight } from './chat-input.animation';

/** The text as it is sent: a line per block, a list item as a dash line —
    the writer's points, kept as points. */
export function chatInputText(doc: ProseMirrorNode): string {
  const lines: string[] = [];
  doc.descendants((node, _pos, parent) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, '\n', ' ').trim();
    if (text) lines.push(parent?.type.name === 'listItem' ? `- ${text}` : text);
    return false;
  });
  return lines.join('\n');
}

/** The chat text as the field's HTML: dash lines become list items again. */
function chatInputHTML(text: string): string {
  let html = '';
  let inList = false;
  for (const line of text.split('\n')) {
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!inList) html += '<ul>';
      html += `<li>${escapeHtml(item[1])}</li>`;
      inList = true;
    } else {
      if (inList) html += '</ul>';
      inList = false;
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

/** The value is the text as sent (`chatInputText`); what is shown of a
    value stands as given — no text written in is sent back reworded. */
const CHAT_CODEC: EditorCodec = {
  read: (editor) => chatInputText(editor.state.doc),
  write: (editor, text, options) => editor.setContent(chatInputHTML(text), options),
  canonical: false,
};

/** Says what the field is for while it is empty: a class and the words on
    its one paragraph, for the stylesheet (`data-placeholder`). */
const placeholder = (text: () => string): Extension =>
  defineExtension({
    name: 'chatInputPlaceholder',
    plugins: () => [
      new Plugin({
        key: new PluginKey('chatInputPlaceholder'),
        props: {
          decorations: (state) => {
            const { doc } = state;
            const first = doc.firstChild;
            const empty = doc.childCount === 1 && !!first?.isTextblock && first.content.size === 0;
            if (!empty || !text()) return null;
            return DecorationSet.create(doc, [
              Decoration.node(0, first!.nodeSize, {
                class: 'email-chat-input__empty',
                'data-placeholder': text(),
              }),
            ]);
          },
        },
      }),
    ],
  });

/**
 * The behaviour of a chat input, on an element of the host's own: a field
 * to ask an assistant with, the way a chat's message box works — Enter
 * sends, Shift-Enter breaks the line — that also takes **lists**, so a list
 * of points reaches the assistant as points: `- ` or `1. ` at a line's
 * start begins one, Enter goes on to the next item, Enter on an empty item
 * leaves the list, Tab and Shift-Tab nest and lift. Ctrl-Enter sends from
 * anywhere, a list included. Nothing else: no headings, no bold — an
 * assistant reads words. No look of its own: the host's element, the
 * host's styles (`ChatInput` is the styled one).
 *
 *     <div emailChatInput placeholder="Tell the assistant what to change…"
 *          [(value)]="instructions" (sent)="ask($event)" (escaped)="close()"></div>
 *
 * `value` is the text as it is sent — a line per block, list items as
 * dash lines (`chatInputText`) — two-way: set it and the field shows it
 * (a dash line becomes an item again). `sent` carries the same text;
 * `clear()` empties the field, `focus()` puts the caret in it. A
 * ProseMirror editor is mounted inside the element (the library's own,
 * `.aee-editor`), so a host's editor styles reach it — by `EmailEditor`
 * (`/editor`), worn as a host directive: a value written from outside
 * waits while the field is typed in, as in every editor of the library.
 *
 * **A signal-forms control, optionally.** It is a `FormValueControl` for
 * `string`: bind a field with `[formField]="chat.message"` and the
 * directive drives `value` both ways, pushes `disabled` and `readonly`
 * in, hears `touch` when focus leaves the field, and `reset()` empties
 * it. The form holds the *message*; the ask is still `sent` — an action
 * with a stream behind it is the host's, not the form's submit.
 */
@Directive({
  selector: '[emailChatInput]',
  exportAs: 'emailChatInput',
  hostDirectives: [
    {
      directive: EmailEditor,
      inputs: ['value', 'disabled', 'readonly'],
      outputs: ['valueChange', 'touch'],
    },
  ],
})
export class ChatInputField {
  /** What the field is for, while it is empty. */
  readonly placeholder = input('');

  /** The field's name for assistive technology. */
  readonly label = input('Message');

  /** The editor underneath (`/editor`): mounting, the value both ways,
      `disabled`, `readonly` and `touch` — the signal-forms control. */
  readonly #field = inject(EmailEditor);

  /** Whether typing is refused. */
  readonly disabled = this.#field.disabled;

  /** Whether the text is shown but not edited. */
  readonly readonly = this.#field.readonly;

  /** The text, as it is sent: lines, and `- ` dash lines for list items. */
  readonly value = this.#field.value;

  /** Enter (outside a list) or Ctrl-Enter: the text, as `value` has it.
      Nothing is sent empty. The field keeps its text — the host clears it
      (`clear()`) once the ask is on its way. */
  readonly sent = output<string>();

  /** Escape, in the field. */
  readonly escaped = output<void>();

  /** The editor inside, once mounted — for a host that wants more of it
      than the text: its selection, a command, its `view`. */
  readonly editor = this.#field.editor;

  constructor() {
    this.#field.configure({
      kit: () => this.#kit(),
      codec: CHAT_CODEC,
      options: () => ({
        attributes: {
          class: 'email-chat-input__editor',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': this.label(),
        },
      }),
    });
  }

  /** Empties the field. */
  clear(): void {
    // Even while it is typed in — it is, as Enter sends — and no step to
    // undo back into a message already sent.
    this.#field.replace('', { history: false });
  }

  /** A form's reset: the field, empty. */
  reset(): void {
    this.clear();
  }

  focus(): void {
    this.#field.focus();
  }

  #kit(): Extension[] {
    const send: Command = (state, dispatch) => {
      if (!dispatch) return true;
      this.#send();
      return true;
    };
    const sendOutsideLists: Command = (state, dispatch) => {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === 'listItem') return false;
      }
      return send(state, dispatch);
    };
    const escape: Command = (_state, dispatch) => {
      if (dispatch) this.escaped.emit();
      return true;
    };
    return [
    Document,
    Paragraph,
    Text,
    HardBreak,
    // The lists carry their own keys (Enter goes on to the next item,
    // Tab nests) and their own `- ` / `1. ` input rules.
    BulletList,
    OrderedList,
    ListItem,
    History,
    NoTextDrag,
    defineExtension({
      name: 'chatInputKeys',
      keymap: () => ({
        Enter: sendOutsideLists,
        'Mod-Enter': send,
        'Shift-Enter': (state, dispatch) => {
          const hardBreak = state.schema.nodes['hardBreak'];
          dispatch?.(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
          return true;
        },
        Escape: escape,
      }),
    }),
    BaseKeymap,
    placeholder(() => this.placeholder()),
    ];
  }

  #send(): void {
    const editor = this.editor();
    if (!editor) return;
    const text = chatInputText(editor.state.doc);
    if (!text.trim()) return;
    this.sent.emit(text);
  }
}

/**
 * The chat input, styled: `ChatInputField`'s behaviour in a box of its
 * own — outlined on focus, growing and shrinking with its text in a short
 * transition, scrolling past a height, disabled dimmed — the look
 * tokenized (`--email-chat-input-*`, Material's system tokens beneath).
 * The same inputs and outputs, forwarded; the same signal-forms contract.
 *
 *     <div email-chat-input placeholder="Tell the assistant what to change…"
 *          [(value)]="instructions" (sent)="ask($event)" (escaped)="close()"></div>
 *
 * `field` is the directive underneath; `editor`, `clear()` and `focus()`
 * are its, at hand.
 *
 * **The growing** (chat-input.animation.ts): the box follows the text's
 * measured height through a `height` transition — `--email-chat-input-motion`
 * is its duration and easing (`150ms ease`); reduced motion turns it off. The
 * text grows to `--email-chat-input-max-height` (`5lh`, five lines) and
 * then scrolls inside the box.
 */
@Component({
  selector: 'div[email-chat-input]',
  template: '',
  styleUrl: './chat-input.scss',
  hostDirectives: [
    {
      directive: ChatInputField,
      // value, disabled, readonly, valueChange and touch are the field's
      // own editor's (EmailEditor), exposed by the field itself.
      inputs: ['placeholder', 'label'],
      outputs: ['sent', 'escaped'],
    },
  ],
  host: { '[class.email-chat-input--disabled]': 'field.disabled()' },
})
export class ChatInput {
  /** The behaviour underneath: the field itself. */
  readonly field = inject(ChatInputField);

  /** The editor inside, once mounted. */
  readonly editor = this.field.editor;

  constructor() {
    followTextHeight(this.editor);
  }

  /** Empties the field. */
  clear(): void {
    this.field.clear();
  }

  focus(): void {
    this.field.focus();
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
