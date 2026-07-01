import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createId } from './id';
import { appStorage } from './storage';
import { parseTodosFromEntry } from './todo-parser';

export type NavSection = 'new' | 'notes' | 'todos' | 'timeline' | 'images' | 'settings' | 'help';
export type TodoStatus = 'todo' | 'done';
export type Note = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type NoteEntry = {
  id: string;
  noteId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type Todo = {
  id: string;
  noteId?: string;
  entryId?: string;
  title: string;
  status: TodoStatus;
  source: 'entry' | 'standalone';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type ShortcutAction = 'save' | 'edit' | 'delete' | 'undo';
export type ShortcutConfig = Record<ShortcutAction, string>;
export type ThemeMode = 'light' | 'dark';

type DeletedSnapshot =
  | {
      type: 'note';
      note: Note;
      entries: NoteEntry[];
      todos: Todo[];
      recentNoteIds: string[];
    }
  | {
      type: 'entry';
      entry: NoteEntry;
      todos: Todo[];
    }
  | {
      type: 'todo';
      todo: Todo;
    };

type AppState = {
  activeSection: NavSection;
  selectedNoteId?: string;
  query: string;
  notes: Note[];
  entries: NoteEntry[];
  todos: Todo[];
  recentNoteIds: string[];
  shortcuts: ShortcutConfig;
  theme: ThemeMode;
  deletedStack: DeletedSnapshot[];
  setActiveSection: (section: NavSection) => void;
  clearSelectedNote: () => void;
  setQuery: (query: string) => void;
  updateShortcut: (action: ShortcutAction, shortcut: string) => void;
  setTheme: (theme: ThemeMode) => void;
  replaceAppState: (state: AppStateSnapshot) => void;
  createNote: () => void;
  createNoteWithEntry: (content: string) => void;
  selectNote: (noteId: string) => void;
  updateNoteTitle: (noteId: string, title: string) => void;
  deleteNote: (noteId: string) => void;
  addEntry: (noteId: string, content: string) => void;
  updateEntry: (entryId: string, content: string) => void;
  deleteEntry: (entryId: string) => void;
  createStandaloneTodo: (title: string) => void;
  toggleTodo: (todoId: string, done: boolean) => void;
  deleteTodo: (todoId: string) => void;
  undoLastDelete: () => void;
};

export type AppStateSnapshot = Pick<
  AppState,
  | 'activeSection'
  | 'selectedNoteId'
  | 'query'
  | 'notes'
  | 'entries'
  | 'todos'
  | 'recentNoteIds'
  | 'shortcuts'
  | 'theme'
  | 'deletedStack'
>;

export const defaultShortcuts: ShortcutConfig = {
  save: 'Mod+S',
  edit: 'Mod+E',
  delete: 'Mod+Backspace',
  undo: 'Mod+Shift+Z',
};

export const defaultTheme: ThemeMode = 'light';

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeSection: 'timeline',
      query: '',
      notes: [],
      entries: [],
      todos: [],
      recentNoteIds: [],
      shortcuts: defaultShortcuts,
      theme: defaultTheme,
      deletedStack: [],
      setActiveSection: (section) => set({ activeSection: section }),
      clearSelectedNote: () => set({ selectedNoteId: undefined }),
      setQuery: (query) => set({ query }),
      updateShortcut: (action, shortcut) =>
        set((state) => ({
          shortcuts: {
            ...state.shortcuts,
            [action]: shortcut,
          },
        })),
      setTheme: (theme) => set({ theme }),
      replaceAppState: (snapshot) =>
        set({
          activeSection: snapshot.activeSection,
          selectedNoteId: snapshot.selectedNoteId,
          query: snapshot.query,
          notes: snapshot.notes,
          entries: snapshot.entries,
          todos: snapshot.todos,
          recentNoteIds: snapshot.recentNoteIds,
          shortcuts: {
            ...defaultShortcuts,
            ...snapshot.shortcuts,
          },
          theme: snapshot.theme ?? defaultTheme,
          deletedStack: snapshot.deletedStack,
        }),
      createNote: () =>
        set((state) => {
          const now = new Date().toISOString();
          const note: Note = {
            id: createId('note'),
            title: 'Untitled Note',
            createdAt: now,
            updatedAt: now,
          };
          return {
            activeSection: 'notes',
            selectedNoteId: note.id,
            recentNoteIds: [note.id, ...state.recentNoteIds.filter((id) => id !== note.id)].slice(0, 10),
            notes: [note, ...state.notes],
          };
        }),
      createNoteWithEntry: (content) =>
        set((state) => {
          const now = new Date().toISOString();
          const title = firstTitleFromContent(content);
          const note: Note = {
            id: createId('note'),
            title,
            createdAt: now,
            updatedAt: now,
          };
          const entry: NoteEntry = {
            id: createId('entry'),
            noteId: note.id,
            content,
            createdAt: now,
            updatedAt: now,
          };
          const todos: Todo[] = parseTodosFromEntry(content).map((todo) => ({
            id: createId('todo'),
            noteId: note.id,
            entryId: entry.id,
            title: todo.title,
            status: todo.status,
            source: 'entry',
            createdAt: now,
            updatedAt: now,
            completedAt: todo.status === 'done' ? now : undefined,
          }));
          return {
            activeSection: 'notes',
            selectedNoteId: note.id,
            recentNoteIds: [note.id, ...state.recentNoteIds.filter((id) => id !== note.id)].slice(0, 10),
            notes: [note, ...state.notes],
            entries: [entry, ...state.entries],
            todos: [...todos, ...state.todos],
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
      deleteNote: (noteId) =>
        set((state) => {
          const note = state.notes.find((item) => item.id === noteId);
          if (!note) {
            return state;
          }
          const now = new Date().toISOString();
          const entries = state.entries.filter((entry) => entry.noteId === noteId);
          const todos = state.todos.filter((todo) => todo.noteId === noteId);
          return {
            selectedNoteId: state.selectedNoteId === noteId ? undefined : state.selectedNoteId,
            activeSection: state.selectedNoteId === noteId ? 'timeline' : state.activeSection,
            recentNoteIds: state.recentNoteIds.filter((id) => id !== noteId),
            notes: state.notes.filter((item) => item.id !== noteId),
            entries: state.entries.filter((entry) => entry.noteId !== noteId),
            todos: state.todos.filter((todo) => todo.noteId !== noteId),
            deletedStack: [
              {
                type: 'note',
                note,
                entries,
                todos,
                recentNoteIds: state.recentNoteIds,
              } as const,
              ...state.deletedStack,
            ].slice(0, 20),
          };
        }),
      addEntry: (noteId, content) =>
        set((state) => {
          const now = new Date().toISOString();
          const entry: NoteEntry = {
            id: createId('entry'),
            noteId,
            content,
            createdAt: now,
            updatedAt: now,
          };
          const parsedTodos = parseTodosFromEntry(content);
          const todos: Todo[] = parsedTodos.map((todo) => ({
            id: createId('todo'),
            noteId,
            entryId: entry.id,
            title: todo.title,
            status: todo.status,
            source: 'entry',
            createdAt: now,
            updatedAt: now,
            completedAt: todo.status === 'done' ? now : undefined,
          }));
          const noteTitle = state.notes.find((note) => note.id === noteId)?.title ?? 'Untitled Note';
          return {
            entries: [...state.entries, entry],
            todos: [...todos, ...state.todos],
            notes: state.notes.map((note) => (note.id === noteId ? { ...note, updatedAt: now } : note)),
          };
        }),
      updateEntry: (entryId, content) =>
        set((state) => {
          const existingEntry = state.entries.find((entry) => entry.id === entryId);
          if (!existingEntry) {
            return state;
          }

          const now = new Date().toISOString();
          const existingTodos = state.todos.filter((todo) => todo.entryId === entryId);
          const reusableTodos = [...existingTodos];
          const parsedTodos = parseTodosFromEntry(content);

          const updatedTodos: Todo[] = parsedTodos.map((parsedTodo) => {
            const reusableIndex = reusableTodos.findIndex((todo) => todo.title === parsedTodo.title);
            const reusable = reusableIndex >= 0 ? reusableTodos.splice(reusableIndex, 1)[0] : undefined;

            return {
              id: reusable?.id ?? createId('todo'),
              noteId: existingEntry.noteId,
              entryId,
              title: parsedTodo.title,
              status: reusable?.status ?? parsedTodo.status,
              source: 'entry',
              createdAt: reusable?.createdAt ?? now,
              updatedAt: now,
              completedAt:
                (reusable?.status ?? parsedTodo.status) === 'done'
                  ? reusable?.completedAt ?? now
                  : undefined,
            };
          });

          const noteTitle =
            state.notes.find((note) => note.id === existingEntry.noteId)?.title || 'Untitled Note';
          return {
            entries: state.entries.map((entry) =>
              entry.id === entryId ? { ...entry, content, updatedAt: now } : entry,
            ),
            todos: [
              ...updatedTodos,
              ...state.todos.filter((todo) => todo.entryId !== entryId),
            ],
            notes: state.notes.map((note) =>
              note.id === existingEntry.noteId ? { ...note, updatedAt: now } : note,
            ),
          };
        }),
      deleteEntry: (entryId) =>
        set((state) => {
          const entry = state.entries.find((item) => item.id === entryId);
          if (!entry) {
            return state;
          }

          const now = new Date().toISOString();
          const noteTitle = state.notes.find((note) => note.id === entry.noteId)?.title || 'Untitled Note';
          const todos = state.todos.filter((todo) => todo.entryId === entryId);
          return {
            entries: state.entries.filter((item) => item.id !== entryId),
            todos: state.todos.filter((todo) => todo.entryId !== entryId),
            notes: state.notes.map((note) =>
              note.id === entry.noteId ? { ...note, updatedAt: now } : note,
            ),
            deletedStack: [
              {
                type: 'entry',
                entry,
                todos,
              } as const,
              ...state.deletedStack,
            ].slice(0, 20),
          };
        }),
      createStandaloneTodo: (title) =>
        set((state) => {
          const now = new Date().toISOString();
          const todo: Todo = {
            id: createId('todo'),
            title,
            status: 'todo',
            source: 'standalone',
            createdAt: now,
            updatedAt: now,
          };
          return {
            activeSection: 'todos',
            todos: [todo, ...state.todos],
          };
        }),
      toggleTodo: (todoId, done) =>
        set((state) => {
          const now = new Date().toISOString();
          return {
            todos: state.todos.map((item) =>
              item.id === todoId
                ? {
                    ...item,
                    status: done ? 'done' : 'todo',
                    completedAt: done ? now : undefined,
                    updatedAt: now,
                  }
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
          const now = new Date().toISOString();
          return {
            todos: state.todos.filter((item) => item.id !== todoId),
            deletedStack: [
              {
                type: 'todo',
                todo,
              } as const,
              ...state.deletedStack,
            ].slice(0, 20),
          };
        }),
      undoLastDelete: () =>
        set((state) => {
          const [snapshot, ...rest] = state.deletedStack;
          if (!snapshot) {
            return state;
          }

          const now = new Date().toISOString();
          if (snapshot.type === 'note') {
            return {
              notes: [snapshot.note, ...state.notes.filter((note) => note.id !== snapshot.note.id)],
              entries: [
                ...snapshot.entries,
                ...state.entries.filter((entry) => entry.noteId !== snapshot.note.id),
              ],
              todos: [
                ...snapshot.todos,
                ...state.todos.filter((todo) => todo.noteId !== snapshot.note.id),
              ],
              selectedNoteId: snapshot.note.id,
              activeSection: 'notes',
              recentNoteIds: snapshot.recentNoteIds,
              deletedStack: rest,
            };
          }

          if (snapshot.type === 'entry') {
            return {
              entries: [snapshot.entry, ...state.entries.filter((entry) => entry.id !== snapshot.entry.id)],
              todos: [
                ...snapshot.todos,
                ...state.todos.filter((todo) => todo.entryId !== snapshot.entry.id),
              ],
              selectedNoteId: snapshot.entry.noteId,
              activeSection: 'notes',
              deletedStack: rest,
            };
          }

          return {
            todos: [snapshot.todo, ...state.todos.filter((todo) => todo.id !== snapshot.todo.id)],
            activeSection: 'todos',
            deletedStack: rest,
          };
        }),
    }),
    {
      name: 'otter-note-store',
      storage: createJSONStorage(() => appStorage),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(() => {
          const { activities: _activities, ...rest } = persistedState as Partial<AppState> & { activities?: unknown };
          return rest;
        })(),
        shortcuts: {
          ...defaultShortcuts,
          ...(persistedState as Partial<AppState>)?.shortcuts,
        },
        deletedStack: (persistedState as Partial<AppState>)?.deletedStack ?? [],
        recentNoteIds: (persistedState as Partial<AppState>)?.recentNoteIds ?? [],
      }),
    },
  ),
);

export function snapshotAppState(state: AppState): AppStateSnapshot {
  return {
    activeSection: state.activeSection,
    selectedNoteId: state.selectedNoteId,
    query: state.query,
    notes: state.notes,
    entries: state.entries,
    todos: state.todos,
    recentNoteIds: state.recentNoteIds,
    shortcuts: state.shortcuts,
    theme: state.theme,
    deletedStack: state.deletedStack,
  };
}

function firstTitleFromContent(content: string) {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.match(/^[-*]\s+\[( |x|X)\]/));

  if (!firstLine) {
    return 'Untitled Note';
  }

  return firstLine.replace(/^#+\s*/, '').slice(0, 80);
}
