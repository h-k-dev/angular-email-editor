import { Service } from '@angular/core';

/** What the assistant is asked. */
export interface AiRequest {
  /** The text before the caret, for the assistant to read. */
  before: string;
  /** The language to write in. */
  language?: 'en' | 'de' | 'ja';
  /** What the writer asked for, in their own words — the assistant panel's
      prompt: "shorter", "mention the deadline", a list of points to make.
      Empty or absent: the assistant's own judgement. */
  instructions?: string;
  /** A part of the earlier answer the writer selected: the answer is that
      part, written again to the instructions — nothing else. */
  selection?: string;
}

export interface AiOptions {
  signal?: AbortSignal;
}

/** How long the assistant thinks before the first word, in ms — long
    enough for a host to show it thinking. */
export const AI_LATENCY = 1200;

/** The pause between two words, in ms — the pace of someone writing. */
export const AI_WORD_DELAY = 70;

/** The empty line between two blocks — the editor's own marker for it. Lines
    are `<div>`s with no margin, as in Gmail and Outlook, so the air between
    a greeting, the paragraphs and the sign-off has to be written. */
const GAP = '<div><br></div>';

/**
 * What an empty line gets: a whole email, in the canonical HTML the editor
 * writes itself — `<div>` lines, an empty line between blocks, merge tags, a
 * list, line breaks in the signature. Each language keeps its own business
 * conventions: an English sign-off and signature; the German one closes with
 * the legally required company details (Pflichtangaben, § 35a GmbHG); the
 * Japanese one addresses company and person (宛名), introduces the sender
 * (名乗り), and ends on a ruled signature block (署名). Long on purpose: it is
 * what shows whether streaming holds up over blocks, not just over a
 * sentence.
 */
const EMAILS = {
  en:
    '<div>Dear {{ firstName }},</div>' +
    GAP +
    '<div>Thank you for taking the time to meet with us last week. It was a pleasure to learn ' +
    'more about your plans, and I wanted to follow up with a short summary while everything ' +
    'is still fresh.</div>' +
    GAP +
    '<div>Here is what we agreed on:</div>' +
    '<ul>' +
    '<li>We will send the updated proposal by <strong>Friday</strong>.</li>' +
    '<li>Your team will review the timeline and share feedback.</li>' +
    '<li>We will schedule a follow-up call for <em>the week after</em>.</li>' +
    '</ul>' +
    GAP +
    '<div>If anything is missing, or if your priorities have changed since we spoke, please ' +
    'let me know and I will adjust the plan accordingly.</div>' +
    GAP +
    '<div>Best regards,</div>' +
    GAP +
    '<div>Alex Morgan<br>Senior Account Manager<br>Example Corp.<br>' +
    '+1 (212) 555-0100 · alex.morgan@example.com</div>',
  de:
    '<div>Guten Tag {{ firstName }} {{ lastName }},</div>' +
    GAP +
    '<div>vielen Dank, dass Sie sich letzte Woche die Zeit für unser Gespräch genommen haben. ' +
    'Es hat mich gefreut, mehr über Ihre Pläne zu erfahren, und ich möchte das Besprochene ' +
    'kurz zusammenfassen, solange alles noch frisch ist.</div>' +
    GAP +
    '<div>Darauf haben wir uns verständigt:</div>' +
    '<ul>' +
    '<li>Wir senden Ihnen das überarbeitete Angebot bis <strong>Freitag</strong>.</li>' +
    '<li>Ihr Team prüft den Zeitplan und gibt uns Rückmeldung.</li>' +
    '<li>Wir vereinbaren ein Folgegespräch für <em>die Woche darauf</em>.</li>' +
    '</ul>' +
    GAP +
    '<div>Sollte etwas fehlen oder sollten sich Ihre Prioritäten seit unserem Gespräch ' +
    'geändert haben, geben Sie mir bitte Bescheid – ich passe den Plan gerne an.</div>' +
    GAP +
    '<div>Mit freundlichen Grüßen</div>' +
    GAP +
    '<div>Alex Morgan<br>Senior Account Manager</div>' +
    GAP +
    '<div>Beispiel GmbH<br>Musterstraße 12 · 10115 Berlin<br>' +
    'Tel.: +49 30 123456-0 · alex.morgan@example.com<br>www.example.com</div>' +
    GAP +
    '<div>Sitz der Gesellschaft: Berlin<br>' +
    'Registergericht: Amtsgericht Charlottenburg, HRB 123456 B<br>' +
    'Geschäftsführung: Maria Beispiel, Thomas Muster<br>' +
    'USt-IdNr.: DE123456789</div>',
  ja:
    '<div>{{ company.name }}<br>{{ lastName }} 様</div>' +
    GAP +
    '<div>いつもお世話になっております。<br>株式会社サンプル営業部の森でございます。</div>' +
    GAP +
    '<div>先週はお忙しい中、お打ち合わせのお時間をいただき、<br>' +
    '誠にありがとうございました。<br>' +
    '貴社のご計画について詳しくお伺いでき、大変有意義な時間となりました。</div>' +
    GAP +
    '<div>内容を忘れないうちに、合意事項を以下のとおりまとめさせていただきます。</div>' +
    '<ul>' +
    '<li>更新したご提案書を<strong>金曜日</strong>までにお送りいたします。</li>' +
    '<li>貴社にてスケジュールをご確認のうえ、ご意見をお聞かせください。</li>' +
    '<li>フォローアップのお打ち合わせを<em>翌週</em>に設定いたします。</li>' +
    '</ul>' +
    GAP +
    '<div>不足している点や、その後ご優先事項に変更がございましたら、<br>' +
    'お手数ですがお知らせくださいませ。計画を調整いたします。</div>' +
    GAP +
    '<div>引き続き、どうぞよろしくお願い申し上げます。</div>' +
    GAP +
    '<div>━━━━━━━━━━━━━━━━━━━━<br>' +
    '株式会社サンプル　営業部<br>' +
    '森 アレックス（Alex Mori）<br>' +
    '〒100-0005 東京都千代田区丸の内1-2-3<br>' +
    'TEL：03-1234-5678<br>' +
    'Email：alex.mori@example.com<br>' +
    '━━━━━━━━━━━━━━━━━━━━</div>',
} as const;

