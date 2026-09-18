import { extractFileExtension } from './files';

export function extractAttachmentReferences(content: string) {
  const refs: string[] = [];
  let remaining = content;

  while (true) {
    const index = remaining.indexOf('attachment://');
    if (index < 0) break;

    const after = remaining.slice(index + 'attachment://'.length);
    const match = after.match(/^[A-Za-z0-9._-]+/);
    if (match?.[0]) {
      refs.push(match[0]);
      remaining = after.slice(match[0].length);
    } else {
      remaining = after.slice(1);
    }
  }

  return refs;
}

export function attachmentFallbackCandidates(fileName?: string, fallbackFileName?: string) {
  const candidates: string[] = [];

  if (fallbackFileName && fallbackFileName !== fileName) {
    candidates.push(fallbackFileName);
  }

  if (fileName) {
    const previewIndex = fileName.indexOf('.preview.');
    if (previewIndex > 0) {
      const base = fileName.slice(0, previewIndex);
      const currentExt = extractFileExtension(fileName);
      const extensions = [currentExt, 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].filter(Boolean);
      for (const ext of extensions) {
        candidates.push(`${base}.original.${ext}`);
      }
    }
  }

  return Array.from(new Set(candidates));
}
