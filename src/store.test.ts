import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultShortcuts,
  defaultTheme,
  snapshotAppState,
  useAppStore,
  type AppStateSnapshot,
} from './store';

function resetStore() {
  useAppStore.setState({
    activeSection: 'notes',
    selectedNoteId: undefined,
    query: '',
    searchFocused: false,
    notes: [],
    entries: [],
    todos: [],
    recentNoteIds: [],
    shortcuts: defaultShortcuts,
    theme: defaultTheme,
    deletedStack: [],
  });
}

function addNoteWithEntry(content: string, title?: string) {
  useAppStore.getState().createNoteWithEntry(content, title);
  const state = useAppStore.getState();
  const note = state.notes[0];
  if (!note) throw new Error('expected a note to be created');
  return note;
}

beforeEach(() => {
  resetStore();
});

describe('createNote', () => {
  it('creates and selects a note with a placeholder title', () => {
    useAppStore.getState().createNote();
    const state = useAppStore.getState();

    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].title).toBe('Untitled Note');
    expect(state.selectedNoteId).toBe(state.notes[0].id);
    expect(state.activeSection).toBe('notes');
  });

  it('trims the provided title', () => {
    useAppStore.getState().createNote('  Shopping  ');
    expect(useAppStore.getState().notes[0].title).toBe('Shopping');
  });

  it('tracks recent notes without duplicates', () => {
    useAppStore.getState().createNote('First');
    const first = useAppStore.getState().notes[0];
    useAppStore.getState().createNote('Second');
    const second = useAppStore.getState().notes[0];
    useAppStore.getState().selectNote(first.id);

    expect(useAppStore.getState().recentNoteIds).toEqual([first.id, second.id]);
  });

  it('keeps at most ten recent notes', () => {
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      useAppStore.getState().createNote(`Note ${index}`);
      ids.push(useAppStore.getState().notes[0].id);
    }

    const recent = useAppStore.getState().recentNoteIds;
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe(ids[11]);
    expect(recent).not.toContain(ids[0]);
  });
});

describe('createNoteWithEntry', () => {
  it('creates an entry and parses inline todos', () => {
    const note = addNoteWithEntry('- [ ] Buy milk\n- [x] Pay rent');
    const state = useAppStore.getState();

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].noteId).toBe(note.id);
    expect(state.todos.map((todo) => [todo.title, todo.status, todo.source])).toEqual([
      ['Buy milk', 'todo', 'entry'],
      ['Pay rent', 'done', 'entry'],
    ]);
  });

  it('derives the title from the first line', () => {
    const note = addNoteWithEntry('# Weekend plans\n\nGo hiking');
    expect(note.title).toBe('Weekend plans');
  });

  it('prefers an explicit title', () => {
    const note = addNoteWithEntry('# Weekend plans', 'Custom');
    expect(note.title).toBe('Custom');
  });
});

describe('addEntry', () => {
  it('attaches the entry to the note and updates its timestamp', () => {
    const note = addNoteWithEntry('first');
    const before = useAppStore.getState().notes[0].updatedAt;

    useAppStore.getState().addEntry(note.id, '- [ ] Follow up');
    const state = useAppStore.getState();

    expect(state.entries.filter((entry) => entry.noteId === note.id)).toHaveLength(2);
    expect(state.todos.some((todo) => todo.title === 'Follow up')).toBe(true);
    expect(state.notes[0].updatedAt >= before).toBe(true);
  });
});

describe('updateEntry', () => {
  it('reuses todos that keep the same title so their ids and status survive', () => {
    const note = addNoteWithEntry('- [x] Buy milk');
    const [todo] = useAppStore.getState().todos;
    const entry = useAppStore.getState().entries[0];

    useAppStore.getState().updateEntry(entry.id, '- [x] Buy milk\n- [ ] Call mum');
    const state = useAppStore.getState();
    const reusable = state.todos.find((item) => item.title === 'Buy milk');
    const added = state.todos.find((item) => item.title === 'Call mum');

    expect(reusable?.id).toBe(todo.id);
    expect(reusable?.status).toBe('done');
    expect(added?.status).toBe('todo');
    expect(state.entries.find((item) => item.id === entry.id)?.noteId).toBe(note.id);
  });

  it('removes todos that are no longer present in the content', () => {
    addNoteWithEntry('- [ ] Buy milk');
    const entry = useAppStore.getState().entries[0];

    useAppStore.getState().updateEntry(entry.id, 'Nothing to do');
    expect(useAppStore.getState().todos).toEqual([]);
  });

  it('ignores unknown entries', () => {
    useAppStore.getState().updateEntry('missing', 'content');
    expect(useAppStore.getState().entries).toEqual([]);
  });
});

describe('toggleTodo', () => {
  it('updates markdown content for todos parsed from an entry', () => {
    addNoteWithEntry('- [ ] Buy milk');
    const todo = useAppStore.getState().todos[0];

    useAppStore.getState().toggleTodo(todo.id, true);
    const state = useAppStore.getState();

    expect(state.entries[0].content).toBe('- [x] Buy milk');
    expect(state.todos[0].status).toBe('done');
    expect(state.todos[0].completedAt).toBeDefined();
  });

  it('clears the completion time when a todo is reopened', () => {
    addNoteWithEntry('- [x] Buy milk');
    const todo = useAppStore.getState().todos[0];

    useAppStore.getState().toggleTodo(todo.id, false);
    const state = useAppStore.getState();

    expect(state.entries[0].content).toBe('- [ ] Buy milk');
    expect(state.todos[0].status).toBe('todo');
    expect(state.todos[0].completedAt).toBeUndefined();
  });

  it('toggles standalone todos without touching entries', () => {
    useAppStore.getState().createStandaloneTodo('Water plants');
    const todo = useAppStore.getState().todos[0];

    expect(todo.source).toBe('standalone');
    useAppStore.getState().toggleTodo(todo.id, true);

    expect(useAppStore.getState().todos[0].status).toBe('done');
    expect(useAppStore.getState().entries).toEqual([]);
  });

  it('ignores unknown todos', () => {
    useAppStore.getState().createStandaloneTodo('Water plants');
    useAppStore.getState().toggleTodo('missing', true);
    expect(useAppStore.getState().todos[0].status).toBe('todo');
  });
});

