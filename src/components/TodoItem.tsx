import React from 'react';
import { daysBetween, formatDayHeading } from '../lib/dates';
import { useI18n } from '../lib/i18n';
import type { Todo } from '../store';

export type TodoItemProps = {
  todo: Todo;
  today: string;
  onToggle: (done: boolean) => void;
  onDelete?: () => void;
  onOpenSource?: () => void;
  sourceTitle?: string;
  draggable?: boolean;
  /** Mouse-down on the grip starts a custom (non-HTML5) schedule drag. */
  onGripMouseDown?: (event: React.MouseEvent) => void;
  /** Extra controls rendered between the badges and the delete button. */
  actions?: React.ReactNode;
};

export function TodoItem({
  todo,
  today,
  onToggle,
  onDelete,
  onOpenSource,
  sourceTitle,
  draggable = false,
  onGripMouseDown,
  actions,
}: TodoItemProps) {
  const { t, locale } = useI18n();
  const done = todo.status === 'done';
  const span = Math.max(1, todo.days ?? 1);
  const overdue = !done && Boolean(todo.due) && todo.due! < today;
  const dueToday = !done && todo.due === today;
  const dayNumber = todo.start ? daysBetween(todo.start, today) + 1 : 0;
  const inProgress = !done && span > 1 && dayNumber >= 1 && dayNumber <= span;

  return (
    <div className={`planning-todo-row ${draggable ? 'is-draggable' : ''}`}>
      {draggable ? (
        <span
          className="ds-grip"
          role="button"
          tabIndex={-1}
          aria-label={t('plan.dragAria', { title: todo.title })}
          onMouseDown={onGripMouseDown}
        >
          ⋮
        </span>
      ) : null}
      <input
        type="checkbox"
        checked={done}
        onChange={(event) => onToggle(event.target.checked)}
        aria-label={todo.title}
      />
      <div className="min-w-0 flex-1">
        <div className={`ds-todo-title ${done ? 'is-done' : ''}`}>{todo.title}</div>
        {(todo.due || done || span > 1 || sourceTitle) && (
          <div className="ds-todo-meta">
            {done && todo.completedAt ? (
              <span className="planning-chip">
                {t('todos.completedOn', { date: formatDayHeading(todo.completedAt.slice(0, 10), locale) })}
              </span>
            ) : todo.due ? (
              <span
                className={`planning-chip ${overdue ? 'planning-chip-late' : dueToday ? 'planning-chip-due' : ''}`}
              >
                {overdue
                  ? t('todos.overdueBy', { n: Math.abs(daysBetween(todo.due, today)) })
                  : t('todos.due', { date: formatDayHeading(todo.due, locale) })}
              </span>
            ) : null}
            {span > 1 ? (
              <span className="planning-chip planning-chip-plan">{t('calendar.days', { n: span })}</span>
            ) : null}
            {inProgress ? (
              <span className="planning-chip planning-chip-ongoing">
                {t('review.dayN', { n: dayNumber, total: span })}
              </span>
            ) : null}
            {sourceTitle && onOpenSource ? (
              <button type="button" className="planning-source-link" onClick={onOpenSource}>
                {sourceTitle}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {actions || onDelete ? (
        <div className="ds-todo-tools">
          {actions}
          {onDelete ? (
            <button
              type="button"
              className="todo-delete-button"
              aria-label={`Delete ${todo.title}`}
              onClick={onDelete}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
