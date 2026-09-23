import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultShortcuts,
  defaultTheme,
  migrateShortcuts,
  snapshotAppState,
  stripPendingDeletes,
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
    todos: [],
    recentNoteIds: [],
    shortcuts: defaultShortcuts,
    theme: defaultTheme,
    deletedStack: [],
  });
}

function addNote(content: string, title?: string) {
  useAppStore.getState().createNote(title, content);
  const note = useAppStore.getState().notes[0];
  if (!note) throw new Error('expected a note to be created');
  return note;
}

function latestNote() {
  const state = useAppStore.getState();
  return state.notes.find((note) => note.id === state.selectedNoteId)!;
}

beforeEach(() => {
  resetStore();
});

describe('createNote', () => {
  it('creates and selects an empty note with a placeholder title', () => {
    useAppStore.getState().createNote();
    const state = useAppStore.getState();

    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].title).toBe('Untitled Note');
    expect(state.notes[0].content).toBe('');
    expect(state.selectedNoteId).toBe(state.notes[0].id);
    expect(state.activeSection).toBe('notes');
  });

  it('trims the provided title', () => {
    useAppStore.getState().createNote('  Shopping  ');
    expect(useAppStore.getState().notes[0].title).toBe('Shopping');
  });

  it('parses inline todos and derives the title from the first line', () => {
    const note = addNote('- [ ] Buy milk\n- [x] Pay rent');
    const state = useAppStore.getState();

    expect(note.title).toBe('Buy milk');
    expect(state.todos.map((todo) => [todo.title, todo.status, todo.source])).toEqual([
      ['Buy milk', 'todo', 'note'],
      ['Pay rent', 'done', 'note'],
    ]);
  });

  it('prefers an explicit title', () => {
    const note = addNote('# Weekend plans', 'Custom');
    expect(note.title).toBe('Custom');
  });

  it('tracks recent notes without duplicates', () => {
    const first = addNote('First');
    const second = addNote('Second');
    useAppStore.getState().selectNote(first.id);

    expect(useAppStore.getState().recentNoteIds).toEqual([first.id, second.id]);
  });

  it('keeps at most ten recent notes', () => {
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      ids.push(addNote(`body ${index}`, `Note ${index}`).id);
    }

    const recent = useAppStore.getState().recentNoteIds;
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe(ids[11]);
    expect(recent).not.toContain(ids[0]);
  });
});

describe('updateNoteContent', () => {
  it('reuses todos that keep the same title so their ids and status survive', () => {
    const note = addNote('- [x] Buy milk');
    const [todo] = useAppStore.getState().todos;

    useAppStore.getState().updateNoteContent(note.id, '- [x] Buy milk\n- [ ] Call mum');
    const state = useAppStore.getState();
    const reusable = state.todos.find((item) => item.title === 'Buy milk');
    const added = state.todos.find((item) => item.title === 'Call mum');

    expect(reusable?.id).toBe(todo.id);
    expect(reusable?.status).toBe('done');
    expect(added?.status).toBe('todo');
    expect(state.notes[0].content).toBe('- [x] Buy milk\n- [ ] Call mum');
  });

  it('keeps scheduling of a todo whose line moved', () => {
    const note = addNote('- [ ] Buy milk');
    const todo = useAppStore.getState().todos[0];
    useAppStore.getState().scheduleTodo(todo.id, { start: '2026-09-21', days: 2 });

    useAppStore.getState().updateNoteContent(note.id, '- [ ] Header\n- [ ] Buy milk');
    const moved = useAppStore.getState().todos.find((item) => item.title === 'Buy milk');

    expect(moved?.id).toBe(todo.id);
    expect(moved?.start).toBe('2026-09-21');
    expect(moved?.due).toBe('2026-09-22');
  });

  it('toggles a todo whose title no longer matches its task line', () => {
    const note = addNote('- [ ] Buy milk\n- [ ] Call mum');
    useAppStore.getState().updateNoteContent(note.id, '- [ ] Buy milk\n- [ ] Call mum tonight');
    const renamed = useAppStore.getState().todos.find((item) => item.title === 'Call mum tonight');
    const total = useAppStore.getState().todos.length;

    useAppStore.getState().toggleTodo(renamed!.id, true);
    const state = useAppStore.getState();

    expect(state.todos).toHaveLength(total);
    expect(state.todos.find((item) => item.id === renamed!.id)).toMatchObject({
      status: 'done',
    });
    expect(state.notes[0].content).toBe('- [ ] Buy milk\n- [x] Call mum tonight');
  });

  it('removes todos that are no longer present in the content', () => {
    const note = addNote('- [ ] Buy milk');
    useAppStore.getState().updateNoteContent(note.id, 'Nothing to do');
    expect(useAppStore.getState().todos).toEqual([]);
  });

  it('ignores unknown notes', () => {
    useAppStore.getState().updateNoteContent('missing', 'content');
    expect(useAppStore.getState().notes).toEqual([]);
  });
});

