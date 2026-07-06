import { GMAIL_CLIP_BYTES, emailSizeBudget, findCssIssues } from './client-support';

describe('client support data', () => {
  it('knows Outlook ignores max-width', () => {
    const issues = findCssIssues('max-width', '600px', 'div');
    expect(issues).toHaveLength(1);
    expect(issues[0].ignoredBy).toContain('outlook-desktop');
  });

  it('flags display only for modern layout values', () => {
    expect(findCssIssues('display', 'flex', 'div')).toHaveLength(1);
    expect(findCssIssues('display', 'inline-grid', 'div')).toHaveLength(1);
    expect(findCssIssues('display', 'block', 'div')).toEqual([]);
  });

  it('scopes padding to the tags Outlook actually breaks', () => {
    expect(findCssIssues('padding', '8px', 'div')).toHaveLength(1);
    expect(findCssIssues('padding', '8px', 'td')).toEqual([]);
  });

  it('flags background only when it carries an image', () => {
    expect(findCssIssues('background', 'url(x.png) no-repeat', 'div')).toHaveLength(1);
    expect(findCssIssues('background', '#eeeeee', 'div')).toEqual([]);
  });
});

describe('email size budget', () => {
  it('grades against the Gmail clipping limit', () => {
    expect(emailSizeBudget('a'.repeat(1024)).level).toBe('ok');
    expect(emailSizeBudget('a'.repeat(Math.round(GMAIL_CLIP_BYTES * 0.9))).level).toBe('warning');
    expect(emailSizeBudget('a'.repeat(GMAIL_CLIP_BYTES + 1)).level).toBe('error');
  });

  it('measures UTF-8 bytes, not string length', () => {
    expect(emailSizeBudget('€€€').bytes).toBe(9);
  });
});
