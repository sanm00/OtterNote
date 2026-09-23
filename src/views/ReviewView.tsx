import React, { useEffect, useMemo, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Page } from '../components/ui';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import {
  addDays,
  daysBetween,
  formatDayHeading,
  isToday,
  rangeForPreset,
  todayKey,
  type DateRange,
  type RangePreset,
} from '../lib/dates';
import { downloadTextFile } from '../lib/export-file';
import type { MessageKey } from '../lib/i18n';
import { useI18n } from '../lib/i18n';
import { buildRecap, buildRecapMarkdown, buildStats, type RecapEventKind } from '../lib/review';
import { isTauriRuntime, writeExportFile } from '../storage';
import { useAppStore } from '../store';

const presetOrder: RangePreset[] = ['today', 'yesterday', 'week', 'lastWeek', 'month', 'lastMonth', 'custom'];

const presetLabels: Record<RangePreset, MessageKey> = {
  today: 'common.today',
  yesterday: 'common.yesterday',
  week: 'common.week',
  lastWeek: 'common.lastWeek',
  month: 'common.month',
  lastMonth: 'common.lastMonth',
  custom: 'common.custom',
};

const kindLabels: Record<RecapEventKind, MessageKey> = {
  created: 'review.kind.note',
  edited: 'review.kind.edited',
  completed: 'review.kind.completed',
};

const kindGlyphs: Record<RecapEventKind, IconName> = {
  created: 'note',
  edited: 'note',
  completed: 'check',
};

function MetricCard({
  value,
  label,
  hint,
  tone,
}: {
  value: React.ReactNode;
  label: string;
  hint?: string;
  tone?: 'accent' | 'warn' | 'danger';
}) {
  return (
    <div className={`ds-stat ${tone ? `tone-${tone}` : ''}`}>
      <div className="n">{value}</div>
      <div className="l">{label}</div>
      {hint ? <div className="ds-stat-hint">{hint}</div> : null}
    </div>
  );
}

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' });

function activityDayLabel(date: string, locale: string): string {
  if (locale === 'zh') {
    return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  }
  return DAY_LABEL_FORMAT.format(new Date(`${date}T00:00:00`));
}

