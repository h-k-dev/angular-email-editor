/**
 * The quoted history's boxes, laid out in real Chromium — `npm run
 * test:render`: what the fold's sheet draws, measured, not read.
 */
import { foldQuoted } from './quoted';
import { renderDawn } from './render';

/** The message folded, drawn and laid out in a frame, the fold open. */
function laidOut(html: string, scheme: 'light' | 'dark' = 'light'): Promise<Document> {
  const frame = document.createElement('iframe');
  frame.style.width = '600px';
  frame.srcdoc = renderDawn(foldQuoted(html, { label: 'Quoted text' }), { scheme });
  document.body.appendChild(frame);
  return new Promise((done) => {
    frame.onload = () => {
      const drawn = frame.contentDocument!;
      drawn.querySelector('details')?.setAttribute('open', '');
      done(drawn);
    };
  });
}

const style = (element: Element | null) => getComputedStyle(element!);
const alpha = (color: string) => Number(/rgba?\([^)]*,\s*([\d.]+)\)/.exec(color)?.[1] ?? 1);

const attr = (who: string) => `<div class="gmail_attr">On Monday, ${who} wrote:<br></div>`;
const quote = (who: string, inner: string) =>
  `<div class="gmail_quote gmail_quote_container">${attr(who)}<blockquote class="gmail_quote">${inner}</blockquote></div>`;

afterEach(() => document.querySelectorAll('iframe').forEach((frame) => frame.remove()));

