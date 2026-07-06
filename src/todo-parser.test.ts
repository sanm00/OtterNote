import { describe, expect, it } from 'vitest';
import { parseTodosFromEntry, removeTodoFromEntryContent, updateTodoStatusInEntryContent } from './todo-parser';

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

describe('updateTodoStatusInEntryContent', () => {
  it('updates the requested markdown todo line', () => {
    expect(updateTodoStatusInEntryContent('- [ ] Check token\n- [x] Done', 0, 'done')).toBe(
      '- [x] Check token\n- [x] Done',
    );
  });

  it('preserves list marker and indentation', () => {
    expect(updateTodoStatusInEntryContent('  * [x] Nested task', 0, 'todo')).toBe('  * [ ] Nested task');
  });

  it('uses occurrence order for duplicate titles', () => {
    expect(updateTodoStatusInEntryContent('- [ ] Same\n- [ ] Same', 1, 'done')).toBe('- [ ] Same\n- [x] Same');
  });
});

describe('removeTodoFromEntryContent', () => {
  it('removes the requested markdown todo line', () => {
    expect(removeTodoFromEntryContent('Intro\n- [ ] Check token\nOutro', 0)).toBe('Intro\nOutro');
  });

  it('uses occurrence order for duplicate todo titles', () => {
    expect(removeTodoFromEntryContent('- [ ] Same\n- [x] Same\nDone', 1)).toBe('- [ ] Same\nDone');
  });
});
