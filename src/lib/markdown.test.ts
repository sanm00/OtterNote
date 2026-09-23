import { describe, expect, it } from 'vitest';
import {
  buildExportFileName,
  buildNoteMarkdown,
  displayTitle,
  markdownUrlTransform,
  titleFromFirstLine,
} from './markdown';

describe('markdownUrlTransform', () => {
  it('keeps relative paths and http(s) links', () => {
    expect(markdownUrlTransform('/images/a.png')).toBe('/images/a.png');
    expect(markdownUrlTransform('./a.png')).toBe('./a.png');
    expect(markdownUrlTransform('https://example.com/a')).toBe('https://example.com/a');
    expect(markdownUrlTransform('http://example.com')).toBe('http://example.com');
  });

  it('keeps mail and chat schemes', () => {
    expect(markdownUrlTransform('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    expect(markdownUrlTransform('xmpp:someone@example.com')).toBe('xmpp:someone@example.com');
  });

  it('keeps image data and blob urls', () => {
    expect(markdownUrlTransform('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(markdownUrlTransform('blob:http://localhost/1234')).toBe('blob:http://localhost/1234');
  });

  it('keeps attachment references handled by the app', () => {
    expect(markdownUrlTransform('attachment://asset-1.preview.png')).toBe('attachment://asset-1.preview.png');
  });

  it('strips non-image data urls', () => {
    expect(markdownUrlTransform('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('strips executable and unknown schemes', () => {
    expect(markdownUrlTransform('javascript:alert(1)')).toBe('');
    expect(markdownUrlTransform('JaVaScRiPt:alert(1)')).toBe('');
    expect(markdownUrlTransform('vbscript:msgbox(1)')).toBe('');
    expect(markdownUrlTransform('file:///etc/passwd')).toBe('');
    expect(markdownUrlTransform('tauri://localhost')).toBe('');
    expect(markdownUrlTransform('foo:bar')).toBe('');
  });

  it('does not treat a colon inside a path or query as a scheme', () => {
    expect(markdownUrlTransform('path/file:name.png')).toBe('path/file:name.png');
    expect(markdownUrlTransform('https://example.com?next=a:b')).toBe('https://example.com?next=a:b');
    expect(markdownUrlTransform('https://example.com#a:b')).toBe('https://example.com#a:b');
  });
});

describe('displayTitle', () => {
  it('falls back to a placeholder for empty titles', () => {
    expect(displayTitle('')).toBe('Untitled Note');
    expect(displayTitle('   ')).toBe('Untitled Note');
  });

  it('trims surrounding whitespace', () => {
    expect(displayTitle('  Shopping list  ')).toBe('Shopping list');
  });
});

describe('titleFromFirstLine', () => {
  it('strips leading markdown decoration', () => {
    expect(titleFromFirstLine('# Shopping list')).toBe('Shopping list');
    expect(titleFromFirstLine('- [ ] Buy milk')).toBe('Buy milk');
  });

  it('truncates very long titles', () => {
    expect(titleFromFirstLine('a'.repeat(200))).toHaveLength(80);
  });

  it('returns an empty string when there is nothing usable', () => {
    expect(titleFromFirstLine('')).toBe('');
    expect(titleFromFirstLine('---')).toBe('');
  });
});

describe('buildExportFileName', () => {
  it('replaces characters that are invalid in file names', () => {
    expect(buildExportFileName('Notes/2026: plans?')).toBe('Notes-2026- plans-.md');
  });

  it('falls back to a default name', () => {
    expect(buildExportFileName('   ')).toBe('Untitled Note.md');
  });
});

describe('buildNoteMarkdown', () => {
  it('renders the title followed by the body', () => {
    expect(buildNoteMarkdown('Shopping list', 'Milk\nBread')).toBe('# Shopping list\n\nMilk\nBread\n');
  });

  it('trims trailing whitespace from the body', () => {
    expect(buildNoteMarkdown('Note', 'line\n\n')).toBe('# Note\n\nline\n');
  });

  it('handles notes without a body', () => {
    expect(buildNoteMarkdown('Empty', '')).toBe('# Empty\n');
  });
});
