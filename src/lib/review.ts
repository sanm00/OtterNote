import type { Note, Todo } from '../store';
import { coversDay, eachDay, formatDayHeading, isWithinRange, todayKey, type DateRange } from './dates';
import { translate, type Locale } from './i18n';
import { displayTitle } from './markdown';

export type RecapEventKind = 'created' | 'edited' | 'completed';

export type RecapEvent = {
  id: string;
  kind: RecapEventKind;
  title: string;
  /** First meaningful line of the note body, used as a one-line preview. */
  detail?: string;
  noteId: string;
  /** ISO timestamp used for chronological ordering inside a day. */
  at: string;
  /** Scheduled due date of a completed todo. */
  due?: string;
  /** True when a completed todo finished after its due date. */
  overdue?: boolean;
};

export type RecapDay = {
  date: string;
  events: RecapEvent[];
};

export type Recap = {
  range: DateRange;
  days: RecapDay[];
  createdCount: number;
  editedCount: number;
  completedCount: number;
  noteIds: string[];
  /** Scheduled todos whose due date falls inside the range. */
  scheduledInRange: number;
  /** Of those, how many were completed on or before their due date. */
  achievedInRange: number;
};

export type BuildRecapInput = {
  notes: Note[];
  todos: Todo[];
  range: DateRange;
};

function localDay(value: string): string {
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** First meaningful line of a markdown body, stripped of markup noise. */
export function contentPreview(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0) ?? '';
  return firstLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '')
    .replace(/^\s*[-*>]\s*/, '')
    .trim()
    .slice(0, 120);
}

/** Days a note was created on. */
export function notesCreatedOn(notes: Note[], day: string): Note[] {
  return notes.filter((note) => localDay(note.createdAt) === day);
}

export function buildRecap({ notes, todos, range }: BuildRecapInput): Recap {
  const buckets = new Map<string, RecapEvent[]>();
  const push = (day: string, event: RecapEvent) => {
    const bucket = buckets.get(day);
    if (bucket) {
      bucket.push(event);
      return;
    }
    buckets.set(day, [event]);
  };

  const touchedNoteIds = new Set<string>();

  notes.forEach((note) => {
    const createdDay = localDay(note.createdAt);
    const updatedDay = localDay(note.updatedAt);
    const detail = contentPreview(note.content) || undefined;

    if (isWithinRange(createdDay, range)) {
      push(createdDay, {
        id: `created:${note.id}`,
        kind: 'created',
        title: displayTitle(note.title),
        detail,
        noteId: note.id,
        at: note.createdAt,
      });
      touchedNoteIds.add(note.id);
    }

    // Editing is a secondary signal: it only shows up when the note itself
    // was created before the range.
    if (updatedDay !== createdDay && isWithinRange(updatedDay, range)) {
      push(updatedDay, {
        id: `edited:${note.id}`,
        kind: 'edited',
        title: displayTitle(note.title),
        detail,
        noteId: note.id,
        at: note.updatedAt,
      });
      touchedNoteIds.add(note.id);
    }
  });

  todos.forEach((todo) => {
    if (todo.status !== 'done' || !todo.completedAt) {
      return;
    }

    const day = localDay(todo.completedAt);
    if (!isWithinRange(day, range)) {
      return;
    }

    push(day, {
      id: `todo:${todo.id}`,
      kind: 'completed',
      title: todo.title,
      noteId: todo.noteId ?? '',
      due: todo.due,
      overdue: Boolean(todo.due) && day > todo.due!,
      at: todo.completedAt,
    });
  });

  const days = eachDay(range).map((date) => ({
    date,
    events: (buckets.get(date) ?? []).slice().sort((a, b) => {
      const group = (kind: RecapEventKind) => (kind === 'completed' ? 0 : 1);
      return group(a.kind) - group(b.kind) || a.at.localeCompare(b.at);
    }),
  }));

  return {
    range,
    days,
    createdCount: days.reduce(
      (total, day) => total + day.events.filter((event) => event.kind === 'created').length,
      0,
    ),
    editedCount: days.reduce(
      (total, day) => total + day.events.filter((event) => event.kind === 'edited').length,
      0,
    ),
    completedCount: days.reduce(
      (total, day) => total + day.events.filter((event) => event.kind === 'completed').length,
      0,
    ),
    noteIds: [...touchedNoteIds],
    ...scheduleAchievement(todos, range),
  };
}

/**
 * How well scheduled work landed on time inside `range`: todos due in the
 * window, and how many of them were finished no later than their due date.
 */
export function scheduleAchievement(
  todos: Todo[],
  range: Pick<DateRange, 'start' | 'end'>,
): { scheduledInRange: number; achievedInRange: number } {
  let scheduledInRange = 0;
  let achievedInRange = 0;

  todos.forEach((todo) => {
    const due = todo.due ?? todo.start;
    if (!due || !isWithinRange(due, range)) {
      return;
    }

    scheduledInRange += 1;
    if (todo.status === 'done' && todo.completedAt && localDay(todo.completedAt) <= due) {
      achievedInRange += 1;
    }
  });

  return { scheduledInRange, achievedInRange };
}

export function recapHasEvents(recap: Recap): boolean {
  return recap.days.some((day) => day.events.length > 0);
}

export function todosDueOn(todos: Todo[], day: string): Todo[] {
  return todos.filter((todo) => todo.status !== 'done' && todo.due === day);
}

export function todosOverdue(todos: Todo[], today: string): Todo[] {
  return todos.filter((todo) => todo.status !== 'done' && Boolean(todo.due) && todo.due! < today);
}

