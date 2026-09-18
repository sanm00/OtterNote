export function extractFileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function extractFileExtension(fileName: string) {
  const index = fileName.lastIndexOf('.');
  if (index < 0 || index === fileName.length - 1) return '';
  return fileName.slice(index + 1).toLowerCase();
}

export function extractAltText(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '') || 'image';
}

export function imageExtensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'png';
  }
}

export function mimeTypeFromFileName(fileName: string) {
  switch (extractFileExtension(fileName).toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'image/png';
  }
}

export function isImageFileName(fileName: string) {
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(extractFileExtension(fileName));
}

export function normalizeClipboardImagePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return '';
  }

  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed);
      return decodeURIComponent(url.pathname);
    } catch {
      return decodeURIComponent(trimmed.replace(/^file:\/\//, ''));
    }
  }

  return trimmed;
}

export function formatAttachmentTime(value: string) {
  if (!value) return 'Unknown time';
  const timestamp = Number(value);
  if (Number.isFinite(timestamp)) {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp * 1000));
  }

  return value;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