export function ReviewView() {
  const { t, locale } = useI18n();
  const notes = useAppStore((state) => state.notes);
  const todos = useAppStore((state) => state.todos);
  const selectNote = useAppStore((state) => state.selectNote);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const pendingReviewDate = useAppStore((state) => state.pendingReviewDate);
  const clearPendingReviewDate = useAppStore((state) => state.clearPendingReviewDate);

  const [preset, setPreset] = useState<RangePreset>(() => {
    const today = todayKey();
    if (pendingReviewDate === today) {
      return 'today';
    }
    return pendingReviewDate ? 'custom' : 'week';
  });
  const [customStart, setCustomStart] = useState(() => pendingReviewDate ?? addDays(todayKey(), -6));
  const [customEnd, setCustomEnd] = useState(() => pendingReviewDate ?? todayKey());
  const [exported, setExported] = useState(false);

  useEffect(() => {
    if (pendingReviewDate) {
      clearPendingReviewDate();
    }
  }, [pendingReviewDate, clearPendingReviewDate]);

  const range = useMemo<DateRange>(
    () => (preset === 'custom' ? { start: customStart, end: customEnd, preset } : rangeForPreset(preset)),
    [preset, customStart, customEnd],
  );

  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const recap = useMemo(() => buildRecap({ notes, todos, range }), [notes, todos, range]);
  const stats = useMemo(() => buildStats({ notes, todos, range }), [notes, todos, range]);
  const activeDays = recap.days.filter((day) => day.events.length > 0);

  const metricCards = useMemo(
    () => [
      {
        label: t('review.stat.planned'),
        hint: t('review.stat.plannedHint'),
        value: stats.metrics.planned,
      },
      {
        label: t('review.stat.completed'),
        hint: t('review.stat.completedHint'),
        value: stats.metrics.completed,
        tone: 'accent' as const,
      },
      {
        label: t('review.stat.overdue'),
        hint: t('review.stat.overdueOpenHint'),
        value: (
          <>
            {stats.metrics.overdueOpen}
            <small>
              +{stats.metrics.overdueCompleted} {t('review.stat.overdueCompleted')}
            </small>
          </>
        ),
        tone: 'danger' as const,
      },
      {
        label: t('review.stat.notes'),
        hint: t('review.stat.notesHint'),
        value: stats.metrics.notes,
        tone: 'warn' as const,
      },
    ],
    [stats, t],
  );

  const maxBarValue = Math.max(1, ...stats.days.flatMap((day) => [day.created, day.edited, day.completed]));
  const planTotal = stats.planSplit.onTime + stats.planSplit.overdue + stats.planSplit.open;
  const planPct = (value: number) => (planTotal === 0 ? 0 : Math.round((value / planTotal) * 100));

  const barScale = (value: number) => (value <= 0 ? 0 : Math.max(4, Math.round((value / maxBarValue) * 100)));

  const exportReport = async () => {
    const markdown = buildRecapMarkdown(recap, locale);
    const fileName = `review-${range.start}_${range.end}.md`;

    if (isTauriRuntime()) {
      const selected = await saveDialog({
        title: t('review.exportDialog'),
        defaultPath: fileName,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });

      if (typeof selected !== 'string' || !selected.trim()) {
        return;
      }

      await writeExportFile(selected, markdown);
    } else {
      downloadTextFile(markdown, fileName, 'text/markdown');
    }

    setExported(true);
    window.setTimeout(() => setExported(false), 2000);
  };

  const openNote = (noteId: string) => {
    selectNote(noteId);
    setActiveSection('notes');
  };

  return (
    <Page
      title={t('review.title')}
      subtitle={t('review.subtitle')}
      actions={
        <div className="flex items-center gap-2">
          {exported ? (
            <span className="text-[12px]" style={{ color: 'var(--ds-accent)' }}>
              {t('review.exported')}
            </span>
          ) : null}
          <button type="button" className="ds-primary" onClick={exportReport}>
            {t('review.exportReport')}
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {presetOrder.map((item) => (
          <button
            key={item}
            type="button"
            className={`ds-chip ${preset === item ? 'is-active' : ''}`}
            onClick={() => setPreset(item)}
          >
            {t(presetLabels[item])}
          </button>
        ))}
      </div>

      {preset === 'custom' ? (
        <div className="planning-date-range">
          <span className="planning-date-range-label">{t('review.range')}</span>
          <input
            type="date"
            className="planning-date-input"
            value={customStart}
            max={customEnd}
            onChange={(event) => setCustomStart(event.target.value)}
          />
          <span className="planning-date-range-sep" aria-hidden="true">
            –
          </span>
          <input
            type="date"
            className="planning-date-input"
            value={customEnd}
            min={customStart}
            onChange={(event) => setCustomEnd(event.target.value)}
          />
        </div>
      ) : null}

      <div className="ds-stats">
        {metricCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="ds-charts">
        <div className="ds-chart ds-card">
          <div className="ds-chart-head">
            <span className="g">{t('review.chart.activity')}</span>
            <span className="ds-chart-legend">
              <span className="lg lg-created">{t('review.chart.created')}</span>
              <span className="lg lg-completed">{t('review.chart.completed')}</span>
            </span>
          </div>
          <div className="ds-bar-chart">
            {stats.days.map((day) => {
              const created = day.created;
              const completed = day.completed;
              return (
                <div key={day.date} className="ds-bar-col" title={activityDayLabel(day.date, locale)}>
                  <div className="ds-bar-tracks">
                    <span className="ds-bar is-created" style={{ height: `${barScale(created)}%` }}>
                      {created > 0 ? <span className="ds-bar-n">{created}</span> : null}
                    </span>
                    <span className="ds-bar is-completed" style={{ height: `${barScale(completed)}%` }}>
                      {completed > 0 ? <span className="ds-bar-n">{completed}</span> : null}
                    </span>
                  </div>
                  <div className="ds-bar-x">{activityDayLabel(day.date, locale)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ds-chart ds-card">
          <div className="ds-chart-head">
            <span className="g">{t('review.chart.plan')}</span>
            <span className="ds-chart-legend">
              <span className="lg lg-on-time">{t('review.chart.onTime')}</span>
              <span className="lg lg-overdue">{t('review.chart.overdue')}</span>
              <span className="lg lg-open">{t('review.chart.open')}</span>
            </span>
          </div>
          <div className="ds-split-chart">
            <div className="ds-split-bar" role="img">
              <span className="seg seg-on-time" style={{ width: `${planPct(stats.planSplit.onTime)}%` }} />
              <span className="seg seg-overdue" style={{ width: `${planPct(stats.planSplit.overdue)}%` }} />
              <span className="seg seg-open" style={{ width: `${planPct(stats.planSplit.open)}%` }} />
            </div>
            <div className="ds-split-rows">
              <span>
                <i className="lg lg-on-time" />
                {t('review.chart.onTime')} · {stats.planSplit.onTime}
              </span>
              <span>
                <i className="lg lg-overdue" />
                {t('review.chart.overdue')} · {stats.planSplit.overdue}
              </span>
              <span>
                <i className="lg lg-open" />
                {t('review.chart.open')} · {stats.planSplit.open}
              </span>
            </div>
          </div>
        </div>
      </div>

      {activeDays.length === 0 ? (
        <div className="empty-state px-4 py-8 text-center">
          <div className="ds-text text-[13px] font-semibold">{t('review.title')}</div>
          <div className="ds-muted mt-1 text-[12.5px]">{t('review.empty')}</div>
        </div>
      ) : (
        activeDays.map((day) => {
          const [dateLabel, weekday] = formatDayHeading(day.date, locale).split(' · ');
          return (
            <section key={day.date}>
              <div className="ds-day-head">
                <span className="d" style={isToday(day.date) ? { color: 'var(--ds-accent)' } : undefined}>
                  {dateLabel}
                </span>
                <span className="w">{weekday}</span>
                <span className="line" />
                <span className="w">{t('review.dayEvents', { n: day.events.length })}</span>
              </div>
              <div className="ds-card">
                {day.events.reduce<React.ReactNode[]>((nodes, event, index, events) => {
                  const group = event.kind === 'completed' ? 'todos' : 'notes';
                  const prev = events[index - 1];
                  const prevGroup = prev ? (prev.kind === 'completed' ? 'todos' : 'notes') : null;
                  const isNewGroup = prevGroup !== group;
                  return [
                    ...nodes,
                    ...(isNewGroup
                      ? [
                          <div key={`g:${group}`} className="ds-rec-group">
                            {t(group === 'todos' ? 'review.group.todos' : 'review.group.notes')}
                          </div>,
                        ]
                      : []),
                    <div key={event.id} className={`ds-rec ${event.kind === 'completed' ? 'is-done' : ''}`}>
                      {event.kind === 'completed' ? (
                        <span className="ds-rec-check" aria-hidden="true">
                          <input type="checkbox" checked disabled readOnly tabIndex={-1} />
                        </span>
                      ) : (
                        <span className="ds-rec-tagico" aria-hidden="true">
                          <Icon name={kindGlyphs[event.kind]} size={14} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="ds-rec-title">{event.title}</div>
                        <div className="ds-rec-detail">
                          {event.kind === 'completed' ? (
                            <>
                              <span className="planning-chip">
                                {t('todos.completedOn', {
                                  date: formatDayHeading(event.at.slice(0, 10), locale),
                                })}
                              </span>
                              {event.overdue && event.due ? (
                                <span className="planning-chip planning-chip-late">
                                  {t('todos.overdueBy', {
                                    n: Math.abs(daysBetween(event.due, event.at.slice(0, 10))),
                                  })}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <>
                              {event.detail ? <span>{event.detail}</span> : null}
                              <span className="ml-1.5">{t(kindLabels[event.kind])}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {event.noteId ? (
                        <button type="button" className="ds-rec-src" onClick={() => openNote(event.noteId!)}>
                          {notesById.get(event.noteId)?.title || t('todos.sourceNote')}
                        </button>
                      ) : null}
                    </div>,
                  ];
                }, [])}
              </div>
            </section>
          );
        })
      )}
    </Page>
  );
}
