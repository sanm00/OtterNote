import type { Note } from '../store';
import { displayTitle } from './markdown';

/** `#tag`, `#nested/tag` — never markdown headings, which require a space after `#`. */
const tagPattern = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;
const wikiLinkPattern = /\[\[([^\]\n]+)\]\]/g;

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of content.matchAll(tagPattern)) {
    tags.add(match[2]);
  }
  return [...tags];
}

/** Strips leading `#`, whitespace and trailing separators from a raw tag input. */
export function normalizeTag(input: string): string {
  return input
    .trim()
    .replace(/^#+/, '')
    .replace(/[\s,]+$/, '')
    .trim();
}

/** Dedupes and orders tags for the front line, preserving first-seen order. */
export function canonicalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function extractWikiLinks(content: string): string[] {
  return [...content.matchAll(wikiLinkPattern)]
    .map((match) => match[1].trim())
    .filter((value) => value.length > 0);
}

export type TagCount = { tag: string; count: number };

/** Tag frequency across a list of markdown texts (usually note bodies). */
export function collectTags(texts: string[]): TagCount[] {
  const counts = new Map<string, number>();
  texts.forEach((text) => {
    extractTags(text).forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export type Backlink = {
  noteId: string;
  title: string;
  snippet: string;
  at: string;
};

function snippetForLink(content: string, title: string): string {
  const line = content
    .split('\n')
    .find((item) => extractWikiLinks(item).some((link) => link.toLowerCase() === title.toLowerCase()));

  return (line ?? '')
    .replace(/^#{1,6}\s*/, '')
    .trim()
    .slice(0, 160);
}

/** Notes (other than the target) that reference `targetNoteId` via `[[Title]]`. */
export function buildBacklinks(notes: Note[], targetNoteId: string): Backlink[] {
  const target = notes.find((note) => note.id === targetNoteId);
  if (!target) {
    return [];
  }

  const targetTitle = displayTitle(target.title);

  return notes
    .filter((note) => note.id !== targetNoteId)
    .filter((note) =>
      extractWikiLinks(note.content).some((link) => link.toLowerCase() === targetTitle.toLowerCase()),
    )
    .map((note) => ({
      noteId: note.id,
      title: displayTitle(note.title),
      snippet: snippetForLink(note.content, targetTitle),
      at: note.updatedAt,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Case-insensitive note lookup used to turn `[[Title]]` into a real link. */
export function findNoteByTitle(notes: Note[], title: string): Note | undefined {
  const normalized = title.trim().toLowerCase();
  return notes.find((note) => displayTitle(note.title).toLowerCase() === normalized);
}

const tagLinePattern = /^\s*((?:#[^\s#]+)(?:\s+#[^\s#]+)*)\s*$/;

/** True when `line` is purely a tag front line such as `#产品 #规划`. */
export function isTagLine(line: string): boolean {
  return tagLinePattern.test(line);
}

/** Tags declared on the note's front line, in order. Empty when none. */
export function frontTags(content: string): string[] {
  const first = content.split('\n', 1)[0] ?? '';
  if (!isTagLine(first)) {
    return [];
  }

  return [...first.matchAll(/#([^\s#]+)/g)].map((match) => match[1]);
}

/**
 * Rewrites the note body so its first line carries exactly `tags`. The line is
 * added, replaced, or removed; the rest of the body (including any `# heading`
 * and task lines) is left untouched.
 */
export function setFrontTags(content: string, tags: string[]): string {
  const canonical = canonicalizeTags(tags);
  const lines = content.split('\n');
  const hasTagFront = lines.length > 0 && isTagLine(lines[0]);
  const body = hasTagFront ? lines.slice(1) : lines;

  // Drop a single blank separator left behind by removing the old front line.
  if (hasTagFront && body.length > 0 && body[0].trim() === '') {
    body.shift();
  }

  if (canonical.length === 0) {
    return body.join('\n');
  }

  const tagLine = canonical.map((tag) => `#${tag}`).join(' ');
  return [tagLine, '', ...body].join('\n');
}

/**
 * Removes every occurrence of `#tag` from a note body (front line and inline).
 * When the front line becomes empty the spare blank separator is dropped too.
 */
export function removeTagFromContent(content: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const token = new RegExp(`(^|\\s)#${escaped}(?![\\p{L}\\p{N}_/-])`, 'gu');
  const stripped = content.replace(token, '$1');

  const rebuilt = setFrontTags(stripped, frontTags(stripped));
  const lines = rebuilt.split('\n');
  if (lines[0] === '') {
    while (lines.length > 0 && lines[0] === '') {
      lines.shift();
    }
  }
  return lines.join('\n').trimEnd();
}