describe('deleteNote', () => {
  it('removes the note with its entries and todos and clears the selection', () => {
    const note = addNoteWithEntry('- [ ] Buy milk');
    const state = useAppStore.getState();

    useAppStore.getState().deleteNote(note.id);
    const next = useAppStore.getState();

    expect(next.notes).toEqual([]);
    expect(next.entries).toEqual([]);
    expect(next.todos).toEqual([]);
    expect(next.selectedNoteId).toBeUndefined();
    expect(next.activeSection).toBe('timeline');
    expect(next.deletedStack).toHaveLength(1);
    expect(state.notes).toHaveLength(1);
  });

  it('ignores unknown notes', () => {
    useAppStore.getState().deleteNote('missing');
    expect(useAppStore.getState().deletedStack).toEqual([]);
  });

  it('keeps the deleted stack bounded', () => {
    const notes = Array.from({ length: 21 }, (_, index) =>
      addNoteWithEntry(`note ${index}`, `Note ${index}`),
    );

    notes.forEach((note) => useAppStore.getState().deleteNote(note.id));
    expect(useAppStore.getState().deletedStack).toHaveLength(20);
  });
});

describe('undoLastDelete', () => {
  it('restores a deleted note with its entries, todos, and recent list', () => {
    const note = addNoteWithEntry('- [ ] Buy milk');
    const before = useAppStore.getState();
    const recentBefore = before.recentNoteIds;

    useAppStore.getState().deleteNote(note.id);
    useAppStore.getState().undoLastDelete();
    const after = useAppStore.getState();

    expect(after.notes).toHaveLength(1);
    expect(after.notes[0].id).toBe(note.id);
    expect(after.entries).toHaveLength(1);
    expect(after.todos).toHaveLength(1);
    expect(after.recentNoteIds).toEqual(recentBefore);
    expect(after.selectedNoteId).toBe(note.id);
    expect(after.deletedStack).toEqual([]);
  });

  it('restores a deleted entry and its todos', () => {
    addNoteWithEntry('- [ ] Buy milk');
    const entry = useAppStore.getState().entries[0];

    useAppStore.getState().deleteEntry(entry.id);
    expect(useAppStore.getState().entries).toEqual([]);

    useAppStore.getState().undoLastDelete();
    expect(useAppStore.getState().entries).toHaveLength(1);
    expect(useAppStore.getState().todos).toHaveLength(1);
  });

  it('restores a deleted todo', () => {
    addNoteWithEntry('- [ ] Buy milk');
    const todo = useAppStore.getState().todos[0];

    useAppStore.getState().deleteTodo(todo.id);
    expect(useAppStore.getState().todos).toEqual([]);

    useAppStore.getState().undoLastDelete();
    expect(useAppStore.getState().todos).toHaveLength(1);
    expect(useAppStore.getState().todos[0].id).toBe(todo.id);
  });

  it('does nothing when the stack is empty', () => {
    addNoteWithEntry('kept');
    const before = useAppStore.getState().notes;

    useAppStore.getState().undoLastDelete();
    expect(useAppStore.getState().notes).toEqual(before);
  });
});

describe('preferences', () => {
  it('normalizes shortcut modifiers', () => {
    useAppStore.getState().updateShortcut('save', 'command+s');
    expect(useAppStore.getState().shortcuts.save).toBe('Cmd+s');
  });

  it('stores the selected theme and navigation state', () => {
    useAppStore.getState().setTheme('dark');
    useAppStore.getState().setActiveSection('timeline');
    useAppStore.getState().setQuery('milk');
    useAppStore.getState().setSearchFocused(true);

    const state = useAppStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.activeSection).toBe('timeline');
    expect(state.query).toBe('milk');
    expect(state.searchFocused).toBe(true);

    useAppStore.getState().clearSelectedNote();
    expect(useAppStore.getState().selectedNoteId).toBeUndefined();
  });
});

describe('replaceAppState', () => {
  it('applies an imported snapshot and fills in missing shortcuts', () => {
    const note = addNoteWithEntry('imported');
    const snapshot = snapshotAppState(useAppStore.getState());

    resetStore();
    useAppStore.getState().replaceAppState({
      ...snapshot,
      shortcuts: { save: 'Ctrl+S' } as AppStateSnapshot['shortcuts'],
    });

    const state = useAppStore.getState();
    expect(state.notes[0].id).toBe(note.id);
    expect(state.shortcuts.save).toBe('Cmd+S');
    expect(state.shortcuts.new).toBe(defaultShortcuts.new);
  });
});

describe('snapshotAppState', () => {
  it('copies the persisted fields', () => {
    const note = addNoteWithEntry('content');
    const snapshot = snapshotAppState(useAppStore.getState());

    expect(snapshot.notes[0].id).toBe(note.id);
    expect(snapshot.theme).toBe(defaultTheme);
    expect(snapshot.deletedStack).toEqual([]);
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'activeSection',
        'deletedStack',
        'entries',
        'notes',
        'query',
        'recentNoteIds',
        'searchFocused',
        'selectedNoteId',
        'shortcuts',
        'theme',
        'todos',
      ].sort(),
    );
  });
});
