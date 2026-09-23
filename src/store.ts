import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createId } from './id';
import { addDays } from './lib/dates';
import type { Locale } from './lib/i18n';
import { titleFromFirstLine } from './lib/markdown';
import { appStorage } from './storage';
import {
  isTaskLine,
  parseTodosFromContent,
  removeTodoFromContent,
  todoTitleInLine,
  updateTodoStatusInContent,
} from './todo-parser';

export type NavSection = 'plan' | 'notes' | 'review' | 'new' | 'images' | 'settings' | 'help';
export type TodoStatus = 'todo' | 'done';
export type TodoPriority = 'low' | 'medium' | 'high';
export type Note = {
  id: string;
  title: string;
  /** Markdown body. Inline `- [ ]` lines are parsed into todos. */
  content: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type Todo = {
  id: string;
  noteId?: string;
  title: string;
  status: TodoStatus;
  source: 'note' | 'standalone';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Local `YYYY-MM-DD` the task is scheduled to start on. */
  start?: string;
  /** Number of consecutive days the task spans (planner). Defaults to 1. */
  days?: number;
  /** Local `YYYY-MM-DD` deadline. Derived from `start` + `days` when scheduled. */
  due?: string;
  priority?: TodoPriority;
};

export type TodoSchedule = {
  start?: string | null;
  days?: number | null;
  due?: string | null;
};

export type StandaloneTodoOptions = {
  start?: string;
  days?: number;
  due?: string;
  priority?: TodoPriority;
};

export type ShortcutAction = 'save' | 'edit' | 'delete' | 'cancel' | 'new' | 'capture';
export type ShortcutConfig = Record<ShortcutAction, string>;
export type ThemeMode = 'light' | 'dark';

type DeletedSnapshot =
  | {
      type: 'note';
      note: Note;
      todos: Todo[];
      recentNoteIds: string[];
    }
  | {
      type: 'todo';
      todo: Todo;
    };

type AppState = {
  activeSection: NavSection;
  selectedNoteId?: string;
  query: string;
  searchFocused: boolean;
  /** Text typed into the quick ToDo bar on the plan view. */
  captureDraft: string;
  /** Bumped to ask the plan view to focus its quick ToDo bar. */
  captureFocusNonce: number;
  /** Day (YYYY-MM-DD) the plan view asks the review view to highlight. */
  pendingReviewDate?: string;
  notes: Note[];
  todos: Todo[];
  recentNoteIds: string[];
  shortcuts: ShortcutConfig;
  theme: ThemeMode;
  locale: Locale;
  deletedStack: DeletedSnapshot[];
  setActiveSection: (section: NavSection) => void;
  setLocale: (locale: Locale) => void;
  clearSelectedNote: () => void;
  setQuery: (query: string) => void;
  setSearchFocused: (focused: boolean) => void;
  setCaptureDraft: (draft: string) => void;
  /** Opens the plan view and focuses its quick ToDo bar. */
  focusCapture: () => void;
  /** Switches to the review view, initialised to show `date`. */
  openReviewOn: (date: string) => void;
  /** Clears the one-shot review-day request after it has been consumed. */
  clearPendingReviewDate: () => void;
  updateShortcut: (action: ShortcutAction, shortcut: string) => void;
  setTheme: (theme: ThemeMode) => void;
  replaceAppState: (state: AppStateSnapshot) => void;
  createNote: (title?: string, content?: string) => void;
  selectNote: (noteId: string) => void;
  updateNoteTitle: (noteId: string, title: string) => void;
  updateNoteContent: (noteId: string, content: string) => void;
  deleteNote: (noteId: string) => void;
  createStandaloneTodo: (title: string, options?: StandaloneTodoOptions) => void;
  /**
   * Commits the quick ToDo bar: every non-empty line becomes an unscheduled
   * standalone todo.
   */
  submitQuickTodo: (raw: string) => void;
  toggleTodo: (todoId: string, done: boolean) => void;
  deleteTodo: (todoId: string) => void;
  scheduleTodo: (todoId: string, schedule: TodoSchedule) => void;
  setTodoPriority: (todoId: string, priority: TodoPriority | null) => void;
  undoLastDelete: () => void;
};

export type AppStateSnapshot = Pick<
  AppState,
  | 'activeSection'
  | 'selectedNoteId'
  | 'query'
  | 'searchFocused'
  | 'notes'
  | 'todos'
  | 'recentNoteIds'
  | 'shortcuts'
  | 'theme'
  | 'locale'
  | 'deletedStack'
>;

export const defaultShortcuts: ShortcutConfig = {
  save: 'Cmd+S',
  edit: 'Cmd+E',
  delete: 'Cmd+Backspace',
  cancel: 'Esc',
  new: 'Cmd+N',
  capture: 'Cmd+T',
};

export const defaultTheme: ThemeMode = 'light';

/** Sections retired by the three-view restructure all fold into `plan`. */
function normalizeNavSection(section: NavSection | string | undefined): NavSection {
  switch (section) {
    case 'plan':
    case 'notes':
    case 'review':
    case 'new':
    case 'images':
    case 'settings':
    case 'help':
      return section;
    default:
      return 'plan';
  }
}

export const defaultLocale: Locale = 'en';

function normalizeShortcut(shortcut: string) {
  return shortcut
    .split('+')
    .map((part) => {
      const trimmed = part.trim();
      const lower = trimmed.toLowerCase();
      if (['mod', 'cmd', 'command', 'meta', 'ctrl', 'control'].includes(lower)) {
        return 'Cmd';
      }
      return trimmed;
    })
    .filter(Boolean)
    .join('+');
}

function normalizeShortcuts(shortcuts?: Partial<ShortcutConfig>) {
  if (!shortcuts) {
    return {};
  }

  const { undo: _undo, ...rest } = shortcuts as Partial<ShortcutConfig> & { undo?: string };
  return Object.fromEntries(
    Object.entries(rest).map(([action, shortcut]) => [action, normalizeShortcut(shortcut)]),
  ) as Partial<ShortcutConfig>;
}

/**
 * Quick capture moved from a `Cmd+K` overlay to the always-visible top bar, so
 * persisted bindings still carrying the retired default are re-pointed at
 * `Cmd+T`. A chord the user actually recorded is left alone.
 */
export function migrateShortcuts(shortcuts?: Partial<ShortcutConfig>): ShortcutConfig {
  const normalized = normalizeShortcuts(shortcuts);
  const merged: ShortcutConfig = { ...defaultShortcuts, ...normalized };

  if (merged.capture === 'Cmd+K') {
    merged.capture = defaultShortcuts.capture;
  }

  return merged;
}

type PersistedCore = Pick<AppState, 'notes' | 'todos' | 'deletedStack'>;

/**
 * A secondary window (pinned/capture) keeps its own in-memory copy of the store
 * and only learns about deletions lazily via rehydrate. If it flushes a stale
 * snapshot before syncing, a note deleted in another window would be written
 * back to disk and resurrected on the next launch. Treat this window's deletion
 * record as authoritative and never serialize pending-deleted notes/todos.
 */
export function stripPendingDeletes<T extends PersistedCore>(state: T): T {
  const deletedNoteIds = new Set(
    state.deletedStack
      .filter((snapshot): snapshot is Extract<DeletedSnapshot, { type: 'note' }> => snapshot.type === 'note')
      .map((snapshot) => snapshot.note.id),
  );
  const deletedTodoIds = new Set(
    state.deletedStack
      .filter((snapshot): snapshot is Extract<DeletedSnapshot, { type: 'todo' }> => snapshot.type === 'todo')
      .map((snapshot) => snapshot.todo.id),
  );
  if (deletedNoteIds.size === 0 && deletedTodoIds.size === 0) {
    return state;
  }
  return {
    ...state,
    notes: state.notes.filter((note) => !deletedNoteIds.has(note.id)),
    todos: state.todos.filter(
      (todo) => !deletedTodoIds.has(todo.id) && !(todo.noteId && deletedNoteIds.has(todo.noteId)),
    ),
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeSection: 'plan',
      query: '',
      searchFocused: false,
      captureDraft: '',
      captureFocusNonce: 0,
      notes: [],
      todos: [],
      recentNoteIds: [],
      shortcuts: defaultShortcuts,
      theme: defaultTheme,
      locale: defaultLocale,
      deletedStack: [],
      setActiveSection: (section) => set({ activeSection: section }),
      setLocale: (locale) => set({ locale }),
      clearSelectedNote: () => set({ selectedNoteId: undefined }),
      setQuery: (query) => set({ query }),
      setSearchFocused: (searchFocused) => set({ searchFocused }),
      setCaptureDraft: (captureDraft) => set({ captureDraft }),
      focusCapture: () =>
        set((state) => ({ activeSection: 'plan', captureFocusNonce: state.captureFocusNonce + 1 })),
      openReviewOn: (date) => set({ activeSection: 'review', pendingReviewDate: date }),
      clearPendingReviewDate: () => set({ pendingReviewDate: undefined }),
      updateShortcut: (action, shortcut) =>
        set((state) => ({
          shortcuts: {
            ...state.shortcuts,
            [action]: normalizeShortcut(shortcut),
          },
        })),
      setTheme: (theme) => set({ theme }),
      replaceAppState: (snapshot) =>
        set({
          activeSection: normalizeNavSection(snapshot.activeSection),
          selectedNoteId: snapshot.selectedNoteId,
          query: snapshot.query,
          searchFocused: snapshot.searchFocused ?? false,
          notes: snapshot.notes,
          todos: snapshot.todos,
          recentNoteIds: snapshot.recentNoteIds,
          shortcuts: migrateShortcuts(snapshot.shortcuts),
          theme: snapshot.theme ?? defaultTheme,
          locale: snapshot.locale ?? defaultLocale,
          deletedStack: snapshot.deletedStack,
        }),
      createNote: (title, content) =>
        set((state) => {
          const now = new Date().toISOString();
          const body = content ?? '';
          const note: Note = {
            id: createId('note'),
            title: title?.trim() || titleFromFirstLine(body) || 'Untitled Note',
            content: body,
            createdAt: now,
            updatedAt: now,
          };
          return {
            activeSection: 'notes',
            selectedNoteId: note.id,
            recentNoteIds: [note.id, ...state.recentNoteIds.filter((id) => id !== note.id)].slice(0, 10),
            notes: [note, ...state.notes],
            todos: [...todosForNote(note, state.todos), ...state.todos],
          };
        }),
      selectNote: (noteId) =>
        set((state) => ({
          selectedNoteId: noteId,
          activeSection: 'notes',
          recentNoteIds: [noteId, ...state.recentNoteIds.filter((id) => id !== noteId)].slice(0, 10),
        })),
      updateNoteTitle: (noteId, title) =>
        set((state) => {
          const now = new Date().toISOString();
          return {
            notes: state.notes.map((note) =>
              note.id === noteId ? { ...note, title, updatedAt: now } : note,
            ),
          };
        }),
      updateNoteContent: (noteId, content) =>
        set((state) => {
          const note = state.notes.find((item) => item.id === noteId);
          if (!note || note.content === content) {
            return state;
          }

          const now = new Date().toISOString();
          const nextNote: Note = { ...note, content, updatedAt: now };
          return {
            notes: state.notes.map((item) => (item.id === noteId ? nextNote : item)),
            todos: [
              ...todosForNote(nextNote, state.todos),
              ...state.todos.filter((todo) => todo.noteId !== noteId),
            ],
          };
        }),
      deleteNote: (noteId) =>
        set((state) => {
          const note = state.notes.find((item) => item.id === noteId);
          if (!note) {
            return state;
          }

          const todos = state.todos.filter((todo) => todo.noteId === noteId);
          return {
            selectedNoteId: state.selectedNoteId === noteId ? undefined : state.selectedNoteId,
            activeSection: state.selectedNoteId === noteId ? 'notes' : state.activeSection,
            recentNoteIds: state.recentNoteIds.filter((id) => id !== noteId),
            notes: state.notes.filter((item) => item.id !== noteId),
            todos: state.todos.filter((todo) => todo.noteId !== noteId),
            deletedStack: [
              {
                type: 'note',
                note,
                todos,
                recentNoteIds: state.recentNoteIds,
              } as const,
              ...state.deletedStack,
            ].slice(0, 20),
          };
        }),
      createStandaloneTodo: (title, options) =>
        set((state) => {
          const now = new Date().toISOString();
          const start = options?.start;
          const days = start ? Math.max(1, options?.days ?? 1) : options?.days;
          const todo: Todo = {
            id: createId('todo'),
            title,
            status: 'todo',
            source: 'standalone',
            createdAt: now,
            updatedAt: now,
            start,
            days,
            due: options?.due ?? (start && days ? addDays(start, days - 1) : undefined),
            priority: options?.priority,
          };
          return {
            activeSection: 'plan',
            todos: [todo, ...state.todos],
          };
        }),
      submitQuickTodo: (raw) =>
        set((state) => {
          const titles = raw
            .split('\n')
            .map((line) => (isTaskLine(line) ? (todoTitleInLine(line) ?? '') : line))
            .map((line) => line.trim())
            .filter(Boolean);

          if (titles.length === 0) {
            return state;
          }

          const now = new Date().toISOString();
          const newTodos: Todo[] = titles.map((title) => ({
            id: createId('todo'),
            title,
            status: 'todo' as const,
            source: 'standalone' as const,
            createdAt: now,
            updatedAt: now,
          }));

          return {
            captureDraft: '',
            activeSection: 'plan' as const,
            todos: [...newTodos, ...state.todos],
          };
        }),
      scheduleTodo: (todoId, schedule) =>
        set((state) => {
          const now = new Date().toISOString();
          return {
            todos: state.todos.map((todo) => {
              if (todo.id !== todoId) {
                return todo;
              }

              const next: Todo = { ...todo, updatedAt: now };
              if (schedule.start !== undefined) {
                next.start = schedule.start ?? undefined;
              }
              if (schedule.days !== undefined) {
                next.days = schedule.days ?? undefined;
              }

              if (next.start) {
                // A scheduled task always spans at least one day, and its
                // deadline is the last day of that span.
                next.days = Math.max(1, next.days ?? 1);
                next.due = addDays(next.start, next.days - 1);
              } else {
                next.days = undefined;
                if (schedule.due !== undefined) {
                  next.due = schedule.due ?? undefined;
                }
              }

              return next;
            }),
          };
        }),
      setTodoPriority: (todoId, priority) =>
        set((state) => {
          const now = new Date().toISOString();
          return {
            todos: state.todos.map((todo) =>
              todo.id === todoId ? { ...todo, priority: priority ?? undefined, updatedAt: now } : todo,
            ),
          };
        }),
      toggleTodo: (todoId, done) =>
        set((state) => {
          const todo = state.todos.find((item) => item.id === todoId);
          if (!todo) {
            return state;
          }

          const now = new Date().toISOString();
          const nextStatus = done ? 'done' : 'todo';
          if (todo.noteId) {
            const note = state.notes.find((item) => item.id === todo.noteId);
            if (!note) {
              return state;
            }

            const occurrence = taskLineIndexFor(note, todo);
            if (occurrence < 0) {
              return state;
            }

            const nextContent = updateTodoStatusInContent(note.content, occurrence, nextStatus);
            return {
              notes: state.notes.map((item) =>
                item.id === note.id ? { ...item, content: nextContent, updatedAt: now } : item,
              ),
              todos: reparseTodos(state, nextContent, note.id, todoId, {
                status: nextStatus,
                completedAt: done ? now : undefined,
                updatedAt: now,
              }),
            };
          }

          return {
            todos: state.todos.map((item) =>
              item.id === todoId
                ? { ...item, status: nextStatus, completedAt: done ? now : undefined, updatedAt: now }
                : item,
            ),
          };
        }),
      deleteTodo: (todoId) =>
        set((state) => {
          const todo = state.todos.find((item) => item.id === todoId);
          if (!todo) {
            return state;
          }

          const base = {
            todos: state.todos.filter((item) => item.id !== todoId),
            deletedStack: [{ type: 'todo', todo } as const, ...state.deletedStack].slice(0, 20),
          };

          if (!todo.noteId) {
            return base;
          }

          const note = state.notes.find((item) => item.id === todo.noteId);
          if (!note) {
            return base;
          }

          const occurrence = taskLineIndexFor(note, todo);
          if (occurrence < 0) {
            return base;
          }

          const now = new Date().toISOString();
          const nextContent = removeTodoFromContent(note.content, occurrence);
          return {
            ...base,
            notes: state.notes.map((item) =>
              item.id === note.id ? { ...item, content: nextContent, updatedAt: now } : item,
            ),
            todos: reparseTodos({ ...state, todos: base.todos }, nextContent, note.id, undefined, {}),
          };
        }),
      undoLastDelete: () =>
        set((state) => {
          const [snapshot, ...rest] = state.deletedStack;
          if (!snapshot) {
            return state;
          }

          if (snapshot.type === 'note') {
            return {
              notes: [snapshot.note, ...state.notes.filter((note) => note.id !== snapshot.note.id)],
              todos: [...snapshot.todos, ...state.todos.filter((todo) => todo.noteId !== snapshot.note.id)],
              selectedNoteId: snapshot.note.id,
              activeSection: 'notes',
              recentNoteIds: snapshot.recentNoteIds,
              deletedStack: rest,
            };
          }

          const restoredTodo = snapshot.todo;
          const base = {
            todos: [restoredTodo, ...state.todos.filter((todo) => todo.id !== restoredTodo.id)],
            activeSection: 'plan' as const,
            deletedStack: rest,
          };

          if (!restoredTodo.noteId) {
            return base;
          }

          const note = state.notes.find((item) => item.id === restoredTodo.noteId);
          if (!note) {
            return base;
          }

          // Put the task line back so the note body stays the source of truth.
          const now = new Date().toISOString();
          const occurrence = noteTodos(note).length;
          const lines = note.content.split('\n');
          const insertAt = Math.min(occurrence, lines.length);
          lines.splice(
            insertAt,
            0,
            `- [${restoredTodo.status === 'done' ? 'x' : ' '}] ${restoredTodo.title}`,
          );
          const nextContent = lines.join('\n').trim();
          const nextNote = { ...note, content: nextContent, updatedAt: now };

          return {
            ...base,
            notes: state.notes.map((item) => (item.id === nextNote.id ? nextNote : item)),
            todos: [
              ...reparseTodos({ ...state, todos: base.todos }, nextContent, nextNote.id, restoredTodo.id, {
                start: restoredTodo.start,
                days: restoredTodo.days,
                due: restoredTodo.due,
                priority: restoredTodo.priority,
                createdAt: restoredTodo.createdAt,
                completedAt: restoredTodo.completedAt,
              }),
              ...base.todos.filter((todo) => todo.noteId !== nextNote.id),
            ],
          };
        }),
    }),
    {
      name: 'otter-note-store',
      storage: createJSONStorage(() => appStorage),
      partialize: ({
        activeSection: _activeSection,
        query: _query,
        searchFocused: _searchFocused,
        captureDraft: _captureDraft,
        captureFocusNonce: _captureFocusNonce,
        pendingReviewDate: _pendingReviewDate,
        ...state
      }) => stripPendingDeletes(state),
      merge: (persistedState, currentState) => {
        const persisted = migratePersistedState(
          persistedState as (Partial<AppState> & { activities?: unknown; entries?: unknown }) | undefined,
        );
        return {
          ...currentState,
          ...persisted,
          shortcuts: migrateShortcuts(persisted.shortcuts),
          deletedStack: persisted.deletedStack ?? [],
          recentNoteIds: persisted.recentNoteIds ?? [],
          locale: persisted.locale ?? defaultLocale,
          theme: persisted.theme ?? defaultTheme,
          notes: persisted.notes ?? [],
          todos: persisted.todos ?? [],
        };
      },
    },
  ),
);

