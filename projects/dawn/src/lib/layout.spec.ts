import { laysItselfOut } from './layout';

const whole = (body: string) => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;

describe('laysItselfOut', () => {
  it('is a letter, a fragment or a whole document, as each client sends one', () => {
    // Gmail: a fragment.
    expect(laysItselfOut('<div dir="ltr">Hi,<br>see attached.</div>')).toBe(false);
    // Outlook: Word's HTML, its page measured in pt.
    expect(
      laysItselfOut(
        '<html><head><style>@page WordSection1{size:612.0pt 792.0pt}</style></head>' +
          '<body><div class="WordSection1"><p class="MsoNormal">Dear Ms Novak,</p></div></body></html>',
      ),
    ).toBe(false);
    // Apple Mail and Thunderbird: a whole document round a few lines.
    expect(laysItselfOut(whole('Hi Lena,<div><br></div><div>Thanks, Marco</div>'))).toBe(false);
    expect(
      laysItselfOut(whole('<p>Good afternoon,</p><div class="moz-signature">-- <br>Sofia</div>')),
    ).toBe(false);
  });

  it('lays itself out as a page: a body wrapped whole in one full-width table', () => {
    const page =
      '<table width="100%" bgcolor="#eef2f7"><tbody><tr><td align="center">' +
      '<table width="600"><tbody><tr><td>Welcome</td></tr></tbody></table>' +
      '</td></tr></tbody></table>\n';
    expect(laysItselfOut(page)).toBe(true);
    expect(laysItselfOut(whole(page))).toBe(true);
    expect(laysItselfOut('<table style="width: 100%;"><tr><td>Hi</td></tr></table>')).toBe(true);
  });

  it('lays itself out with a column of its own: a fixed card, a centred max-width', () => {
    expect(laysItselfOut('<table width="600"><tr><td>x</td></tr></table>')).toBe(true);
    expect(
      laysItselfOut(
        whole('<center><table width="600" align="center"><tr><td>Promo</td></tr></table></center>'),
      ),
    ).toBe(true);
    expect(
      laysItselfOut(
        '<div style="background: #eee"><div style="max-width: 600px; margin: 0 auto">News</div></div>',
      ),
    ).toBe(true);
    expect(
      laysItselfOut('<table style="min-width: 820px"><tr><td>Statement</td></tr></table>'),
    ).toBe(true);
    // Read off the attribute: jsdom's `style` loses this whole declaration list.
    expect(
      laysItselfOut('<div style="max-width:600px;background:#fff;border-radius:8px">News</div>'),
    ).toBe(true);
  });

  it('is still a letter round a full-width table, a signature, a wide image or a quote', () => {
    expect(laysItselfOut('<p>Hi</p><table width="100%"><tr><td>x</td></tr></table>')).toBe(false);
    expect(laysItselfOut('Hi<table width="100%"><tr><td>x</td></tr></table>')).toBe(false);
    expect(
      laysItselfOut('<p>Regards</p><table width="350"><tr><td>Kanzlei</td></tr></table>'),
    ).toBe(false);
    expect(laysItselfOut('<p>See the photo:</p><img width="700" src="x.png">')).toBe(false);
    expect(
      laysItselfOut(
        '<p>FYI</p><blockquote><table width="600"><tr><td>News</td></tr></table></blockquote>',
      ),
    ).toBe(false);
    // A width in a unit a layout is not drawn in, or a share of the frame.
    expect(laysItselfOut('<table style="width: 450pt"><tr><td>x</td></tr></table>')).toBe(false);
    expect(laysItselfOut('<p>Hi</p><div style="max-width: 80%">x</div>')).toBe(false);
  });
});
