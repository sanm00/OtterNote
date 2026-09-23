import { describe, expect, it } from 'vitest';
import type { Note, Todo } from '../store';
import type { DateRange } from './dates';
import {
  buildRecap,
  buildRecapMarkdown,
  buildStats,
  contentPreview,
  notesCreatedOn,
  todosContinuingOn,
  todosDueOn,
  todosOverdue,
  unscheduledTodos,
} from './review';

const RANGE: DateRange = { start: '2026-09-07', end: '2026-09-13', preset: 'lastWeek' };

const note = (id: string, title: string, createdAt: string, extra: Partial<Note> = {}): Note => ({
  id,
  title,
  content: '',
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

const todo = (id: string, title: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  title,
  status: 'todo',
  source: 'standalone',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...extra,
});

describe('contentPreview', () => {
  it('strips markdown markers', () => {
    expect(contentPreview('## Ship it')).toBe('Ship it');
    expect(contentPreview('- [ ] write the plan')).toBe('write the plan');
    expect(contentPreview('> quoted')).toBe('quoted');
  });

  it('skips leading blank lines', () => {
    expect(contentPreview('\n\n   \nReal content')).toBe('Real content');
  });
});

describe('notesCreatedOn', () => {
  it('lists notes created on a day', () => {
    const notes = [
      note('n1', 'One', '2026-09-20T03:00:00.000Z'),
      note('n2', 'Two', '2026-09-19T03:00:00.000Z'),
    ];
    expect(notesCreatedOn(notes, '2026-09-20').map((item) => item.id)).toEqual(['n1']);
  });
});

describe('buildRecap', () => {
  const notes = [
    note('n1', 'Planner', '2026-09-08T02:00:00.000Z', { content: 'Design review notes' }),
    note('n2', 'Old planner', '2026-08-01T00:00:00.000Z', {
      content: 'Edited later',
      updatedAt: '2026-09-10T05:00:00.000Z',
    }),
    note('n3', 'Ancient', '2026-08-02T00:00:00.000Z', { content: 'Outside the range' }),
  ];
  const todos = [
    todo('t1', 'Ship OIDC', { status: 'done', completedAt: '2026-09-11T09:41:00.000Z' }),
    todo('t2', 'Still open', { status: 'todo', due: '2026-09-11' }),
    todo('t3', 'Completed outside', { status: 'done', completedAt: '2026-08-20T00:00:00.000Z' }),
  ];

  const recap = buildRecap({ notes, todos, range: RANGE });

  it('buckets every day of the range', () => {
    expect(recap.days).toHaveLength(7);
    expect(recap.days[0].date).toBe('2026-09-07');
    expect(recap.days[6].date).toBe('2026-09-13');
  });

  it('counts created notes, edits and completed todos', () => {
    expect(recap.createdCount).toBe(1);
    expect(recap.editedCount).toBe(1);
    expect(recap.completedCount).toBe(1);
    expect(recap.noteIds).toEqual(['n1', 'n2']);
  });

  it('places events on the right day', () => {
    const byDate = new Map(recap.days.map((day) => [day.date, day.events]));
    expect(byDate.get('2026-09-08')?.map((event) => event.kind)).toEqual(['created']);
    expect(byDate.get('2026-09-10')?.map((event) => event.kind)).toEqual(['edited']);
    expect(byDate.get('2026-09-11')?.map((event) => event.kind)).toEqual(['completed']);
    expect(byDate.get('2026-09-12')).toEqual([]);
  });

  it('ignores notes and todos outside the range', () => {
    const ids = recap.days.flatMap((day) => day.events.map((event) => event.id));
    expect(ids).not.toContain('created:n3');
    expect(ids).not.toContain('edited:n3');
    expect(ids).not.toContain('todo:t3');
    expect(ids).not.toContain('todo:t2');
  });

  it('sorts a day chronologically', () => {
    const day = recap.days.find((item) => item.date === '2026-09-08');
    expect(day?.events.map((event) => event.id)).toEqual(['created:n1']);
  });

  it('lists completed todos before note events on the same day', () => {
    const mixed = buildRecap({
      notes: [note('n1', 'Planner', '2026-09-11T06:00:00.000Z', { content: 'Morning' })],
      todos: [todo('t1', 'Ship OIDC', { status: 'done', completedAt: '2026-09-11T09:41:00.000Z' })],
      range: RANGE,
    });
    const day = mixed.days.find((item) => item.date === '2026-09-11');
    expect(day?.events.map((event) => event.kind)).toEqual(['completed', 'created']);
  });

  it('exports markdown for both locales', () => {
    const en = buildRecapMarkdown(recap, 'en');
    const zh = buildRecapMarkdown(recap, 'zh');
    expect(en).toContain('# Review');
    expect(en).toContain('- [x] Ship OIDC');
    expect(en).toContain('Design review notes');
    expect(zh).toContain('# 回顾');
    expect(zh).not.toBe(en);
  });
});

describe('todo buckets', () => {
  const todos = [
    todo('t1', 'Due today', { due: '2026-09-20' }),
    todo('t2', 'Overdue', { due: '2026-09-18' }),
    todo('t3', 'Spanning', { start: '2026-09-18', days: 5, due: '2026-09-22' }),
    todo('t4', 'Unscheduled'),
    todo('t5', 'Done today', { status: 'done', completedAt: '2026-09-20T10:00:00.000Z', due: '2026-09-20' }),
  ];

  it('lists todos due on a day', () => {
    expect(todosDueOn(todos, '2026-09-20').map((item) => item.id)).toEqual(['t1']);
    expect(todosDueOn(todos, '2026-09-22').map((item) => item.id)).toEqual(['t3']);
  });

  it('lists overdue todos', () => {
    expect(todosOverdue(todos, '2026-09-20').map((item) => item.id)).toEqual(['t2']);
  });

  it('lists multi-day tasks continuing on a day, excluding their start', () => {
    expect(todosContinuingOn(todos, '2026-09-20').map((item) => item.id)).toEqual(['t3']);
    expect(todosContinuingOn(todos, '2026-09-18')).toEqual([]);
  });

  it('lists unscheduled todos', () => {
    expect(unscheduledTodos(todos).map((item) => item.id)).toEqual(['t4']);
  });
});

describe('buildStats', () => {
  const range: DateRange = { start: '2026-09-07', end: '2026-09-13', preset: 'lastWeek' };

  it('counts notes created in the window and buckets them daily', () => {
    const stats = buildStats({
      notes: [
        note('n1', 'One', '2026-09-08T03:00:00.000Z'),
        note('n2', 'Two', '2026-09-08T04:00:00.000Z'),
        note('n3', 'Outside', '2026-09-20T03:00:00.000Z'),
        note('n4', 'Edited', '2026-09-01T00:00:00.000Z', { updatedAt: '2026-09-10T09:00:00.000Z' }),
      ],
      todos: [],
      range,
    });
    expect(stats.metrics.notes).toBe(2);
    expect(stats.metrics.planned).toBe(0);
    expect(stats.days.find((day) => day.date === '2026-09-08')?.created).toBe(2);
    expect(stats.days.find((day) => day.date === '2026-09-10')?.edited).toBe(1);
    expect(stats.days).toHaveLength(7);
  });

  it('counts planned, completed and overdue-split todos', () => {
    const stats = buildStats({
      notes: [],
      todos: [
        todo('t1', 'Due tomorrow', { due: '2026-09-10' }),
        todo('t2', 'Completed on time', {
          status: 'done',
          due: '2026-09-10',
          completedAt: '2026-09-10T10:00:00.000Z',
        }),
        todo('t3', 'Completed late', {
          status: 'done',
          due: '2026-09-09',
          completedAt: '2026-09-11T10:00:00.000Z',
        }),
        todo('t4', 'Overdue & open', { due: '2026-09-05' }),
        todo('t5', 'Not in window', { due: '2026-09-20' }),
      ],
      range,
      today: '2026-09-10',
    });
    expect(stats.metrics.planned).toBe(3); // t1, t2, t3 due inside window
    expect(stats.metrics.completed).toBe(2); // t2, t3
    expect(stats.metrics.overdueCompleted).toBe(1); // t3
    expect(stats.metrics.overdueOpen).toBe(1); // t4
    expect(stats.planSplit).toEqual({ onTime: 1, overdue: 1, open: 1 });
  });

  it('buckets planned todos on their due day', () => {
    const stats = buildStats({
      notes: [],
      todos: [todo('t1', 'Planned', { due: '2026-09-12' })],
      range,
    });
    expect(stats.days.find((day) => day.date === '2026-09-12')?.overdue).toBe(1);
  });
});