export function snapshotAppState(state: AppState): AppStateSnapshot {
  return {
    activeSection: state.activeSection,
    selectedNoteId: state.selectedNoteId,
    query: state.query,
    searchFocused: state.searchFocused,
    notes: state.notes,
    todos: state.todos,
    recentNoteIds: state.recentNoteIds,
    shortcuts: state.shortcuts,
    theme: state.theme,
    locale: state.locale,
    deletedStack: state.deletedStack,
  };
}

/**
 * Reads inline `- [ ]` lines of `note` into todos, reusing existing todo ids
 * (and their schedule/priority/completion) by matching titles in order so an
 * edit does not wipe scheduling.
 */
function todosForNote(note: Note, todos: Todo[]): Todo[] {
  const now = new Date().toISOString();
  const reusable = todos.filter((todo) => todo.noteId === note.id).map((todo) => ({ ...todo }));

  return parseTodosFromContent(note.content).map((parsed) => {
    const index = reusable.findIndex((todo) => todo.title === parsed.title);
    const previous = index >= 0 ? reusable.splice(index, 1)[0] : undefined;
    const status = previous?.status ?? parsed.status;

    return {
      id: previous?.id ?? createId('todo'),
      noteId: note.id,
      title: parsed.title,
      status,
      source: 'note' as const,
      createdAt: previous?.createdAt ?? now,
      updatedAt: previous?.updatedAt ?? now,
      completedAt: status === 'done' ? (previous?.completedAt ?? now) : undefined,
      start: previous?.start,
      days: previous?.days,
      due: previous?.due,
      priority: previous?.priority,
    };
  });
}