/** How a message that has begun goes on. */
const WAYS_ON = {
  en: [
    'Please let me know if you have <strong>any questions</strong> about this.',
    'I am happy to go through the details on <strong>a short call</strong>.',
    'I look forward to <strong>hearing from you</strong>.',
  ],
  de: [
    'Bitte geben Sie mir Bescheid, falls Sie dazu <strong>Fragen haben</strong>.',
    'Gerne können wir die Einzelheiten in <strong>einem kurzen Gespräch</strong> klären.',
    'Ich freue mich auf <strong>Ihre Rückmeldung</strong>.',
  ],
  ja: [
    'ご不明な点がございましたら、<strong>お気軽に</strong>お知らせください。',
    '詳細につきましては、<strong>お電話で</strong>ご説明させていただければ幸いです。',
    '<strong>ご返信</strong>をお待ちしております。',
  ],
} as const;

/** Resolves after `ms`, or rejects the moment `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * A writing assistant. Stands in for a streaming `POST /api/ai/write` on a
 * real backend: it reads the text before the caret, thinks for a moment,
 * and writes on — a word at a time, the way a model's tokens arrive —
 * until it is done or told to stop through the `AbortSignal`. It answers in
 * **HTML** (a phrase set bold), cut wherever a word ends — so a tag arrives
 * in two pieces now and then, as it would from a model.
 * Deterministic, so the demo and its specs say the same thing twice. A real
 * host swaps the body for its model's stream.
 */
@Service()
export class Ai {
  /** The continuation, in pieces to append as they come: each a word with
      the space that separates it from what is already there. */
  async *write(
    { before, language = 'en', instructions = '', selection }: AiRequest,
    { signal }: AiOptions = {},
  ): AsyncGenerator<string, void, void> {
    await pause(AI_LATENCY, signal);
    const text =
      selection !== undefined
        ? this.#rewrite(selection, instructions)
        : this.#continuation(before, language, instructions);
    // Japanese has no spaces to break at: it arrives a couple of characters
    // at a time, and joins on without one.
    if (language === 'ja') {
      for (const piece of text.match(/.{1,2}/gu) ?? []) {
        yield piece;
        await pause(AI_WORD_DELAY, signal);
      }
      return;
    }
    const words = text.split(' ');
    // No space before the first word when the text already ends in one —
    // or has not begun.
    let glue = before === '' || /\s$/.test(before) ? '' : ' ';
    for (const word of words) {
      yield glue + word;
      glue = ' ';
      await pause(AI_WORD_DELAY, signal);
    }
  }

  /** A selected part, written again. The stand-in knows one instruction
      here too, *short*: the part's first sentence; otherwise the part as it
      was, its markup escaped — a model would paraphrase. */
  #rewrite(selection: string, instructions: string): string {
    const short = /short|brief|kurz|knapp|短|簡潔/i.test(instructions);
    const text = short ? (/^.*?[.!?。！？](?=\s|$)/s.exec(selection)?.[0] ?? selection) : selection;
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** What to write. On an empty line: a whole email. After text: a way on,
      two sentences of it — picked by how much is there, so that asking twice
      in a row does not say the same thing twice. The one instruction this
      stand-in understands is to be *short* ("short", "kurz", "短く"): the
      email keeps its greeting, its first paragraph and its sign-off, the
      way on is one sentence. A real model reads the whole prompt. */
  #continuation(before: string, language: 'en' | 'de' | 'ja', instructions: string): string {
    const short = /short|brief|kurz|knapp|短|簡潔/i.test(instructions);
    const written = before.trim();
    if (!written) {
      const blocks = EMAILS[language].split(GAP);
      return short ? [...blocks.slice(0, 2), ...blocks.slice(-2)].join(GAP) : EMAILS[language];
    }
    const ways = WAYS_ON[language];
    const sentences = written.split(/[.!?。！？]+/).filter((sentence) => sentence.trim()).length;
    const first = ways[sentences % ways.length];
    const second = ways[(sentences + 1) % ways.length];
    if (short) return first;
    return language === 'ja' ? first + second : `${first} ${second}`;
  }
}
