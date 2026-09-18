import { describe, expect, it } from 'vitest';
import { attachmentFallbackCandidates, extractAttachmentReferences } from './attachments';

describe('extractAttachmentReferences', () => {
  it('finds every attachment reference in markdown', () => {
    expect(
      extractAttachmentReferences('![a](attachment://asset-1.preview.png) ![b](attachment://asset-2.jpg)'),
    ).toEqual(['asset-1.preview.png', 'asset-2.jpg']);
  });

  it('stops the reference at characters that cannot appear in a file name', () => {
    expect(extractAttachmentReferences('![](attachment://asset-1.png)')).toEqual(['asset-1.png']);
  });

  it('returns duplicates when the same attachment is referenced twice', () => {
    expect(extractAttachmentReferences('attachment://a.png attachment://a.png')).toEqual(['a.png', 'a.png']);
  });

  it('recovers when a reference is malformed', () => {
    expect(extractAttachmentReferences('attachment:// and attachment://ok.png')).toEqual(['ok.png']);
  });

  it('returns an empty list when there is nothing to find', () => {
    expect(extractAttachmentReferences('plain text')).toEqual([]);
  });
});

describe('attachmentFallbackCandidates', () => {
  it('tries original files when a preview cannot be loaded', () => {
    expect(attachmentFallbackCandidates('asset-1.preview.png')).toEqual([
      'asset-1.original.png',
      'asset-1.original.jpg',
      'asset-1.original.jpeg',
      'asset-1.original.webp',
      'asset-1.original.gif',
      'asset-1.original.bmp',
      'asset-1.original.svg',
    ]);
  });

  it('puts the provided fallback file first', () => {
    expect(attachmentFallbackCandidates('asset-1.preview.png', 'asset-1.original.webp')[0]).toBe(
      'asset-1.original.webp',
    );
  });

  it('ignores a fallback that matches the requested file', () => {
    expect(attachmentFallbackCandidates('asset-1.png', 'asset-1.png')).toEqual([]);
  });

  it('has no candidates for a file that is not a preview', () => {
    expect(attachmentFallbackCandidates('asset-1.png')).toEqual([]);
    expect(attachmentFallbackCandidates()).toEqual([]);
  });
});
