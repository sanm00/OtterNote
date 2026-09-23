import type { Todo, TodoPriority } from '../store';

export const priorityOrder: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

/** High priority first, then oldest first; unsorted items go last. */
export function sortByPriority(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const left = a.priority ? priorityOrder[a.priority] : 3;
    const right = b.priority ? priorityOrder[b.priority] : 3;
    return left - right || a.createdAt.localeCompare(b.createdAt);
  });
}
