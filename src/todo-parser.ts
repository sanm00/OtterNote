import type { TodoStatus } from './store';

const taskPattern = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;

export type ParsedTodo = {
  title: string;
  status: TodoStatus;
};

export function parseTodosFromEntry(content: string): ParsedTodo[] {
  return content
    .split('\n')
    .map((line) => {
      const match = taskPattern.exec(line);
      if (!match) return null;
      return {
        title: match[2].trim(),
        status: match[1] === ' ' ? 'todo' : 'done',
      } satisfies ParsedTodo;
    })
    .filter((item): item is ParsedTodo => item !== null && item.title.length > 0);
}
