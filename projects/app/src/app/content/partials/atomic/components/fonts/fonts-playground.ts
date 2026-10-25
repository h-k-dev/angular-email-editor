import { Component, computed, signal } from '@angular/core';
import {
  emailDefaultFont,
  emailFontFamilies,
  emailFontSizes,
  fontClients,
  fontFamilyKey,
  isEmailFontStack,
  matchEmailFont,
} from '@h-k-dev/angular-email-editor/fonts';

import { Playground, PlaygroundAction, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** A font as the stage lists it: its sample in its own stack, and which
    clients draw the face itself. */
interface FontRow {
  readonly id: string;
  readonly name: string;
  readonly stack: string;
  readonly clients: readonly {
    readonly letter: string;
    readonly name: string;
    readonly has: boolean;
  }[];
  readonly matched: boolean;
}

/**
 * The fonts an email is written in — plain data, Gmail's set in Gmail's
 * order: each in its own stack, the clients that draw the face itself
 * (G, A, O) and the rest falling back. The `font-family` knob is what a
 * pasted email or another editor brings: `matchEmailFont` says which font
 * it is, and its row lights up.
 */
@Component({
  selector: 'fonts-playground',
  imports: [PlaygroundFrame],
  templateUrl: './fonts-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './fonts-playground.scss'],
  providers: [Playground],
})
export class FontsPlayground {
  readonly sample = signal('The quick brown fox jumps over the lazy dog');
  readonly size = signal<string>(String(emailFontSizes[0]));
  readonly family = signal('Ubuntu, Helvetica, Arial, sans-serif');

  protected readonly sizePx = computed(() => Number(this.size()));

  protected readonly matched = computed(() => matchEmailFont(this.family()));

  protected readonly rows = computed<FontRow[]>(() =>
    emailFontFamilies.map((font) => ({
      id: font.id,
      name: font.name,
      stack: font.stack,
      clients: fontClients.map((client) => ({
        letter: client.letter,
        name: client.name,
        has: font.clients.includes(client.id),
      })),
      matched: this.matched()?.id === font.id,
    })),
  );

  protected readonly value = computed(() => ({
    family: this.family(),
    key: fontFamilyKey(this.family()),
    isEmailFontStack: isEmailFontStack(this.family()),
    matchEmailFont: this.matched()?.id ?? null,
    default: emailDefaultFont.id,
  }));

  protected readonly knobs = [
    knob.text('sample', this.sample),
    knob.choice('size (px)', this.size, emailFontSizes.map(String)),
    knob.text('font-family to match', this.family),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    {
      name: "a builder's web font",
      run: () => this.family.set('Ubuntu, Helvetica, Arial, sans-serif'),
    },
    { name: "summernote's face", run: () => this.family.set("'Comic Sans MS'") },
    { name: 'a curated stack', run: () => this.family.set('"Trebuchet MS", sans-serif') },
    { name: 'no font', run: () => this.family.set('Ubuntu') },
  ];
}
