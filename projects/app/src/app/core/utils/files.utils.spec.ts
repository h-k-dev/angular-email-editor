import { fileExtension, isImageFile } from './files.utils';

describe('fileExtension', () => {
  it('is the last part of the name, lower case, without the dot', () => {
    expect(fileExtension('Photo.JPG')).toBe('jpg');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
  });

  it('is empty for no extension, or a leading dot only', () => {
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('.env')).toBe('');
  });
});

describe('isImageFile', () => {
  it('takes a specific MIME type at its word', () => {
    expect(isImageFile({ name: 'a.bin', type: 'image/png' })).toBe(true);
    expect(isImageFile({ name: 'photo.jpg', type: 'application/pdf' })).toBe(false);
    expect(isImageFile({ name: 'x', type: 'IMAGE/WEBP' })).toBe(true);
  });

  it('asks the name when the type is missing or only generic', () => {
    expect(isImageFile({ name: 'IMG_0042.HEIC', type: '' })).toBe(true);
    expect(isImageFile({ name: 'scan.tiff', type: 'application/octet-stream' })).toBe(true);
    expect(isImageFile({ name: 'photo.jpeg' })).toBe(true);
    expect(isImageFile({ name: 'notes.txt', type: '' })).toBe(false);
    expect(isImageFile({ name: 'jpg', type: '' })).toBe(false);
  });

  it('reads a browser File as it is', () => {
    expect(isImageFile(new File(['x'], 'photo.png', { type: '' }))).toBe(true);
  });
});
