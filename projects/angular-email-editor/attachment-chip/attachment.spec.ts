import { attachmentKind, formatAttachmentSize } from './attachment';

describe('attachmentKind', () => {
  it('names the kinds a message carries', () => {
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('application/pdf')).toBe('pdf');
    expect(attachmentKind('application/zip')).toBe('archive');
    expect(attachmentKind('text/csv')).toBe('spreadsheet');
    expect(attachmentKind('message/rfc822')).toBe('message');
    expect(attachmentKind('video/mp4')).toBe('video');
    expect(attachmentKind('audio/mpeg')).toBe('audio');
    expect(attachmentKind('text/plain')).toBe('document');
  });

  it('tests the specific document types before the catch-alls', () => {
    // All three are `application/*` and spell out "document" — order in the
    // table is what keeps them apart.
    expect(
      attachmentKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('document');
    expect(
      attachmentKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('spreadsheet');
    expect(
      attachmentKind('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    ).toBe('presentation');
  });

  it('falls back to a plain file for an unknown or missing type', () => {
    expect(attachmentKind(undefined)).toBe('file');
    expect(attachmentKind('')).toBe('file');
    expect(attachmentKind('application/octet-stream')).toBe('file');
  });

  it('is case-insensitive — a MIME type from the wire may be shouted', () => {
    expect(attachmentKind('IMAGE/PNG')).toBe('image');
    expect(attachmentKind('Application/PDF')).toBe('pdf');
  });
});

describe('formatAttachmentSize', () => {
  it('steps in binary units, one decimal below ten', () => {
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(2048)).toBe('2 KB');
    expect(formatAttachmentSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatAttachmentSize(15 * 1024 * 1024)).toBe('15 MB');
    expect(formatAttachmentSize(3 * 1024 ** 3)).toBe('3 GB');
  });

  it('never groups digits or goes negative', () => {
    expect(formatAttachmentSize(1023.9 * 1024)).toBe('1024 KB');
    expect(formatAttachmentSize(-5)).toBe('0 B');
  });

  it('writes the number in the locale, the unit as mail clients do', () => {
    expect(formatAttachmentSize(2.5 * 1024 * 1024, 'de-DE')).toBe('2,5 MB');
  });
});