/** Re-parses `noteId` after its content changed, keeping every other todo. */
function reparseTodos(
  state: AppState,
  content: string,
  noteId: string,
  keepTodoId?: string,
  overrides: Partial<Todo> = {},
): Todo[] {
  const note = state.notes.find((item) => item.id === noteId);
  if (!note) {
    return state.todos;
  }

  // Todos belonging to other notes never compete for this note's task lines.
  const others = state.todos.filter((todo) => todo.noteId !== noteId);
  const owned = state.todos.filter((todo) => todo.noteId === noteId);
  const next = todosForNote({ ...note, content }, [...others, ...owned]);
  if (!keepTodoId) {
    return [...next, ...others];
  }

  // The todo being acted on is authoritative for status and scheduling; when the
  // body no longer has its line (undo restore) it is carried back untouched.
  const kept = owned.find((todo) => todo.id === keepTodoId);
  const matched = next.some((todo) => todo.id === keepTodoId);
  return [
    ...next.map((todo) => (todo.id === keepTodoId ? { ...todo, ...overrides } : todo)),
    ...(!matched && kept ? [{ ...kept, ...overrides }] : []),
    ...others,
  ];
}

/** Inline task lines of a note body, with their zero-based occurrence index. */
export function noteTodos(note: Note): Array<{ occurrence: number; title: string; status: TodoStatus }> {
  return parseTodosFromContent(note.content).map((parsed, occurrence) => ({ ...parsed, occurrence }));
}

