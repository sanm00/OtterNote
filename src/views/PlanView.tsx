import React, { useMemo, useRef, useState } from 'react';
import { Page } from '../components/ui';
import { Icon } from '../components/Icon';
import { TodoItem } from '../components/TodoItem';
import { priorityOrder, sortByPriority } from '../lib/todo-order';
import { confirmDeletion } from '../lib/confirm';
import {
  addDays,
  coversDay,
  formatDayHeading,
  formatMonthTitle,
  formatTime,
  formatWeekTitle,
  isToday,
  monthGrid,
  shiftMonth,
  spanRange,
  todayKey,
  weekDays,
  weekdayLabels,
} from '../lib/dates';
import { displayTitle } from '../lib/markdown';
import type { MessageKey } from '../lib/i18n';
import { useI18n } from '../lib/i18n';
import { notesCreatedOn } from '../lib/review';
import { useAppStore, type Todo, type TodoPriority } from '../store';

type CalKind = 'plan' | 'due' | 'late' | 'done';

type CalItem = {
  key: string;
  kind: CalKind;
  title: string;
  todoId: string;
};

type CalBar = {
  todo: Todo;
  start: string;
  end: string;
  days: number;
  done: boolean;
  kind: CalKind;
};

const kindWeight: Record<CalKind, number> = { plan: 0, due: 1, late: 0, done: 2 };

const CHIP_LIMIT = { month: 2, week: 8 };

const SPAN_LIMIT = 365;

const nextPriority: Record<'none' | TodoPriority, TodoPriority | null> = {
  none: 'low',
  low: 'medium',
  medium: 'high',
  high: null,
};

