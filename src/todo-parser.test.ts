import { describe, expect, it } from 'vitest';
import { parseTodosFromEntry } from './todo-parser';

describe('parseTodosFromEntry', () => {
  it('extracts markdown todo lines', () => {
    expect(parseTodosFromEntry('- [ ] Check token\n- [x] Done')).toEqual([
      { title: 'Check token', status: 'todo' },
      { title: 'Done', status: 'done' },
    ]);
  });

  it('ignores normal note content', () => {
    expect(parseTodosFromEntry('Investigated login issue.')).toEqual([]);
  });
});