/** Multi-day tasks whose span covers `day` without starting on it. */
export function todosContinuingOn(todos: Todo[], day: string): Todo[] {
  return todos.filter(
    (todo) =>
      todo.status !== 'done' &&
      Boolean(todo.start) &&
      (todo.days ?? 1) > 1 &&
      todo.start !== day &&
      coversDay(todo.start!, todo.days, day),
  );
}

/** Multi-day tasks that start on `day`. */
export function todosStartingOn(todos: Todo[], day: string): Todo[] {
  return todos.filter((todo) => todo.status !== 'done' && todo.start === day);
}

export function unscheduledTodos(todos: Todo[]): Todo[] {
  return todos.filter((todo) => todo.status !== 'done' && !todo.start && !todo.due);
}

export type PeriodMetric = 'planned' | 'completed' | 'overdueCompleted' | 'overdueOpen' | 'notes';

export type PeriodStats = {
  range: DateRange;
  metrics: Record<PeriodMetric, number>;
  /** Notes created each day of the range, for a daily bar chart. */
  days: Array<{ date: string; created: number; edited: number; completed: number; overdue: number }>;
  /** Completion health: [on-time, overdue, open] TODO counts among planned-in-window. */
  planSplit: { onTime: number; overdue: number; open: number };
};

export type BuildStatsInput = {
  notes: Note[];
  todos: Todo[];
  range: DateRange;
  /** Reference "today" for overdue status; defaults to the real today. */
  today?: string;
};

/**
 * Period statistics for the dashboard: planned todos, completed todos,
 * overdue (split into completed-late and still-open), and notes created.
 * The daily bucket powers a lightweight CSS bar chart with the split totals.
 */
export function buildStats({ notes, todos, range, today = todayKey() }: BuildStatsInput): PeriodStats {
  const metrics: Record<PeriodMetric, number> = {
    planned: 0,
    completed: 0,
    overdueCompleted: 0,
    overdueOpen: 0,
    notes: 0,
  };
  const days = eachDay(range).map((date) => ({
    date,
    created: 0,
    edited: 0,
    completed: 0,
    overdue: 0,
  }));
  const dayByDate = new Map(days.map((day) => [day.date, day]));

  notes.forEach((note) => {
    const createdDay = localDay(note.createdAt);
    const createdBucket = dayByDate.get(createdDay);
    if (createdBucket) {
      createdBucket.created += 1;
      metrics.notes += 1;
    }

    const updatedDay = localDay(note.updatedAt);
    const updatedBucket = dayByDate.get(updatedDay);
    if (updatedDay !== createdDay && updatedBucket) {
      updatedBucket.edited += 1;
    }
  });

  todos.forEach((todo) => {
    const due = todo.due ?? todo.start ?? '';
    const plannedInWindow = Boolean(due) && isWithinRange(due, range);
    const completedInWindow = Boolean(todo.completedAt) && isWithinRange(localDay(todo.completedAt!), range);
    const completedLate = completedInWindow && Boolean(todo.due) && localDay(todo.completedAt!) > todo.due!;

    if (plannedInWindow) {
      metrics.planned += 1;
      const doneDay = todo.status === 'done' && todo.completedAt ? localDay(todo.completedAt) : '';
      const bucketDay = doneDay && isWithinRange(doneDay, range) ? doneDay : due;
      const bucket = dayByDate.get(bucketDay);
      if (bucket) {
        bucket.overdue += 1;
      }
    }

    if (completedInWindow) {
      metrics.completed += 1;
      const bucket = dayByDate.get(localDay(todo.completedAt!));
      if (bucket) {
        bucket.completed += 1;
      }
      if (completedLate) {
        metrics.overdueCompleted += 1;
      }
    }

    if (todo.status !== 'done' && Boolean(todo.due) && todo.due! < today) {
      metrics.overdueOpen += 1;
    }
  });

  const planSplit = { onTime: 0, overdue: 0, open: 0 };
  todos.forEach((todo) => {
    const due = todo.due ?? todo.start ?? '';
    const doneDay = todo.completedAt ? localDay(todo.completedAt) : '';
    const inWindowByDue = Boolean(due) && isWithinRange(due, range);
    const inWindowByDone = Boolean(doneDay) && isWithinRange(doneDay, range);
    if (!inWindowByDue && !inWindowByDone) {
      return;
    }
    if (todo.status !== 'done') {
      planSplit.open += 1;
      return;
    }
    if (doneDay && Boolean(todo.due) && doneDay > todo.due!) {
      planSplit.overdue += 1;
    } else {
      planSplit.onTime += 1;
    }
  });

  return { range, metrics, days, planSplit };
}

export function buildRecapMarkdown(recap: Recap, locale: Locale): string {
  const lines: string[] = [
    `# ${translate(locale, 'review.title')} · ${recap.range.start} → ${recap.range.end}`,
    '',
    `- ${translate(locale, 'review.created')}: ${recap.createdCount}`,
    `- ${translate(locale, 'review.edited')}: ${recap.editedCount}`,
    `- ${translate(locale, 'review.completed')}: ${recap.completedCount}`,
    `- ${translate(locale, 'review.notesTouched')}: ${recap.noteIds.length}`,
    '',
  ];

  recap.days.forEach((day) => {
    if (day.events.length === 0) {
      return;
    }

    lines.push(`## ${formatDayHeading(day.date, locale)}`);
    day.events.forEach((event) => {
      const prefix = event.kind === 'completed' ? '- [x]' : '-';
      const suffix = event.detail ? ` _(${event.detail})_` : '';
      lines.push(`${prefix} ${event.title}${suffix}`);
    });
    lines.push('');
  });

  return lines.join('\n').trimEnd() + '\n';
}
