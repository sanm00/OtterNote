import type { TodoStatus } from './store';

const taskPattern = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;
const taskLinePattern = /^(\s*[-*]\s+\[)( |x|X)(\]\s+)(.+?)(\s*)$/;

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

export function updateTodoStatusInEntryContent(
  content: string,
  occurrenceIndex: number,
  status: TodoStatus,
) {
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

export function removeTodoFromEntryContent(content: string, occurrenceIndex: number) {
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
