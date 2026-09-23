import type { TodoStatus } from './store';

const taskPattern = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;
const taskLinePattern = /^(\s*[-*]\s+\[)( |x|X)(\]\s+)(.+?)(\s*)$/;

export type ParsedTodo = {
  title: string;
  status: TodoStatus;
};

export function isTaskLine(line: string): boolean {
  return taskPattern.test(line);
}

/** Title text of a task line, or `null` when the line is not a task. */
export function todoTitleInLine(line: string): string | null {
  return taskPattern.exec(line)?.[2].trim() ?? null;
}

export function parseTodosFromContent(content: string): ParsedTodo[] {
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

export function updateTodoStatusInContent(content: string, occurrenceIndex: number, status: TodoStatus) {
  let taskLineIndex = -1;
  const nextMarker = status === 'done' ? 'x' : ' ';

  return content
    .split('\n')
    .map((line) => {
      const match = taskLinePattern.exec(line);
      if (!match) {
        return line;
      }

      taskLineIndex += 1;
      if (taskLineIndex !== occurrenceIndex) {
        return line;
      }

      return `${match[1]}${nextMarker}${match[3]}${match[4]}${match[5]}`;
    })
    .join('\n');
}

export function removeTodoFromContent(content: string, occurrenceIndex: number) {
  let taskLineIndex = -1;

  return content
    .split('\n')
    .filter((line) => {
      if (!taskLinePattern.test(line)) {
        return true;
      }

      taskLineIndex += 1;
      return taskLineIndex !== occurrenceIndex;
    })
    .join('\n');
}
