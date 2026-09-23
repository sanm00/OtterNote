import { describe, expect, it } from 'vitest';
import type { Note } from '../store';
import {
  buildBacklinks,
  collectTags,
  extractTags,
  extractWikiLinks,
  findNoteByTitle,
  frontTags,
  isTagLine,
  normalizeTag,
  removeTagFromContent,
  setFrontTags,
} from './tags';

const note = (id: string, title: string, content = '', updatedAt = '2026-09-01T00:00:00.000Z'): Note => ({
  id,
  title,
  content,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt,
});

describe('extractTags', () => {
  it('reads inline tags', () => {
    expect(extractTags('ship the planner #product #roadmap')).toEqual(['product', 'roadmap']);
  });

  it('supports nested and dashed tags', () => {
    expect(extractTags('see #product/planner and #deep-work')).toEqual(['product/planner', 'deep-work']);
  });

  it('ignores markdown headings', () => {
    expect(extractTags('# Heading\n## Another\n#real')).toEqual(['real']);
  });

  it('deduplicates repeated tags', () => {
    expect(extractTags('#a #a #a')).toEqual(['a']);
  });
});

describe('extractWikiLinks', () => {
  it('reads wiki links and trims them', () => {
    expect(extractWikiLinks('see [[ Release plan ]] and [[Daily note]]')).toEqual([
      'Release plan',
      'Daily note',
    ]);
  });

  it('ignores empty links', () => {
    expect(extractWikiLinks('[[]]')).toEqual([]);
  });
});

describe('collectTags', () => {
  it('counts by frequency then alphabetically', () => {
    const counts = collectTags(['#product #plan', '#product', '#alpha']);

    expect(counts).toEqual([
      { tag: 'product', count: 2 },
      { tag: 'alpha', count: 1 },
      { tag: 'plan', count: 1 },
    ]);
  });
});

describe('buildBacklinks', () => {
  const notes = [
    note('n1', 'Product plan', 'Self reference [[Product plan]]'),
    note('n2', 'Standup', 'Follow up on [[Product plan]] tomorrow', '2026-09-10T00:00:00.000Z'),
    note('n3', 'Unrelated', 'nothing here'),
  ];

  it('finds notes that link to the target', () => {
    const links = buildBacklinks(notes, 'n1');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ noteId: 'n2', title: 'Standup' });
    expect(links[0].snippet).toContain('Follow up on');
  });

  it('returns nothing when no note links to the target', () => {
    expect(buildBacklinks(notes, 'n3')).toHaveLength(0);
  });
});

describe('findNoteByTitle', () => {
  it('matches case-insensitively', () => {
    expect(findNoteByTitle([note('n1', 'Product plan')], 'product PLAN')?.id).toBe('n1');
    expect(findNoteByTitle([note('n1', 'Product plan')], 'missing')).toBeUndefined();
  });
});

describe('normalizeTag', () => {
  it('strips leading hashes and trailing whitespace', () => {
    expect(normalizeTag('  #product ')).toBe('product');
    expect(normalizeTag('##deep-work')).toBe('deep-work');
    expect(normalizeTag('  ')).toBe('');
  });
});

describe('frontTags / setFrontTags', () => {
  it('reads tags from the first line only', () => {
    expect(frontTags('#product #planner\nSome body text')).toEqual(['product', 'planner']);
    expect(frontTags('Some body text')).toEqual([]);
    expect(frontTags('# heading\nbody #inline')).toEqual([]);
  });

  it('recognises pure tag lines', () => {
    expect(isTagLine('#a #b/c')).toBe(true);
    expect(isTagLine('# heading')).toBe(false);
    expect(isTagLine('plain text')).toBe(false);
    expect(isTagLine('#a trailing words')).toBe(false);
  });

  it('prepends a tag line before a heading', () => {
    const next = setFrontTags('# Product plan\n\nBody', ['product']);
    expect(next).toBe('#product\n\n# Product plan\n\nBody');
    expect(frontTags(next)).toEqual(['product']);
  });

  it('replaces an existing tag line and dedupes', () => {
    const next = setFrontTags('#old #stale\nBody text', ['new', 'new ', '#added']);
    expect(next).toBe('#new #added\n\nBody text');
  });

  it('removes the tag line when tags run out', () => {
    const next = setFrontTags('#product\n\n# Heading\n- [ ] task', []);
    expect(next).toBe('# Heading\n- [ ] task');
    expect(isTagLine(next.split('\n')[0])).toBe(false);
  });

  it('keeps task lines and body untouched', () => {
    const body = '- [ ] buy coffee\n\nnotes #tag';
    const next = setFrontTags(body, ['life']);
    expect(next).toBe('#life\n\n' + body);
    expect(frontTags(next)).toEqual(['life']);
  });

  it('round-trips through setFrontTags', () => {
    const original = 'Empty-ish note';
    const tagged = setFrontTags(original, ['a', 'b/c']);
    expect(frontTags(tagged)).toEqual(['a', 'b/c']);
    expect(setFrontTags(tagged, [])).toBe(original);
  });

  it('removes a tag from the front line only', () => {
    const next = removeTagFromContent('#bug #生产\n\nSome text', 'bug');
    expect(next).toBe('#生产\n\nSome text');
    expect(extractTags(next)).toEqual(['生产']);
  });

  it('removes an inline tag occurrence', () => {
    const next = removeTagFromContent('Hit a #bug, then #production', 'bug');
    expect(next).toBe('Hit a , then #production');
    expect(extractTags(next)).toEqual(['production']);
  });

  it('removes a tag whose name is a prefix of another tag', () => {
    const next = removeTagFromContent('#bug #bugfix', 'bug');
    expect(next).toBe('#bugfix');
  });

  it('drops the emptied front line', () => {
    const next = removeTagFromContent('#bug\n\n# Heading\n- [ ] task', 'bug');
    expect(next).toBe('# Heading\n- [ ] task');
  });
});
