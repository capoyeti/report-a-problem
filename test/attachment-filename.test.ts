import { describe, it, expect } from 'vitest';
import { sanitizeAttachmentFilename } from '../src/lib/attachment-filename';

describe('sanitizeAttachmentFilename', () => {
  it('keeps a normal filename as-is', () => {
    expect(sanitizeAttachmentFilename('tender-scope.pdf', 'application/pdf')).toBe('tender-scope.pdf');
  });

  it('replaces unsafe characters (path separators, spaces, unicode) with underscores', () => {
    expect(sanitizeAttachmentFilename('../weird nameé.txt', 'text/plain')).toBe('.._weird_name_.txt');
  });

  it('falls back to a mime-derived name when no filename is given', () => {
    expect(sanitizeAttachmentFilename(undefined, 'application/pdf')).toBe('attachment.pdf');
    expect(sanitizeAttachmentFilename('', 'image/png')).toBe('attachment.png');
  });

  it('falls back to .bin for an unrecognized mime type with no filename', () => {
    expect(sanitizeAttachmentFilename('', 'application/x-mystery')).toBe('attachment.bin');
  });

  it('caps an excessively long filename while keeping the extension', () => {
    const long = 'a'.repeat(300) + '.pdf';
    const result = sanitizeAttachmentFilename(long, 'application/pdf');
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('.pdf')).toBe(true);
  });
});
