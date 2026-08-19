import { InboundMessage } from 'angular-email-editor';

/**
 * Dummy inbound messages for the footer's reply-example cycler — a quick way
 * to eyeball what `replyDocument` seeds for the shapes of mail we expect to
 * answer. Demo data only: nothing here ships with the library.
 */
export interface ReplyExample {
  /** Short label shown in the status strip while the example is active. */
  name: string;
  inbound: InboundMessage;
}

export const REPLY_EXAMPLES: ReplyExample[] = [
  {
    name: 'Plain note',
    inbound: {
      html:
        '<div>Hi,</div><div><br></div>' +
        '<div>Are we still on for the review tomorrow at 10?</div><div><br></div>' +
        '<div>Best,<br>Jane</div>',
      from: 'Jane Doe <jane@example.com>',
      date: 'Aug 18, 2026, 4:32 PM',
    },
  },
  {
    name: 'Gmail thread',
    // A reply that itself quotes history — shows the class dropping and the
    // nesting surviving the schema parse.
    inbound: {
      html:
        '<div dir="ltr">Works for me — see the thread below.</div>' +
        '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">' +
        '<div>On Mon, Aug 17, 2026, Sam wrote:</div>' +
        '<blockquote class="gmail_quote"><div>First draft attached.</div></blockquote>' +
        '</blockquote>',
      from: 'Ravi Patel <ravi@example.com>',
      date: new Date(2026, 7, 18, 9, 5),
    },
  },
  {
    name: 'Outlook memo',
    // Word-engine class soup and mso styles — everything foreign dies in the
    // parse, the text survives.
    inbound: {
      html:
        '<p class="MsoNormal" style="mso-margin-top-alt:auto;line-height:115%">' +
        '<span style="font-size:11.0pt;font-family:&quot;Calibri&quot;,sans-serif">' +
        'Please find the updated figures in the shared folder.</span></p>' +
        '<p class="MsoNormal"><b><span>Regards,<o:p></o:p></span></b></p>' +
        '<p class="MsoNormal">Monika</p>',
      from: 'Monika Weber',
      date: 'Aug 14, 2026',
    },
  },
  {
    name: 'Text-only',
    // No HTML part at all — the text/plain fallback, one paragraph per line.
    inbound: {
      text: 'Server maintenance tonight 23:00-01:00.\n\nExpect short outages.\n- Ops',
      from: 'ops@example.com',
    },
  },
  {
    name: 'Suspicious newsletter',
    // Hostile markup: script, a script-URL image, a tracking pixel with a
    // fixed width, inline event handlers. The reply quotes only what the
    // schema admits — a live demo of parse-as-sanitizer.
    inbound: {
      html:
        '<div style="background:#ff0000;color:#00ff33">MEGA SALE!!!</div>' +
        '<script>document.location="https://evil.example"</script>' +
        '<img src="javascript:steal()" alt="prize">' +
        '<img src="https://tracker.example/pixel.gif" width="1200" alt="">' +
        '<a href="javascript:void(0)" onclick="pwn()">Claim now</a>',
      from: 'deals@newsletter.example',
      date: 'Aug 19, 2026, 6:00 AM',
    },
  },
];
