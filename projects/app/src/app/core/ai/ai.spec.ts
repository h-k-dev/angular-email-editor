import { TestBed } from '@angular/core/testing';
import { AI_LATENCY, AI_WORD_DELAY, Ai, AiRequest } from './ai';

describe('Ai', () => {
  let service: Ai;

  /** Everything the assistant writes, with the waiting skipped. */
  const written = async (request: AiRequest) => {
    let text = '';
    const reading = (async () => {
      for await (const piece of service.write(request)) text += piece;
    })();
    await vi.runAllTimersAsync();
    await reading;
    return text;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(Ai);
  });

  afterEach(() => vi.useRealTimers());

  it('thinks for a moment, then writes a word at a time', async () => {
    const pieces: string[] = [];
    const reading = (async () => {
      for await (const piece of service.write({ before: 'Hello.' })) pieces.push(piece);
    })();

    await vi.advanceTimersByTimeAsync(AI_LATENCY - 50);
    expect(pieces).toEqual([]);
    await vi.advanceTimersByTimeAsync(60);
    expect(pieces).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(AI_WORD_DELAY);
    expect(pieces).toHaveLength(2);

    await vi.runAllTimersAsync();
    await reading;
    expect(pieces.length).toBeGreaterThan(5);
    expect(pieces.every((piece) => piece.trim().split(' ').length === 1)).toBe(true);
  });

  it('stops mid-sentence when it is no longer wanted', async () => {
    const controller = new AbortController();
    const pieces: string[] = [];
    const reading = (async () => {
      for await (const piece of service.write({ before: 'Hello.' }, controller)) pieces.push(piece);
    })();
    await vi.advanceTimersByTimeAsync(AI_LATENCY + AI_WORD_DELAY * 2);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    const seen = pieces.length;
    await vi.runAllTimersAsync();
    expect(pieces).toHaveLength(seen);
    expect(seen).toBeGreaterThan(0);
  });

  it('joins onto what is there: a space before the first word only when one is missing', async () => {
    expect(await written({ before: 'Hello.' })).toMatch(/^ \S/);
    expect(await written({ before: 'Hello. ' })).toMatch(/^\S/);
    expect(await written({ before: '' })).toMatch(/^\S/);
  });

  it('drafts a whole email on an empty line: a greeting, paragraphs, a list, a sign-off', async () => {
    const email = await written({ before: '' });
    expect(email.length).toBeGreaterThan(500);
    expect(email).toMatch(/^<div>Dear \{\{ firstName \}\},<\/div><div><br><\/div><div>Thank/);
    expect(email.match(/<li>/g)).toHaveLength(3);
    expect(email).toContain('<strong>Friday</strong>');
    expect(email).toContain('<div>Best regards,</div><div><br></div><div>Alex Morgan<br>');
  });

  it('leaves an empty line between every two blocks, the list hanging off its lead-in', async () => {
    for (const language of ['en', 'de', 'ja'] as const) {
      const email = await written({ before: '', language });
      // With the empty lines taken out, no two blocks touch — but the
      // lead-in and its list.
      const blocks = email.replaceAll('<div><br></div>', '|');
      expect(blocks).not.toContain('</div><div>');
      expect(blocks).not.toContain('</ul><div>');
      expect(blocks).toMatch(/[:。]<\/div><ul>/);
    }
  });

  it('closes a German email with the company details the law asks for', async () => {
    const email = await written({ before: '', language: 'de' });
    expect(email).toContain('<div>Mit freundlichen Grüßen</div><div><br></div>');
    expect(email).toMatch(/Sitz der Gesellschaft: .+Registergericht: .+Geschäftsführung: /);
  });

  it('writes a Japanese email the Japanese way: 宛名, 名乗り, a ruled 署名', async () => {
    const email = await written({ before: '', language: 'ja' });
    expect(email).toMatch(/^<div>\{\{ company\.name \}\}<br>\{\{ lastName \}\} 様<\/div>/);
    expect(email).toContain('いつもお世話になっております。<br>株式会社サンプル営業部の森でございます。');
    expect(email).toMatch(/<div>━+<br>.+<br>━+<\/div>$/);
  });

  it('writes the whole email in Japanese too, a couple of characters at a time', async () => {
    const pieces: string[] = [];
    const reading = (async () => {
      for await (const piece of service.write({ before: '', language: 'ja' })) pieces.push(piece);
    })();
    await vi.runAllTimersAsync();
    await reading;
    expect(pieces.every((piece) => [...piece].length <= 2)).toBe(true);
    expect(pieces.join('')).toContain('<li>');
    expect(pieces.join('')).toContain('様');
  });

  it('opens an empty message differently than it carries one on', async () => {
    expect(await written({ before: '' })).not.toBe(await written({ before: 'We met last week. ' }));
  });

  it('does not say the same sentence twice when asked again after its own', async () => {
    const first = await written({ before: 'We met last week. ' });
    const second = await written({ before: `We met last week. ${first} ` });
    expect(second).not.toBe(first);
  });

  it('writes in the language asked for', async () => {
    expect(await written({ before: 'Wir liefern am Montag. ', language: 'de' })).toMatch(
      /Gerne|Bitte|freue/,
    );
  });
});
