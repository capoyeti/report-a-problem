import { describe, it, expect } from 'vitest';
import { ALLOWED_TYPES, buildAcceptAttribute, clipboardBlobToFile, firstAllowedImageType } from '../src/client/attachments';

describe('buildAcceptAttribute', () => {
  it('offers the picker every type the panel accepts', () => {
    const accept = buildAcceptAttribute();
    for (const type of ALLOWED_TYPES) expect(accept).toContain(type);
  });

  it('is a comma separated list with no stray whitespace', () => {
    expect(buildAcceptAttribute().split(',')).toEqual(ALLOWED_TYPES);
  });
});

describe('clipboardBlobToFile', () => {
  it('names a pasted PNG with its timestamp and extension', () => {
    const file = clipboardBlobToFile(new Blob(['x'], { type: 'image/png' }), 1757200000000);
    expect(file?.name).toBe('pasted-1757200000000.png');
    expect(file?.type).toBe('image/png');
  });

  it('maps jpeg and the office types to their short extensions', () => {
    expect(clipboardBlobToFile(new Blob([''], { type: 'image/jpeg' }), 1)?.name).toBe('pasted-1.jpg');
    expect(
      clipboardBlobToFile(new Blob([''], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 1)?.name
    ).toBe('pasted-1.xlsx');
  });

  it('returns null for a type the service would reject', () => {
    expect(clipboardBlobToFile(new Blob(['<svg/>'], { type: 'image/svg+xml' }), 1)).toBeNull();
    expect(clipboardBlobToFile(new Blob([''], { type: '' }), 1)).toBeNull();
  });
});

describe('firstAllowedImageType', () => {
  it('picks the image out of the representations one copy offers', () => {
    expect(firstAllowedImageType(['text/html', 'image/png'])).toBe('image/png');
  });

  it('returns null when the clipboard holds no image we accept', () => {
    expect(firstAllowedImageType(['text/plain', 'text/html'])).toBeNull();
  });
});
