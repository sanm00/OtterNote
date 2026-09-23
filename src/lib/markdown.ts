export function displayTitle(title: string) {
  return title.trim() || 'Untitled Note';
}

export function titleFromFirstLine(content: string) {
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const title = firstLine.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return title.slice(0, 80);
}

export function buildNoteMarkdown(title: string, content: string) {
  const body = content.replace(/\s+$/, '');
  const heading = `# ${displayTitle(title)}`;
  return body ? `${heading}\n\n${body}\n` : `${heading}\n`;
}

export function buildExportFileName(title: string) {
  const normalized = displayTitle(title)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = normalized || 'Untitled Note';
  return `${safe}.md`;
}

/**
 * Restricts markdown link and image targets to schemes the app can render
 * safely. Unknown schemes, including `javascript:`, are stripped.
 */
export function markdownUrlTransform(url: string) {
  if (url.startsWith('data:image/')) {
    return url;
  }

  if (url.startsWith('blob:')) {
    return url;
  }

  if (url.startsWith('attachment://')) {
    return url;
  }

  const colon = url.indexOf(':');
  const questionMark = url.indexOf('?');
  const numberSign = url.indexOf('#');
  const slash = url.indexOf('/');

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign)
  ) {
    return url;
  }

  const protocol = url.slice(0, colon).toLowerCase();
  if (['http', 'https', 'mailto', 'xmpp', 'irc', 'ircs'].includes(protocol)) {
    return url;
  }

  return '';
}