describe('toggleTodo', () => {
  it('rewrites the task line of the source note', () => {
    addNote('- [ ] Buy milk');
    const todo = useAppStore.getState().todos[0];

    useAppStore.getState().toggleTodo(todo.id, true);
    const state = useAppStore.getState();

    expect(state.notes[0].content).toBe('- [x] Buy milk');
    expect(state.todos[0].status).toBe('done');
    expect(state.todos[0].completedAt).toBeDefined();
  });

  it('clears the completion time when a todo is reopened', () => {
    addNote('- [x] Buy milk');
    const todo = useAppStore.getState().todos[0];

    useAppStore.getState().toggleTodo(todo.id, false);
    const state = useAppStore.getState();

    expect(state.notes[0].content).toBe('- [ ] Buy milk');
    expect(state.todos[0].status).toBe('todo');
    expect(state.todos[0].completedAt).toBeUndefined();
  });

  it('toggles standalone todos without touching notes', () => {
    useAppStore.getState().createStandaloneTodo('Water plants');
    const todo = useAppStore.getState().todos[0];

    expect(todo.source).toBe('standalone');
    useAppStore.getState().toggleTodo(todo.id, true);

    expect(useAppStore.getState().todos[0].status).toBe('done');
    expect(useAppStore.getState().notes).toEqual([]);
  });

  it('ignores unknown todos', () => {
    useAppStore.getState().createStandaloneTodo('Water plants');
    useAppStore.getState().toggleTodo('missing', true);
    expect(useAppStore.getState().todos[0].status).toBe('todo');
  });
});

describe('submitQuickTodo', () => {
  it('turns every non-empty line into an unscheduled standalone todo', () => {
    useAppStore.getState().setActiveSection('review');
    useAppStore.getState().submitQuickTodo('- [ ] Reply to issue\nRead the docs later\n\n  ');
    const state = useAppStore.getState();

    expect(state.captureDraft).toBe('');
    expect(state.activeSection).toBe('plan');
    expect(state.todos).toHaveLength(2);
    expect(state.todos.every((todo) => todo.source === 'standalone')).toBe(true);
    expect(state.todos.every((todo) => todo.status === 'todo')).toBe(true);
    expect(state.todos.map((todo) => todo.title)).toEqual(['Reply to issue', 'Read the docs later']);
    expect(state.notes).toEqual([]);
  });

  it('keeps everything untouched when the draft is blank', () => {
    useAppStore.getState().submitQuickTodo('   \n\t');
    const state = useAppStore.getState();

    expect(state.todos).toEqual([]);
    expect(state.notes).toEqual([]);
  });
});

describe('focusCapture', () => {
  it('opens the plan view and bumps the focus signal', () => {
    useAppStore.getState().setActiveSection('notes');
    const before = useAppStore.getState().captureFocusNonce;

    useAppStore.getState().focusCapture();
    const state = useAppStore.getState();

    expect(state.activeSection).toBe('plan');
    expect(state.captureFocusNonce).toBe(before + 1);
  });
});

describe('deleteNote', () => {
  it('removes the note with its todos and clears the selection', () => {
    const note = addNote('- [ ] Buy milk');
    const state = useAppStore.getState();

    useAppStore.getState().deleteNote(note.id);
    const next = useAppStore.getState();

    expect(next.notes).toEqual([]);
    expect(next.todos).toEqual([]);
    expect(next.selectedNoteId).toBeUndefined();
    expect(next.activeSection).toBe('notes');
    expect(next.deletedStack).toHaveLength(1);
    expect(state.notes).toHaveLength(1);
  });

  it('ignores unknown notes', () => {
    useAppStore.getState().deleteNote('missing');
    expect(useAppStore.getState().deletedStack).toEqual([]);
  });

  it('keeps the deleted stack bounded', () => {
    const notes = Array.from({ length: 21 }, (_, index) => addNote(`note ${index}`, `Note ${index}`));

    notes.forEach((note) => useAppStore.getState().deleteNote(note.id));
    expect(useAppStore.getState().deletedStack).toHaveLength(20);
  });
});