describe('foldQuoted’s boxes (render)', () => {
  it('draws the line opaque, so a box on another’s sides never darkens them', async () => {
    const drawn = await laidOut(
      `<div>Fine.</div>${quote('Alex', `<div>Yes.</div>${quote('Sam', 'Draft.')}`)}`,
    );
    const [outer, inner] = Array.from(drawn.querySelectorAll('div.gmail_quote'));
    expect(alpha(style(outer!).borderLeftColor)).toBe(1);
    expect(style(inner!).borderLeftColor).toBe(style(outer!).borderLeftColor);
    // The inner box is drawn out over the outer's sides: one line, not two.
    expect(inner!.getBoundingClientRect().left).toBe(outer!.getBoundingClientRect().left);
    expect(inner!.getBoundingClientRect().bottom).toBe(outer!.getBoundingClientRect().bottom);
  });

  it('lays the boxes on dark paper in dark, never the light canvas', async () => {
    const drawn = await laidOut(`<div>Fine.</div>${quote('Alex', 'Draft.')}`, 'dark');
    expect(style(drawn.documentElement).getPropertyValue('--dawn-quoted-paper').trim()).toBe(
      '#1e1e1e',
    );
  });

  it('keeps a quote answered under it inside its parent’s box, the answer clear of it', async () => {
    const inline = `<div>Yes.</div>${quote('Sam', 'Draft.')}<div>And the venue?</div>`;
    const drawn = await laidOut(`<div>Fine.</div>${quote('Alex', inline)}`);
    const [outer, inner] = Array.from(drawn.querySelectorAll('div.gmail_quote'));
    const answer = Array.from(drawn.querySelectorAll('div')).find(
      (div) => div.textContent === 'And the venue?',
    )!;
    expect(parseFloat(style(inner!).marginBottom)).toBeGreaterThan(0);
    expect(answer.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      inner!.getBoundingClientRect().bottom,
    );
    expect(inner!.getBoundingClientRect().left).toBeGreaterThan(
      outer!.getBoundingClientRect().left,
    );
  });

  it('boxes a bare Gmail blockquote, and only once inside Gmail’s wrapper', async () => {
    const bare = await laidOut(
      '<div>Fine.</div><blockquote class="gmail_quote"><div>First draft.</div></blockquote>',
    );
    expect(style(bare.querySelector('blockquote')).borderTopWidth).toBe('1px');
    const wrapped = await laidOut(`<div>Fine.</div>${quote('Sam', 'Draft.')}`);
    expect(style(wrapped.querySelector('blockquote')).borderTopWidth).toBe('0px');
  });

  it('draws no attribution box round the mail under Outlook’s header', async () => {
    const drawn = await laidOut(
      '<div>Thanks, Sam.</div><div id="appendonsend"></div><hr>' +
        '<div id="divRplyFwdMsg"><b>From:</b> Sam<br><b>Sent:</b> Monday</div>' +
        '<div id="own">First draft attached.</div><blockquote>A quote of Sam’s own.</blockquote>',
    );
    const own = drawn.getElementById('own');
    expect(style(own).borderTopWidth).toBe('0px');
    expect(style(own).fontSize).toBe(style(drawn.getElementById('divRplyFwdMsg')).fontSize);
  });

  it('still draws a plain attribution line as its box’s top, even after blank blocks', async () => {
    const drawn = await laidOut(
      '<div>Fine.</div><div><br></div><div id="line">On Monday, Sam wrote:</div><blockquote>Draft.</blockquote>',
    );
    expect(style(drawn.getElementById('line')).borderTopWidth).toBe('1px');
    expect(style(drawn.querySelector('blockquote')).borderBottomWidth).toBe('1px');
  });

  it('keeps a nested quote followed by a text node or wrapped before text inside its parent’s box', async () => {
    for (const inner of [
      `<div>Yes.${quote('Sam', 'Draft.')}And the venue?</div>`,
      `<div>Yes.</div><div>${quote('Sam', 'Draft.')}</div><div>And the venue?</div>`,
    ]) {
      const drawn = await laidOut(`<div>Fine.</div>${quote('Alex', inner)}`);
      const [outer, nested] = Array.from(drawn.querySelectorAll('div.gmail_quote'));
      expect(nested!.getBoundingClientRect().left).toBeGreaterThan(
        outer!.getBoundingClientRect().left,
      );
    }
  });

  it('keeps the box line un-darkened in dark mode so it matches the thread stem', async () => {
    const drawn = await laidOut(`<div>Fine.</div>${quote('Alex', 'Draft.')}`, 'dark');
    const css = drawn.querySelector('details[data-dawn-quoted] > style')?.textContent ?? '';
    expect(css).toContain('rgb(128, 128, 128)');
    expect(css).not.toContain('rgb(153, 153, 153)');
  });

  it('runs a forward with no word of its own on in its parent’s box, no box of its own', async () => {
    const forward =
      '<div class="gmail_quote"><div class="gmail_attr">Forwarded</div><div>Draft.</div></div>';
    const drawn = await laidOut(
      `<div>Fine.</div>${quote('Alex', `<div dir="ltr"><br><br>${forward}</div>`)}`,
    );
    expect(style(drawn.querySelector('[data-dawn-quoted-joined]')).borderTopWidth).toBe('0px');
  });

  // A header written out as text (WEB.DE's) has no box and no rule to keep
  // it off the ⋯: the gap a box keeps under it, kept for it too.
  it('keeps a header written out as text off the ⋯, as far as a box', async () => {
    const header =
      '<div>Von: Kanzlei Novak<br>Datum: 17. November 2026<br>An: lena@example.com<br>Betreff: Ihre Angelegenheit</div>';
    const plain = await laidOut(
      `<div>Danke.<br>Am Montag schrieb Kanzlei Novak</div><div>${header}<p>Sehr geehrte Frau Weber,</p></div>`,
    );
    const boxed = await laidOut(`<div>Fine.</div>${quote('Alex', 'Draft.')}`);
    const gap = (drawn: Document, first: Element) =>
      first.getBoundingClientRect().top -
      drawn.querySelector('summary')!.getBoundingClientRect().bottom;
    const headerGap = gap(plain, plain.querySelector('[data-dawn-quoted-header]')!);
    expect(headerGap).toBeGreaterThanOrEqual(8);
    expect(headerGap).toBe(gap(boxed, boxed.querySelector('[data-dawn-quoted-box]')!));
  });
});
