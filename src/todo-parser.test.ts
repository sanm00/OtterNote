import { describe, expect, it } from 'vitest';
import { parseTodosFromContent, removeTodoFromContent, updateTodoStatusInContent } from './todo-parser';

describe('parseTodosFromContent', () => {
  it('extracts markdown todo lines', () => {
    expect(parseTodosFromContent('- [ ] Check token\n- [x] Done')).toEqual([
      { title: 'Check token', status: 'todo' },
      { title: 'Done', status: 'done' },
    ]);
  });

  it('ignores normal note content', () => {
    expect(parseTodosFromContent('Investigated login issue.')).toEqual([]);
  });
});

describe('updateTodoStatusInContent', () => {
  it('updates the requested markdown todo line', () => {
    expect(updateTodoStatusInContent('- [ ] Check token\n- [x] Done', 0, 'done')).toBe(
      '- [x] Check token\n- [x] Done',
    );
  });

  it('preserves list marker and indentation', () => {
    expect(updateTodoStatusInContent('  * [x] Nested task', 0, 'todo')).toBe('  * [ ] Nested task');
  });

  it('uses occurrence order for duplicate titles', () => {
    expect(updateTodoStatusInContent('- [ ] Same\n- [ ] Same', 1, 'done')).toBe('- [ ] Same\n- [x] Same');
  });
});

describe('removeTodoFromContent', () => {
  it('removes the requested markdown todo line', () => {
    expect(removeTodoFromContent('Intro\n- [ ] Check token\nOutro', 0)).toBe('Intro\nOutro');
  });

  it('uses occurrence order for duplicate todo titles', () => {
    expect(removeTodoFromContent('- [ ] Same\n- [x] Same\nDone', 1)).toBe('- [ ] Same\nDone');
  });
});