describe('stripPendingDeletes', () => {
  it('drops notes and their todos that are pending deletion', () => {
    const note = addNote('- [ ] Buy milk');
    const todo = useAppStore.getState().todos.find((item) => item.noteId === note.id)!;
    const other = addNote('keep me', 'Keep');
    useAppStore.getState().deleteNote(note.id);

    const staleSnapshot = {
      notes: [other, note],
      todos: [...useAppStore.getState().todos, todo],
      deletedStack: useAppStore.getState().deletedStack,
    };
    const stripped = stripPendingDeletes(staleSnapshot);

    expect(stripped.notes.map((item) => item.id)).toEqual([other.id]);
    expect(stripped.todos.every((item) => item.noteId !== note.id)).toBe(true);
  });

  it('returns the same object when nothing is pending deletion', () => {
    const snapshot = { notes: [], todos: [], deletedStack: [] };
    expect(stripPendingDeletes(snapshot)).toBe(snapshot);
  });
});

describe('undoLastDelete', () => {
  it('restores a deleted note with its todos and recent list', () => {
    const note = addNote('- [ ] Buy milk');
    const recentBefore = useAppStore.getState().recentNoteIds;

    useAppStore.getState().deleteNote(note.id);
    useAppStore.getState().undoLastDelete();
    const after = useAppStore.getState();

    expect(after.notes).toHaveLength(1);
    expect(after.notes[0].id).toBe(note.id);
    expect(after.notes[0].content).toBe('- [ ] Buy milk');
    expect(after.todos).toHaveLength(1);
    expect(after.recentNoteIds).toEqual(recentBefore);
    expect(after.selectedNoteId).toBe(note.id);
    expect(after.deletedStack).toEqual([]);
  });

  it('restores a deleted todo by re-inserting the task line', () => {
    const note = addNote('Context\n- [ ] Buy milk');
    const todo = useAppStore.getState().todos[0];

    useAppStore.getState().deleteTodo(todo.id);
    expect(useAppStore.getState().todos).toEqual([]);
    expect(useAppStore.getState().notes[0].content).toBe('Context');

    useAppStore.getState().undoLastDelete();
    const state = useAppStore.getState();

    expect(state.todos).toHaveLength(1);
    expect(state.todos[0].id).toBe(todo.id);
    expect(state.notes[0].content).toContain('- [ ] Buy milk');
    expect(latestNote().id).toBe(note.id);
  });

  it('does nothing when the stack is empty', () => {
    addNote('kept');
    const before = useAppStore.getState().notes;

    useAppStore.getState().undoLastDelete();
    expect(useAppStore.getState().notes).toBe(before);
  });
});

describe('preferences', () => {
  it('normalizes shortcut modifiers', () => {
    useAppStore.getState().updateShortcut('save', 'command+s');
    expect(useAppStore.getState().shortcuts.save).toBe('Cmd+s');
  });

  it('stores the selected theme and navigation state', () => {
    useAppStore.getState().setTheme('dark');
    useAppStore.getState().setActiveSection('plan');
    useAppStore.getState().setQuery('milk');
    useAppStore.getState().setSearchFocused(true);

    const state = useAppStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.activeSection).toBe('plan');
    expect(state.query).toBe('milk');
    expect(state.searchFocused).toBe(true);

    useAppStore.getState().clearSelectedNote();
    expect(useAppStore.getState().selectedNoteId).toBeUndefined();
  });
});