function localDay(value: string): string {
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function PlanView() {
  const { t, locale } = useI18n();
  const notes = useAppStore((state) => state.notes);
  const todos = useAppStore((state) => state.todos);
  const toggleTodo = useAppStore((state) => state.toggleTodo);
  const deleteTodo = useAppStore((state) => state.deleteTodo);
  const scheduleTodo = useAppStore((state) => state.scheduleTodo);
  const setTodoPriority = useAppStore((state) => state.setTodoPriority);
  const openReviewOn = useAppStore((state) => state.openReviewOn);
  const selectNote = useAppStore((state) => state.selectNote);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const captureDraft = useAppStore((state) => state.captureDraft);
  const setCaptureDraft = useAppStore((state) => state.setCaptureDraft);
  const submitQuickTodo = useAppStore((state) => state.submitQuickTodo);
  const captureFocusNonce = useAppStore((state) => state.captureFocusNonce);

  const today = todayKey();
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [drag, setDrag] = useState<{ todo: Todo; x: number; y: number; overDay: string | null } | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const quickRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (captureFocusNonce > 0) {
      quickRef.current?.focus();
    }
  }, [captureFocusNonce]);

  /** Resolve which calendar day a client point sits over, via the rendered cells. */
  const dayAtPoint = (clientX: number, clientY: number): string | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const cell = element?.closest<HTMLElement>('[data-cal-day]');
    return cell?.dataset.calDay ?? null;
  };

  /**
   * Begin a schedule drag (custom mouse-based, since WKWebView swallows Pointer Events).
   * `days` preserves the task's span when moving an already-scheduled bar; defaults to 1.
   */
  const beginDrag = (todo: Todo, event: React.MouseEvent, days?: number) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const originX = event.clientX;
    const originY = event.clientY;
    const span = Math.max(1, days ?? todo.days ?? 1);
    let active = false;
    let overDay: string | null = null;

    const move = (moveEvent: MouseEvent) => {
      // Small threshold so a plain click never counts as a drag.
      if (!active && Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) < 4) {
        return;
      }
      active = true;
      overDay = dayAtPoint(moveEvent.clientX, moveEvent.clientY);
      setDrag({ todo, x: moveEvent.clientX, y: moveEvent.clientY, overDay });
    };

    const finish = (commit: boolean) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('ds-dragging');
      setDrag(null);
      if (commit && active && overDay) {
        scheduleTodo(todo.id, { start: overDay, days: span });
        setSelected(overDay);
      }
    };

    const onUp = () => finish(true);

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', onUp);
    document.body.classList.add('ds-dragging');
  };

  const bars: CalBar[] = useMemo(
    () =>
      todos
        .filter((todo) => Boolean(todo.start))
        .map((todo) => {
          const range = spanRange(todo.start!, todo.days);
          const done = todo.status === 'done';
          const kind: CalKind = done
            ? 'done'
            : todo.due && todo.due < today
              ? 'late'
              : todo.due === today
                ? 'due'
                : 'plan';
          return {
            todo,
            start: range.start,
            end: range.end,
            days: Math.max(1, todo.days ?? 1),
            done,
            kind,
          };
        }),
    [todos, today],
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    const push = (day: string, item: CalItem) => {
      const bucket = map.get(day);
      if (bucket) {
        bucket.push(item);
      } else {
        map.set(day, [item]);
      }
    };

    todos.forEach((todo) => {
      // Scheduled todos live in the bar lane, not the chip list.
      if (todo.start) {
        return;
      }

      if (todo.status === 'done') {
        if (todo.completedAt) {
          push(localDay(todo.completedAt), {
            key: `todo:${todo.id}`,
            kind: 'done',
            title: todo.title,
            todoId: todo.id,
          });
        }
        return;
      }

      if (todo.due) {
        push(todo.due, {
          key: `todo:${todo.id}`,
          kind: todo.due < today ? 'late' : 'due',
          title: todo.title,
          todoId: todo.id,
        });
      }
    });

    map.forEach((items) =>
      items.sort((a, b) => kindWeight[a.kind] - kindWeight[b.kind] || a.title.localeCompare(b.title)),
    );
    return map;
  }, [todos, today]);

  const visibleDays = useMemo(
    () => (mode === 'month' ? monthGrid(anchor) : weekDays(anchor)),
    [mode, anchor],
  );

  const notesByDay = useMemo(() => {
    const map = new Map<string, number>();
    visibleDays.forEach((day) => {
      const count = notesCreatedOn(notes, day).length;
      if (count > 0) {
        map.set(day, count);
      }
    });
    return map;
  }, [notes, visibleDays]);

  const dayNotes = useMemo(() => notesCreatedOn(notes, selected), [notes, selected]);
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);

  /**
   * Agenda for the selected day. The day list follows the browsed date, but
   * "overdue" and "unscheduled" are judged against the real current day so
   * browsing the calendar never reshuffles the side panels.
   */
  const groups = useMemo(() => {
    const scheduledOnDay: Todo[] = [];
    const completedOnDay: Todo[] = [];
    const overdue: Todo[] = [];
    const inbox: Todo[] = [];

    todos.forEach((todo) => {
      const done = todo.status === 'done';
      // A scheduled todo's deadline is the last day of its span; without a
      // span, `due` alone decides.
      const end = todo.start ? addDays(todo.start, Math.max(1, todo.days ?? 1) - 1) : todo.due;
      // Scheduled todos sit on every day their span covers; a due-only todo
      // sits on its due day.
      const scheduledHere = todo.start ? coversDay(todo.start, todo.days, selected) : todo.due === selected;

      if (scheduledHere) {
        scheduledOnDay.push(todo);
      }
      if (done && todo.completedAt && localDay(todo.completedAt) === selected) {
        completedOnDay.push(todo);
      }

      if (!done && end && end < today) {
        overdue.push(todo);
      }
      if (!done && !todo.start && !todo.due) {
        inbox.push(todo);
      }
    });

    // The day list shows everything scheduled for the day, plus anything that
    // was finished that day even if it was scheduled elsewhere.
    const scheduledIds = new Set(scheduledOnDay.map((todo) => todo.id));
    const dayList = [...scheduledOnDay, ...completedOnDay.filter((todo) => !scheduledIds.has(todo.id))];

    const bySchedule = (a: Todo, b: Todo) =>
      (a.due ?? a.start ?? '').localeCompare(b.due ?? b.start ?? '') ||
      (a.priority ? priorityOrder[a.priority] : 3) - (b.priority ? priorityOrder[b.priority] : 3);

    return {
      day: sortByPriority(dayList),
      scheduledCount: scheduledOnDay.length,
      pendingCount: scheduledOnDay.filter((todo) => todo.status !== 'done').length,
      doneCount: completedOnDay.length,
      overdue: overdue.sort(bySchedule),
      backlog: sortByPriority(inbox),
    };
  }, [todos, selected, today]);

  const shift = (delta: number) => {
    setAnchor((current) => (mode === 'month' ? shiftMonth(current, delta) : addDays(current, delta * 7)));
  };

  const startResize = (event: React.MouseEvent, bar: CalBar, weekIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const row = rowRefs.current[weekIndex];
    if (!row) {
      return;
    }
    const columnWidth = row.clientWidth / 7;
    const startX = event.clientX;
    let days = bar.days;
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(
        SPAN_LIMIT,
        Math.max(1, bar.days + Math.round((moveEvent.clientX - startX) / columnWidth)),
      );
      if (next !== days) {
        days = next;
        scheduleTodo(bar.todo.id, { start: bar.start, days: next });
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const weeks = useMemo(() => {
    const result: string[][] = [];
    for (let index = 0; index < visibleDays.length; index += 7) {
      result.push(visibleDays.slice(index, index + 7));
    }
    return result;
  }, [visibleDays]);

  const weekdayNames = useMemo(() => weekdayLabels(locale), [locale]);
  const chipsLimit = mode === 'month' ? CHIP_LIMIT.month : CHIP_LIMIT.week;

  /** Narrow label for the in-cell drop badge, e.g. `11 Fri` / `11 周五`. */
  const compactDay = (day: string) => {
    const weekday = formatDayHeading(day, locale).split(' · ')[1] ?? '';
    return `${Number(day.slice(8, 10))} ${weekday}`.trim();
  };

  const cyclePriority = (todo: Todo) => {
    setTodoPriority(todo.id, nextPriority[todo.priority ?? 'none']);
  };

  const remove = async (todoId: string) => {
    if (await confirmDeletion(t('todos.deleteConfirm'))) {
      deleteTodo(todoId);
    }
  };

  const openSource = (todo: Todo) => {
    if (!todo.noteId) {
      return;
    }
    selectNote(todo.noteId);
    setActiveSection('notes');
  };

  const renderRow = (todo: Todo, options: { draggable?: boolean; showActions?: boolean } = {}) => {
    const { draggable = false, showActions = true } = options;
    return (
      <TodoItem
        key={todo.id}
        todo={todo}
        today={today}
        onToggle={(done) => toggleTodo(todo.id, done)}
        onDelete={() => remove(todo.id)}
        sourceTitle={todo.noteId ? notesById.get(todo.noteId)?.title : undefined}
        onOpenSource={todo.noteId ? () => openSource(todo) : undefined}
        draggable={draggable}
        onGripMouseDown={draggable ? (event) => beginDrag(todo, event) : undefined}
        actions={
          showActions ? (
            <>
              {todo.start ? (
                <div className="planning-stepper">
                  <button
                    type="button"
                    onClick={() =>
                      scheduleTodo(todo.id, {
                        start: addDays(todo.start!, -1),
                        days: Math.max(1, todo.days ?? 1),
                      })
                    }
                    aria-label={t('plan.moveEarlier')}
                  >
                    ←
                  </button>
                  <span className="planning-stepper-date">
                    {formatDayHeading(todo.start, locale).split(' · ')[0]}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      scheduleTodo(todo.id, {
                        start: addDays(todo.start!, 1),
                        days: Math.max(1, todo.days ?? 1),
                      })
                    }
                    aria-label={t('plan.moveLater')}
                  >
                    →
                  </button>
                </div>
              ) : null}
              {todo.start ? (
                <div className="planning-stepper">
                  <button
                    type="button"
                    onClick={() =>
                      scheduleTodo(todo.id, {
                        start: todo.start!,
                        days: Math.max(1, (todo.days ?? 1) - 1),
                      })
                    }
                    aria-label={t('plan.shortenSpan')}
                  >
                    −
                  </button>
                  <span>
                    {Math.max(1, todo.days ?? 1)}
                    {t('plan.spanUnit')}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      scheduleTodo(todo.id, {
                        start: todo.start!,
                        days: Math.min(SPAN_LIMIT, (todo.days ?? 1) + 1),
                      })
                    }
                    aria-label={t('plan.extendSpan')}
                  >
                    ＋
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="planning-chip-button"
                onClick={() => cyclePriority(todo)}
                title={t('todos.priorityLabel')}
              >
                {todo.priority ? t(`todos.priority.${todo.priority}` as MessageKey) : '—'}
              </button>
            </>
          ) : null
        }
      />
    );
  };

  const [selectedDate, selectedWeekday] = formatDayHeading(selected, locale).split(' · ');

  const submitQuick = () => {
    if (!captureDraft.trim()) {
      quickRef.current?.focus();
      return;
    }
    submitQuickTodo(captureDraft);
    quickRef.current?.focus();
  };

  return (
    <Page
      title={t('plan.title')}
      subtitle={t('plan.subtitle')}
      actions={
        <div className="plan-header-actions flex items-center gap-2">
          <div className="planning-toggle">
            {(['month', 'week'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={mode === item ? 'is-active' : ''}
                onClick={() => setMode(item)}
              >
                {item === 'month' ? t('calendar.month') : t('calendar.week')}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ds-icon-btn"
            aria-label={t('plan.previous')}
            onClick={() => shift(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="ds-secondary"
            onClick={() => {
              setAnchor(today);
              setSelected(today);
            }}
          >
            {t('common.today')}
          </button>
          <button type="button" className="ds-icon-btn" aria-label={t('plan.next')} onClick={() => shift(1)}>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      }
    >
      <div className="ds-plan-wrap">
        <div className="ds-card">
          <div className="cal-head">
            <span className="m">
              {mode === 'month' ? formatMonthTitle(anchor, locale) : formatWeekTitle(anchor, locale)}
            </span>
            <span className={`ml-auto text-[11.5px] ${drag?.overDay ? 'cal-drop-hint' : 'ds-faint'}`}>
              {drag?.overDay
                ? t('plan.dropOn', { date: formatDayHeading(drag.overDay, locale) })
                : t('calendar.dragHint')}
            </span>
          </div>

          <div className="cal-weekday-row">
            {weekdayNames.map((name, index) => (
              <div key={`${index}-${name}`} className="cal-weekday">
                {name}
              </div>
            ))}
          </div>

          {weeks.map((week, weekIndex) => {
            const weekBars = bars.filter((bar) => bar.start <= week[6] && bar.end >= week[0]);
            const lanes = assignLanes(weekBars);
            const laneCount = lanes.length;
            return (
              <div
                key={week[0]}
                className={`cal-week-row ${mode === 'week' ? 'is-tall' : ''}`}
                ref={(element) => {
                  rowRefs.current[weekIndex] = element;
                }}
              >
                <div className="cal-week-grid">
                  {week.map((day) => {
                    const inMonth = mode === 'week' || day.slice(0, 7) === anchor.slice(0, 7);
                    const items = itemsByDay.get(day) ?? [];
                    const visible = items.slice(0, chipsLimit);
                    return (
                      <div
                        key={day}
                        data-cal-day={day}
                        className={`cal-cell ${inMonth ? '' : 'is-muted'} ${
                          isToday(day) ? 'is-today' : ''
                        } ${selected === day ? 'is-selected' : ''} ${
                          drag?.overDay === day ? 'is-dragover' : ''
                        }`}
                        style={{ paddingTop: 30 + laneCount * 22 }}
                        onClick={() => setSelected(day)}
                      >
                        <span className="cal-day-number">{Number(day.slice(8, 10))}</span>
                        {drag?.overDay === day ? (
                          <span className="cal-drop-badge">{compactDay(day)}</span>
                        ) : null}
                        {notesByDay.get(day) ? (
                          <span className="cal-note-count" title={t('calendar.notes')}>
                            <Icon name="note" size={12} />
                            {notesByDay.get(day)}
                          </span>
                        ) : null}
                        <div className="cal-cell-chips">
                          {visible.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              className={`cal-chip cal-chip-${item.kind}`}
                              title={item.title}
                              onMouseDown={(event) => {
                                const todo = todos.find((current) => current.id === item.todoId);
                                if (todo) {
                                  beginDrag(todo, event, 1);
                                }
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelected(day);
                              }}
                            >
                              {item.title || '—'}
                            </button>
                          ))}
                          {items.length > chipsLimit ? (
                            <span className="cal-chip-more">+{items.length - chipsLimit}</span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="cal-bars">
                  {lanes.map((lane) =>
                    lane
                      .filter((bar) => bar.start <= week[6] && bar.end >= week[0])
                      .map((bar) => {
                        const from = Math.max(0, Math.round(spanDays(week[0], bar.start)));
                        const to = Math.min(6, Math.round(spanDays(week[0], bar.end)));
                        const laneIndex = lanes.indexOf(lane);
                        const startsHere = bar.start >= week[0];
                        const endsHere = bar.end <= week[6];
                        return (
                          <div
                            key={`${bar.todo.id}-${week[0]}`}
                            className={`cal-bar cal-bar-${bar.kind}`}
                            style={{
                              top: 30 + laneIndex * 22,
                              left: `calc(${(from / 7) * 100}% + 2px)`,
                              width: `calc(${((to - from + 1) / 7) * 100}% - 4px)`,
                              borderTopLeftRadius: startsHere ? 6 : 0,
                              borderBottomLeftRadius: startsHere ? 6 : 0,
                              borderTopRightRadius: endsHere ? 6 : 0,
                              borderBottomRightRadius: endsHere ? 6 : 0,
                            }}
                            title={bar.todo.title}
                            onMouseDown={(event) => beginDrag(bar.todo, event, bar.days)}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelected(bar.start);
                            }}
                          >
                            <span className="cal-bar-label">
                              {endsHere && bar.days > 1
                                ? `${bar.todo.title} · ${bar.days}${t('plan.spanUnit')}`
                                : bar.todo.title}
                            </span>
                            {endsHere ? (
                              <span
                                className="cal-bar-handle"
                                aria-hidden="true"
                                onMouseDown={(event) => startResize(event, bar, weekIndex)}
                              />
                            ) : null}
                          </div>
                        );
                      }),
                  )}
                </div>
              </div>
            );
          })}

          <div className="cal-legend">
            <Legend className="cal-chip-plan" label={t('calendar.legendPlan')} />
            <Legend className="cal-chip-note" label={t('calendar.legendNote')} />
            <Legend className="cal-chip-done" label={t('calendar.legendDone')} />
            <Legend className="cal-chip-due" label={t('calendar.legendDue')} />
            <Legend className="cal-chip-late" label={t('calendar.legendLate')} />
          </div>
        </div>

        <div className="ds-plan-side">
          <div className="ds-quick-todo">
            <div className="ds-quick-todo-head">
              <span className="ds-quick-todo-icon" aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
              {t('plan.quickTodo')}
            </div>
            <div className="ds-quick-todo-bar">
              <input
                ref={quickRef}
                data-capture-input="true"
                value={captureDraft}
                onChange={(event) => setCaptureDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitQuick();
                  }
                  if (event.key === 'Escape') {
                    setCaptureDraft('');
                    quickRef.current?.blur();
                  }
                }}
                placeholder={t('plan.quickTodoPlaceholder')}
                aria-label={t('plan.quickTodoPlaceholder')}
              />
              <button
                type="button"
                className="ds-icon-btn"
                title={t('plan.quickTodoSubmit')}
                onClick={submitQuick}
              >
                <span aria-hidden="true">↵</span>
              </button>
            </div>
          </div>

          <div className="ds-agenda">
            <div className="ds-agenda-head">
              <span className="d">{selectedDate}</span>
              <span className="w">
                {selectedWeekday}
                {isToday(selected) ? ` · ${t('common.today')}` : ''}
              </span>
              <div className="ds-agenda-sum">
                {t('plan.daySummary', {
                  scheduled: groups.scheduledCount,
                  pending: groups.pendingCount,
                  done: groups.doneCount,
                  notes: dayNotes.length,
                })}
              </div>
            </div>
            <div className="ds-agenda-body">
              {groups.day.length === 0 && dayNotes.length === 0 ? (
                <p className="ds-faint px-3.5 py-3 text-[12.5px]">{t('calendar.emptyDay')}</p>
              ) : null}
              {groups.day.map((todo) => renderRow(todo, { showActions: todo.status !== 'done' }))}
              {dayNotes.map((note) => (
                <div key={note.id} className="ds-record">
                  <span className="ds-tagico" aria-hidden="true">
                    <Icon name="note" size={12} />
                  </span>
                  <span className="ds-record-time">{formatTime(note.createdAt, locale)}</span>
                  <button
                    type="button"
                    className="ds-text min-w-0 flex-1 text-left text-[12.5px] hover:underline"
                    onClick={() => {
                      selectNote(note.id);
                      setActiveSection('notes');
                    }}
                  >
                    {displayTitle(note.title)}
                  </button>
                </div>
              ))}
            </div>
            <div className="ds-agenda-foot">
              <button type="button" className="ds-link" onClick={() => openReviewOn(selected)}>
                {t('calendar.viewInReview')}
              </button>
            </div>
          </div>

          <div className="ds-agenda">
            <div className="ds-agenda-head">
              <span className="d">{t('plan.groupOverdue')}</span>
              <span className="w">· {groups.overdue.length}</span>
              <div className="ds-agenda-sum">{t('plan.drawerHint')}</div>
            </div>
            <div className="ds-agenda-body">
              {groups.overdue.length === 0 ? (
                <p className="ds-faint px-3.5 py-3 text-[12.5px]">{t('plan.overdueEmpty')}</p>
              ) : null}
              {groups.overdue.map((todo) => renderRow(todo, { draggable: true }))}
            </div>
          </div>

          <div className="ds-agenda">
            <div className="ds-agenda-head">
              <span className="d">{t('plan.groupInbox')}</span>
              <span className="w">· {groups.backlog.length}</span>
              <div className="ds-agenda-sum">{t('plan.drawerHint')}</div>
            </div>
            <div className="ds-agenda-body">
              {groups.backlog.length === 0 ? (
                <p className="ds-faint px-3.5 py-3 text-[12.5px]">{t('plan.unscheduledEmpty')}</p>
              ) : null}
              {groups.backlog.map((todo) => renderRow(todo, { draggable: true }))}
            </div>
          </div>
        </div>
      </div>

      {drag ? (
        <div className="ds-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <span className="ds-grip">⋮</span>
          <span className="t">{drag.todo.title}</span>
          {drag.overDay ? <span className="d">{compactDay(drag.overDay)}</span> : null}
        </div>
      ) : null}
    </Page>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`cal-legend-dot ${className}`} />
      {label}
    </span>
  );
}

function spanDays(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return (end.getTime() - start.getTime()) / 86_400_000;
}

/** Greedy lane assignment so overlapping multi-day bars never collide. */
function assignLanes(bars: CalBar[]): CalBar[][] {
  const sorted = [...bars].sort((a, b) => a.start.localeCompare(b.start) || b.days - a.days);
  const lanes: CalBar[][] = [];
  sorted.forEach((bar) => {
    const lane = lanes.find((candidate) =>
      candidate.every((item) => item.end < bar.start || item.start > bar.end),
    );
    if (lane) {
      lane.push(bar);
    } else {
      lanes.push([bar]);
    }
  });
  return lanes;
}