/**
 * Index of the task line a todo belongs to inside `note`, matching by title and
 * preferring the same nth duplicate as before so stale indexes never bite.
 * Returns -1 when no line matches.
 */
function taskLineIndexFor(note: Note, todo: Todo, previousNth = 0): number {
  let index = -1;
  let matched = 0;
  for (const line of note.content.split('\n')) {
    if (!isTaskLine(line)) continue;
    index += 1;
    if (todoTitleInLine(line) === todo.title) {
      if (matched === previousNth) return index;
      matched += 1;
    }
  }
  return -1;
}

type LegacyNote = Omit<Note, 'content'> & { content?: string; dailyDate?: string };
type LegacyEntry = { id: string; noteId: string; content: string; createdAt: string; updatedAt: string };
type LegacyTodo = {
  id: string;
  noteId?: string;
  entryId?: string;
  occurrence?: number;
  title: string;
  status: Todo['status'];
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  start?: string;
  days?: number;
  due?: string;
  priority?: TodoPriority;
};

/**
 * Pre-0.2 data split a note into many `entries` ("records"). Those are merged
 * into one markdown body per note, oldest first, and entry-bound todos are
 * re-pointed at the note.
 */
const snapshotDefaults: Omit<AppStateSnapshot, 'notes' | 'todos'> = {
  activeSection: 'notes',
  selectedNoteId: undefined,
  query: '',
  searchFocused: false,
  recentNoteIds: [],
  shortcuts: defaultShortcuts,
  theme: defaultTheme,
  locale: defaultLocale,
  deletedStack: [],
};