describe('replaceAppState', () => {
  it('applies an imported snapshot and fills in missing shortcuts', () => {
    const note = addNote('imported');
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
    const note = addNote('content');
    const snapshot = snapshotAppState(useAppStore.getState());

    expect(snapshot.notes[0].id).toBe(note.id);
    expect(snapshot.theme).toBe(defaultTheme);
    expect(snapshot.deletedStack).toEqual([]);
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'activeSection',
        'deletedStack',
        'locale',
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

describe('persisted state migration', () => {
  const hydrate = async (state: unknown) => {
    localStorage.setItem('otter-note-store', JSON.stringify({ version: 0, state }));
    await useAppStore.persist.rehydrate();
    return useAppStore.getState();
  };

  beforeEach(() => {
    localStorage.clear();
    useAppStore.persist.clearStorage();
  });

  it('merges legacy entries into one note body', async () => {
    const next = await hydrate({
      notes: [{ id: 'n1', title: 'T', createdAt: 'x', updatedAt: 'x', dailyDate: '2026-09-20' }],
      entries: [
        { id: 'e2', noteId: 'n1', content: 'second', createdAt: 'b', updatedAt: 'b' },
        { id: 'e1', noteId: 'n1', content: '- [ ] Buy milk', createdAt: 'a', updatedAt: 'a' },
      ],
      todos: [{ id: 't1', noteId: 'n1', entryId: 'e1', title: 'Buy milk', status: 'todo' }],
      recentNoteIds: [],
      shortcuts: {},
    });

    expect(next.notes[0].content).toBe('- [ ] Buy milk\n\nsecond');
    expect('dailyDate' in next.notes[0]).toBe(false);
    expect(next.todos[0]).toMatchObject({ id: 't1', noteId: 'n1', source: 'note' });
  });

  it('keeps note bodies when the desktop store sends an empty entries list', async () => {
    const next = await hydrate({
      notes: [
        {
          id: 'n1',
          title: '630 gray release',
          content: '# 630灰度问题\n\n- [x] 快照需要存储看板信息',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
      entries: [],
      todos: [
        {
          id: 't1',
          noteId: 'n1',
          title: '快照需要存储看板信息',
          status: 'done',
          source: 'note',
          start: '2026-07-08',
          days: 2,
          due: '2026-07-09',
          priority: 'high',
          completedAt: 'y',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
      recentNoteIds: [],
      shortcuts: {},
    });

    expect(next.notes[0].content).toBe('# 630灰度问题\n\n- [x] 快照需要存储看板信息');
    expect(next.todos[0]).toMatchObject({
      id: 't1',
      status: 'done',
      source: 'note',
      start: '2026-07-08',
      days: 2,
      due: '2026-07-09',
      priority: 'high',
    });
  });

  it('keeps duplicated todo titles as distinct todos', async () => {
    const next = await hydrate({
      notes: [{ id: 'n1', title: 'T', createdAt: 'x', updatedAt: 'x' }],
      entries: [
        {
          id: 'e1',
          noteId: 'n1',
          content: ['- [ ] Buy milk', '- [x] Buy milk'].join('\n'),
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
      todos: [
        { id: 't1', noteId: 'n1', entryId: 'e1', title: 'Buy milk', status: 'todo' },
        { id: 't2', noteId: 'n1', entryId: 'e1', title: 'Buy milk', status: 'done' },
      ],
      recentNoteIds: [],
      shortcuts: {},
    });

    expect(next.todos.map((todo) => [todo.id, todo.status])).toEqual([
      ['t1', 'todo'],
      ['t2', 'done'],
    ]);
  });

  it('keeps scheduling fields across migration', async () => {
    const next = await hydrate({
      notes: [{ id: 'n1', title: 'T', content: '- [ ] Ship it', createdAt: 'x', updatedAt: 'x' }],
      todos: [
        {
          id: 't1',
          noteId: 'n1',
          title: 'Ship it',
          status: 'todo',
          source: 'note',
          createdAt: 'x',
          updatedAt: 'x',
          start: '2026-09-21',
          days: 2,
          due: '2026-09-22',
          priority: 'high',
        },
      ],
      recentNoteIds: [],
      shortcuts: {},
    });

    expect(next.todos[0]).toMatchObject({
      start: '2026-09-21',
      days: 2,
      due: '2026-09-22',
      priority: 'high',
    });
  });

  it('drops stale occurrence indexes from persisted todos', async () => {
    const next = await hydrate({
      notes: [{ id: 'n1', title: 'T', content: '- [ ] A\n- [ ] B', createdAt: 'x', updatedAt: 'x' }],
      todos: [
        {
          id: 't1',
          noteId: 'n1',
          occurrence: 9,
          title: 'B',
          status: 'todo',
          source: 'note',
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
      recentNoteIds: [],
      shortcuts: {},
    });

    expect(next.todos[0]).toMatchObject({ id: 't1', source: 'note' });
    expect(next.todos[0]).not.toHaveProperty('occurrence');
  });
});

describe('migrateShortcuts', () => {
  it('retires the legacy Cmd+K capture binding', () => {
    expect(migrateShortcuts({ ...defaultShortcuts, capture: 'Cmd+K' }).capture).toBe('Cmd+T');
    expect(migrateShortcuts(undefined).capture).toBe('Cmd+T');
  });

  it('keeps a chord the user recorded', () => {
    expect(migrateShortcuts({ capture: 'Cmd+Shift+C' }).capture).toBe('Cmd+Shift+C');
  });
});
