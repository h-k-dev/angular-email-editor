/**
 * The sent email's rule for iOS, in a real engine — `npm run test:render`
 * (jsdom has no cascade to trust with `inherit !important`).
 *
 * iOS Mail wraps the dates, addresses and phone numbers it finds in links of
 * its own, marked `x-apple-data-detectors`. Drawn in a frame, such a link
 * must take the colour, face, size and weight of the words round it and
 * lose its underline, while a link the author wrote keeps its own.
 */
import { DATA_DETECTORS_RULE, emailDocument } from './email-document';

/** A line as iOS Mail hands it to its web view: a date it linked, beside a
    link the author wrote. */
const LINE =
  '<p style="color: #202124; font-family: Georgia, serif; font-size: 14px; font-weight: bold;">' +
  'Termin am <a id="found" href="x-apple-data-detectors://0" x-apple-data-detectors="true" ' +
  'x-apple-data-detectors-type="calendar-event">12.03.2027</a>, mehr ' +
  '<a id="own" href="https://example.com" style="color: #1a73e8;">hier</a></p>';

/** What a link looks like, drawn. */
async function look(html: string, id: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width: 375px; height: 300px; border: 0;';
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.srcdoc = html;
  });
  const view = frame.contentWindow!;
  const style = view.getComputedStyle(frame.contentDocument!.getElementById(id)!);
  const found = {
    color: style.color,
    underline: style.textDecorationLine,
    family: style.fontFamily,
    size: style.fontSize,
    weight: style.fontWeight,
  };
  frame.remove();
  return found;
}

describe('the sent email on iOS: what Mail linked reads as the words round it', () => {
  const sent = emailDocument(LINE);

  it('a date iOS linked takes the line’s colour, face, size and weight, and no underline', async () => {
    expect(await look(sent, 'found')).toEqual({
      color: 'rgb(32, 33, 36)',
      underline: 'none',
      family: 'Georgia, serif',
      size: '14px',
      weight: '700',
    });
  });

  it('a link the author wrote keeps its own colour and its underline', async () => {
    const own = await look(sent, 'own');
    expect(own.color).toBe('rgb(26, 115, 232)');
    expect(own.underline).toBe('underline');
  });

  it('sees the difference: without the rule the date is a link like any other', async () => {
    const bare = await look(sent.replace(DATA_DETECTORS_RULE, ''), 'found');
    expect(bare.color).not.toBe('rgb(32, 33, 36)');
    expect(bare.underline).toBe('underline');
  });
});