function legacyTodoBase(todo: LegacyTodo): Omit<Todo, 'source'> {
  const timestamp = todo.updatedAt ?? todo.createdAt ?? new Date().toISOString();
  return {
    id: todo.id,
    noteId: todo.noteId,
    title: todo.title,
    status: todo.status,
    createdAt: todo.createdAt ?? timestamp,
    updatedAt: todo.updatedAt ?? timestamp,
    completedAt: todo.completedAt,
    start: todo.start,
    days: todo.days,
    due: todo.due,
    priority: todo.priority,
  };
}

type PersistedAppState = Omit<Partial<AppStateSnapshot>, 'notes' | 'todos'> & {
  activities?: unknown;
  notes?: LegacyNote[];
  todos?: LegacyTodo[];
  entries?: unknown;
};

function migratePersistedState(persisted?: PersistedAppState): AppStateSnapshot {
  const {
    activities: _activities,
    activeSection: _activeSection,
    query: _query,
    searchFocused: _searchFocused,
    entries: legacyEntries,
    ...rest
  } = persisted ?? {};

  const { notes: legacyNotes, todos: legacyTodos, ...ui } = rest as PersistedAppState;
  const notes: Note[] = (legacyNotes ?? []).map(({ dailyDate: _dailyDate, ...note }) => ({
    ...note,
    content: note.content ?? '',
  }));

  const entries = (Array.isArray(legacyEntries) ? legacyEntries : []) as LegacyEntry[];

  // The desktop store always writes an `entries` key, so its presence cannot
  // mark legacy data: only actual entry records can.
  if (entries.length === 0) {
    // Current shape: task lines live in the note body and todos are matched to
    // them by title at use time, so nothing else needs re-deriving here.
    const todos = (legacyTodos ?? []).map<Todo>((todo) => {
      const base = legacyTodoBase(todo);
      const note = todo.noteId ? notes.find((item) => item.id === todo.noteId) : undefined;
      if (!note) {
        return { ...base, source: 'standalone' as const };
      }

      return { ...base, noteId: note.id, source: 'note' as const };
    });

    return { ...snapshotDefaults, ...ui, notes, todos };
  }

  const byNote = new Map<string, LegacyEntry[]>();
  entries.forEach((entry) => {
    const bucket = byNote.get(entry.noteId);
    if (bucket) {
      bucket.push(entry);
    } else {
      byNote.set(entry.noteId, [entry]);
    }
  });
  byNote.forEach((list) => list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  notes.forEach((note) => {
    if (note.content.trim()) {
      return;
    }

    note.content = (byNote.get(note.id) ?? [])
      .map((entry) => entry.content.trim())
      .filter(Boolean)
      .join('\n\n');
  });

  // Entry-bound todos are re-pointed at the note.
  const todos: Todo[] = (legacyTodos ?? []).map<Todo>((todo) => {
    const base = legacyTodoBase(todo);
    const entry = todo.entryId ? entryById.get(todo.entryId) : undefined;
    const noteId = todo.noteId ?? entry?.noteId;
    const owned = noteId ? notes.find((note) => note.id === noteId) : undefined;
    if (!owned) {
      return { ...base, source: 'standalone' as const };
    }

    return { ...base, noteId: owned.id, source: 'note' as const };
  });

  return { ...snapshotDefaults, ...ui, notes, todos };
}
