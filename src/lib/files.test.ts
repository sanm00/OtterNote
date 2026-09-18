import { describe, expect, it } from 'vitest';
import {
  extractAltText,
  extractFileExtension,
  extractFileName,
  formatAttachmentTime,
  formatBytes,
  imageExtensionFromMimeType,
  isImageFileName,
  mimeTypeFromFileName,
  normalizeClipboardImagePath,
} from './files';

describe('extractFileName', () => {
  it('handles unix and windows separators', () => {
    expect(extractFileName('/tmp/photos/a.png')).toBe('a.png');
    expect(extractFileName('C:\\Users\\me\\a.png')).toBe('a.png');
    expect(extractFileName('a.png')).toBe('a.png');
  });
});

describe('extractFileExtension', () => {
  it('returns the lowercased extension without the dot', () => {
    expect(extractFileExtension('a.PNG')).toBe('png');
    expect(extractFileExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns an empty string when there is no extension', () => {
    expect(extractFileExtension('a')).toBe('');
    expect(extractFileExtension('a.')).toBe('');
    expect(extractFileExtension('.hidden')).toBe('hidden');
  });
});

describe('extractAltText', () => {
  it('drops the extension', () => {
    expect(extractAltText('holiday.png')).toBe('holiday');
  });

  it('falls back to a generic alt text', () => {
    expect(extractAltText('.png')).toBe('image');
  });
});

describe('imageExtensionFromMimeType', () => {
  it('maps known image types', () => {
    expect(imageExtensionFromMimeType('image/jpeg')).toBe('jpg');
    expect(imageExtensionFromMimeType('image/webp')).toBe('webp');
    expect(imageExtensionFromMimeType('image/svg+xml')).toBe('svg');
  });

  it('defaults to png', () => {
    expect(imageExtensionFromMimeType('application/octet-stream')).toBe('png');
  });
});

describe('mimeTypeFromFileName', () => {
  it('maps known extensions', () => {
    expect(mimeTypeFromFileName('a.jpeg')).toBe('image/jpeg');
    expect(mimeTypeFromFileName('a.PNG')).toBe('image/png');
    expect(mimeTypeFromFileName('a.gif')).toBe('image/gif');
  });

  it('defaults to png', () => {
    expect(mimeTypeFromFileName('a.txt')).toBe('image/png');
  });
});

describe('isImageFileName', () => {
  it('accepts supported image extensions', () => {
    expect(isImageFileName('a.svg')).toBe(true);
    expect(isImageFileName('a.JPG')).toBe(true);
  });

  it('rejects other files', () => {
    expect(isImageFileName('a.txt')).toBe(false);
    expect(isImageFileName('a')).toBe(false);
  });
});

describe('normalizeClipboardImagePath', () => {
  it('ignores empty values and comments', () => {
    expect(normalizeClipboardImagePath('   ')).toBe('');
    expect(normalizeClipboardImagePath('# a comment')).toBe('');
  });

  it('decodes file urls', () => {
    expect(normalizeClipboardImagePath('file:///tmp/a%20b.png')).toBe('/tmp/a b.png');
    expect(normalizeClipboardImagePath('file:///tmp/a.png')).toBe('/tmp/a.png');
  });

  it('returns plain paths unchanged', () => {
    expect(normalizeClipboardImagePath(' /tmp/a.png ')).toBe('/tmp/a.png');
  });
});

describe('formatBytes', () => {
  it('formats bytes and larger units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
  });
});

describe('formatAttachmentTime', () => {
  it('reports unknown times', () => {
    expect(formatAttachmentTime('')).toBe('Unknown time');
  });

  it('returns non numeric input unchanged', () => {
    expect(formatAttachmentTime('yesterday')).toBe('yesterday');
  });

  it('formats unix timestamps', () => {
    expect(formatAttachmentTime('1700000000')).not.toBe('1700000000');
    expect(formatAttachmentTime('1700000000')).not.toBe('Unknown time');
  });
});
