import React from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EditorView } from '@codemirror/view';
import { emit, listen } from '@tauri-apps/api/event';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  Download,
  CheckSquare,
  Clock3,
  Database,
  Copy,
  FolderOpen,
  HelpCircle,
  Image as ImageIcon,
  Keyboard,
  NotebookText,
  Pencil,
  Pin,
  Moon,
  Upload,
  RotateCcw,
  Save,
  Search,
  Settings,
  Trash2,
  SunMedium,
  FilePenLine,
  X,
} from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import './styles.css';
import { createId } from './id';
import {
  defaultShortcuts,
  snapshotAppState,
  useAppStore,
  type AppStateSnapshot,
  type NavSection,
  type ThemeMode,
  type ShortcutAction,
} from './store';
import {
  getStorageInfo,
  isTauriRuntime,
  listImageAttachments,
  deleteImageAttachment,
  saveImageAttachment,
  saveImageAttachmentBytes,
  readImageAttachmentBytes,
  readNoteBundle,
  pinNewNoteWindow,
  pinNoteWindow,
  setStoragePath,
  searchNotes,
  writeExportFile,
  type ImageAttachment,
  type StorageInfo,
} from './storage';

type ReactRefreshWindow = Window & {
  __getReactRefreshIgnoredExports?: (context: { id: string }) => string[];
};

if ((import.meta as ImportMeta & { hot?: unknown }).hot && typeof window !== 'undefined') {
  const refreshWindow = window as ReactRefreshWindow;
  const previousIgnoredExports = refreshWindow.__getReactRefreshIgnoredExports;
  refreshWindow.__getReactRefreshIgnoredExports = (context) => [
    ...(previousIgnoredExports?.(context) ?? []),
    'true',
  ];
}

const PINNED_NOTE_AUTOSAVE_DELAY_MS = 5_000;

const navItems: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'notes', label: 'Notes', icon: NotebookText },
  { id: 'todos', label: 'ToDos', icon: CheckSquare },
  { id: 'timeline', label: 'Timeline', icon: Clock3 },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'help', label: 'Help', icon: HelpCircle },
];

function App() {
  const theme = useAppStore((state) => state.theme);
  const isPinnedNewNote = getPinnedNewNote();
  const pinnedNoteId = getPinnedNoteId();
  useTheme(theme);
  useAppStateChangeSync();

  if (isPinnedNewNote) {
    return <PinnedNewNoteWindow />;
  }

  if (pinnedNoteId) {
    return <PinnedNoteWindow noteId={pinnedNoteId} />;
  }

  const hasContent = useAppStore((state) => state.notes.length > 0 || state.todos.length > 0);
  const activeSection = useAppStore((state) => state.activeSection);
  const query = useAppStore((state) => state.query.trim());
  const searchFocused = useAppStore((state) => state.searchFocused);
  const notes = useAppStore((state) => state.notes);
  const recentNoteIds = useAppStore((state) => state.recentNoteIds);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const selectNote = useAppStore((state) => state.selectNote);
  const clearSelectedNote = useAppStore((state) => state.clearSelectedNote);
  useKeyboardShortcuts();
  useOpenLatestNoteOnStartup(notes, recentNoteIds, setActiveSection, selectNote, clearSelectedNote);
  const showSearchResults =
    (searchFocused || Boolean(query)) &&
    activeSection !== 'new' &&
    activeSection !== 'settings' &&
    activeSection !== 'help' &&
    activeSection !== 'images';

  return (
    <div className="app-shell flex h-screen bg-slate-50 text-slate-950">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {showSearchResults ? <SearchResultsPage query={query} /> : null}
        {activeSection === 'timeline' && !showSearchResults ? (hasContent ? <Timeline /> : <TimelineEmptyState />) : null}
        {activeSection === 'new' && !showSearchResults ? <NewEntryPage /> : null}
        {activeSection === 'notes' && !showSearchResults ? <NotesWorkspace /> : null}
        {activeSection === 'todos' && !showSearchResults ? <TodosPage /> : null}
        {activeSection === 'images' ? <ImagesPage /> : null}
        {activeSection === 'settings' ? <SettingsPage /> : null}
        {activeSection === 'help' ? <HelpPage /> : null}
      </main>
    </div>
  );
}

function getPinnedNoteId() {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URLSearchParams(window.location.search).get('pinnedNoteId') ?? '';
}

function getPinnedNewNote() {
  if (typeof window === 'undefined') {
    return false;
  }

  return new URLSearchParams(window.location.search).get('pinnedNew') === '1';
}

function useKeyboardShortcuts() {
  const shortcuts = useAppStore((state) => state.shortcuts);
  const undoLastDelete = useAppStore((state) => state.undoLastDelete);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const clearSelectedNote = useAppStore((state) => state.clearSelectedNote);
  const searchFocused = useAppStore((state) => state.searchFocused);
  const setSearchFocused = useAppStore((state) => state.setSearchFocused);
  const setQuery = useAppStore((state) => state.setQuery);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const config = {
        ...defaultShortcuts,
        ...shortcuts,
      };

      if (isShortcutRecording()) {
        return;
      }

      if (isShortcutRecorderTarget(event.target)) {
        return;
      }

      if (matchesShortcut(event, config.save)) {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('otter:save'));
        return;
      }

      if (matchesShortcut(event, config.new)) {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        clearSelectedNote();
        setActiveSection('new');
        return;
      }

      if ((matchesShortcut(event, config.cancel) || event.key === 'Escape') && searchFocused) {
        event.preventDefault();
        setQuery('');
        setSearchFocused(false);
        document.querySelector<HTMLInputElement>('input[data-search-input="true"]')?.blur();
        setActiveSection('notes');
        return;
      }

      if (matchesShortcut(event, config.cancel) || event.key === 'Escape') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('otter:cancel'));
        return;
      }

      if (matchesShortcut(event, config.edit) && !isTextInputTarget(event.target)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('otter:edit'));
        return;
      }

      if (matchesShortcut(event, config.delete) && !isTextInputTarget(event.target)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('otter:delete'));
        return;
      }

      if (matchesShortcut(event, (shortcuts as Record<string, string>).undo ?? '') && !isTextInputTarget(event.target)) {
        event.preventDefault();
        undoLastDelete();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [clearSelectedNote, searchFocused, setActiveSection, setQuery, setSearchFocused, shortcuts, undoLastDelete]);
}

function Sidebar() {
  const activeSection = useAppStore((state) => state.activeSection);
  const theme = useAppStore((state) => state.theme);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const clearSelectedNote = useAppStore((state) => state.clearSelectedNote);
  const setSearchFocused = useAppStore((state) => state.setSearchFocused);
  const query = useAppStore((state) => state.query);
  const setQuery = useAppStore((state) => state.setQuery);
  const notes = useAppStore((state) => state.notes);
  const recentNoteIds = useAppStore((state) => state.recentNoteIds);
  const selectedNoteId = useAppStore((state) => state.selectedNoteId);
  const selectNote = useAppStore((state) => state.selectNote);
  const logoSrc = theme === 'dark' ? '/app-logo-dark.png' : '/app-logo.png';

  const recentNotes = React.useMemo(() => {
    const recent = recentNoteIds
      .map((id) => notes.find((note) => note.id === id))
      .filter((note): note is NonNullable<typeof note> => Boolean(note));
    if (recent.length >= 10) {
      return recent.slice(0, 10);
    }

    const recentIds = new Set(recent.map((note) => note.id));
    const fallback = [...notes]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((note) => !recentIds.has(note.id));

    return [...recent, ...fallback].slice(0, 10);
  }, [notes, recentNoteIds]);

  return (
    <aside className="sidebar-panel flex w-80 shrink-0 flex-col border-r border-blue-100 bg-blue-50/80">
      <div className="px-3 pt-11">
        <div className="px-1 pb-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex min-w-0 items-center gap-3 text-left"
              onClick={() => {
                const latest = recentNotes[0];
                if (latest) {
                  selectNote(latest.id);
                  return;
                }

                clearSelectedNote();
                setActiveSection('new');
              }}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[color:var(--app-toggle-surface)] ring-1 ring-[color:var(--app-toggle-border)]">
                <img
                  src={logoSrc}
                  alt=""
                  aria-hidden="true"
                  className="h-8 w-8 rounded-lg object-cover"
                />
              </span>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-blue-950">OtterNote</div>
                <div className="truncate text-[11px] text-slate-500">Notes, todo, timeline</div>
              </div>
            </button>
            <button
              type="button"
              className="secondary-button ml-auto h-9 w-9 shrink-0 !p-0"
              onClick={() => {
                clearSelectedNote();
                setActiveSection('new');
              }}
              title="New note"
              aria-label="New note"
            >
              <FilePenLine className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              data-search-input="true"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => {
                setSearchFocused(true);
                setActiveSection('notes');
              }}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search notes, todos..."
              className="h-10 w-full rounded-md border border-blue-100 bg-white pl-9 pr-3 text-sm outline-none ring-blue-200 focus:ring-2"
            />
        </label>
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto px-3 pt-1">
        <div className="mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recent opened</div>
        {recentNotes.length === 0 ? (
          <p className="rounded-md border border-dashed border-blue-200 bg-white/60 p-3 text-sm text-slate-500">
            No recently opened notes.
          </p>
        ) : (
          <div className="mb-2.5 space-y-0">
            {recentNotes.map((note) => (
              <button
                key={note.id}
                className={`sidebar-item w-full rounded-md px-3 py-0.5 text-left text-[13px] leading-5 ${
                  selectedNoteId === note.id ? 'sidebar-selected' : 'text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => selectNote(note.id)}
              >
                <div className="truncate font-medium">{displayTitle(note.title)}</div>
                <div className={`truncate text-[9px] leading-4 ${selectedNoteId === note.id ? 'sidebar-selected-meta' : 'text-slate-500'}`}>
                  {formatDate(note.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        )}

      </section>

      <nav className="border-t border-blue-100 p-3">
        <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Navigation
        </div>
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                className={`sidebar-item flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium leading-5 ${
                  active ? 'sidebar-selected' : 'text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => {
                  setActiveSection(item.id);
                  if (item.id === 'notes') {
                    clearSelectedNote();
                  }
                }}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}

function TimelineEmptyState() {
  return (
    <Page title="Timeline" subtitle="Notes grouped by time">
      <div className="mx-auto w-full max-w-3xl">
        <EmptyMessage title="No notes yet" message="Create notes to populate the timeline." />
      </div>
    </Page>
  );
}

function NewEntryPage() {
  const createNote = useAppStore((state) => state.createNote);
  const createNoteWithEntry = useAppStore((state) => state.createNoteWithEntry);
  const clearSelectedNote = useAppStore((state) => state.clearSelectedNote);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const [titleDraft, setTitleDraft] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [status, setStatus] = React.useState('');
  const editorViewRef = React.useRef<EditorView | null>(null);
  const updateTitleFromContent = React.useCallback((content: string) => {
    setTitleDraft(titleFromFirstLine(content));
  }, []);
  const updateDraft = React.useCallback((value: React.SetStateAction<string>) => {
    setDraft((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      updateTitleFromContent(next);
      return next;
    });
  }, [updateTitleFromContent]);

  const insertImage = React.useCallback(async () => {
    try {
      const image = await chooseMarkdownImage();
      if (!image) return;

      insertMarkdownAtCursor(editorViewRef.current, `![${image.altText}](${image.markdownUrl})`, updateDraft);
      setStatus(`Image inserted: ${image.altText}`);
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, [updateDraft]);

  const pinNewNote = React.useCallback(async () => {
    if (!isTauriRuntime()) {
      window.alert('Pinning notes is available in the desktop app.');
      return;
    }

    try {
      await pinNewNoteWindow();
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, []);

  const saveDraft = React.useCallback(() => {
    const content = draft.trim();
    const title = titleDraft.trim();
    if (!content && !title) {
      return;
    }

    if (content) {
      createNoteWithEntry(content, title);
    } else {
      createNote(title);
    }
    setTitleDraft('');
    setDraft('');
    setStatus('');
  }, [createNote, createNoteWithEntry, draft, titleDraft]);

  React.useEffect(() => {
    const onSave = () => saveDraft();
    const onCancel = () => {
      setTitleDraft('');
      setDraft('');
      setStatus('');
      clearSelectedNote();
      setActiveSection('notes');
    };
    window.addEventListener('otter:save', onSave);
    window.addEventListener('otter:cancel', onCancel);
    return () => {
      window.removeEventListener('otter:save', onSave);
      window.removeEventListener('otter:cancel', onCancel);
    };
  }, [clearSelectedNote, saveDraft, setActiveSection]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <PageHeader subtitle="Write quickly, then save to create a note.">
        <input
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          placeholder="Untitled Note"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
        />
      </PageHeader>
      <WorkspaceToolbar
        mode="edit"
        showEditButton={false}
        onPin={pinNewNote}
        onInsertImage={insertImage}
        onSave={saveDraft}
        onDelete={undefined}
        saveLabel="Save"
      />
      {status ? <div className="px-6 pt-2 text-xs text-slate-500">{status}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="editor-shell mx-auto w-full max-w-3xl">
          <CodeMirror
            value={draft}
            height="100%"
            extensions={[markdown(), imagePasteExtension((file, view) => insertImageFile(file, updateDraft, view))]}
            basicSetup={{ lineNumbers: false, foldGutter: false }}
            onChange={updateDraft}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
              view.focus();
            }}
            placeholder={'Start writing...\n\n- [ ] Add a ToDo'}
          />
        </div>
      </div>
    </div>
  );
}

function Timeline() {
  const notes = useAppStore((state) => state.notes);
  const selectNote = useAppStore((state) => state.selectNote);
  const groups = React.useMemo(() => groupNotesByDate(notes), [notes]);

  return (
    <Page title="Timeline" subtitle="Notes grouped by time">
      <div className="mx-auto w-full max-w-3xl space-y-2.5">
        {groups.length === 0 ? (
          <EmptyMessage title="No notes yet" message="Create notes to populate the timeline." />
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</div>
              <div className="space-y-2">
                {group.notes.map((note) => (
                  <button
                    key={note.id}
                    className="surface-card surface-card-hover w-full rounded-lg border px-4 py-3 text-left"
                    onClick={() => selectNote(note.id)}
                  >
                    <div className="text-sm font-medium text-slate-900">{displayTitle(note.title)}</div>
                    <div className="mt-1 text-xs text-slate-500">Updated {formatTime(note.updatedAt)}</div>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </Page>
  );
}

function NotesWorkspace() {
  const selectedNoteId = useAppStore((state) => state.selectedNoteId);
  const selectedNote = useAppStore((state) => state.notes.find((note) => note.id === selectedNoteId));

  return selectedNote ? <NoteDetail noteId={selectedNote.id} /> : <NotesListPage />;
}

function NotesListPage() {
  const notes = useAppStore((state) => state.notes);
  const entries = useAppStore((state) => state.entries);
  const todos = useAppStore((state) => state.todos);
  const selectNote = useAppStore((state) => state.selectNote);
  const sortedNotes = React.useMemo(() => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [notes]);
  const previewByNoteId = React.useMemo(() => {
    const next = new Map<string, string>();
    for (const note of sortedNotes) {
      next.set(note.id, summarizeNotePreview(note.id, entries, todos));
    }
    return next;
  }, [entries, sortedNotes, todos]);

  return (
    <Page title="Notes" subtitle="All notes">
      <div className="mx-auto w-full max-w-3xl space-y-2.5">
        {sortedNotes.length === 0 ? (
          <EmptyMessage title="No notes yet" message="Create a note to start writing." />
        ) : (
          sortedNotes.map((note) => (
            <button
              key={note.id}
              className="surface-card surface-card-hover w-full rounded-lg border px-4 py-3 text-left"
              onClick={() => selectNote(note.id)}
            >
              <div className="text-sm font-medium text-slate-900">{displayTitle(note.title)}</div>
              <div className="mt-1 text-sm text-slate-600">{previewByNoteId.get(note.id) ?? 'No content yet.'}</div>
              <div className="mt-1 text-xs text-slate-500">
                Created {formatDate(note.createdAt)} · Updated {formatDate(note.updatedAt)}
              </div>
            </button>
          ))
        )}
      </div>
    </Page>
  );
}

function NoteDetail({ noteId }: { noteId: string }) {
  const note = useAppStore((state) => state.notes.find((item) => item.id === noteId));
  const allEntries = useAppStore((state) => state.entries);
  const updateNoteTitle = useAppStore((state) => state.updateNoteTitle);
  const addEntry = useAppStore((state) => state.addEntry);
  const deleteNote = useAppStore((state) => state.deleteNote);
  const [bundle, setBundle] = React.useState<NoteBundleData | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftEntryId, setDraftEntryId] = React.useState<string | null>(null);
  const [draftContent, setDraftContent] = React.useState('');
  const [status, setStatus] = React.useState('');
  const editorViewRef = React.useRef<EditorView | null>(null);
  const entries = React.useMemo(() => {
    if (bundle) {
      return bundle.entries;
    }

    return allEntries.filter((entry) => entry.noteId === noteId);
  }, [allEntries, bundle, noteId]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const content = await readNoteBundle(noteId);
        if (!cancelled && content) {
          setBundle(JSON.parse(content) as NoteBundleData);
        }
      } catch {
        if (!cancelled) {
          setBundle(null);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [noteId, note?.updatedAt]);

  const deleteCurrentNote = React.useCallback(() => {
    if (!note) return;
    if (window.confirm('Delete this note and its ToDo items?')) {
      deleteNote(note.id);
    }
  }, [deleteNote, note]);

  const exportCurrentNote = React.useCallback(async () => {
    if (!note) return;

    const markdown = buildNoteMarkdown(
      note.title,
      isEditing ? mergeDraftEntries(entries, draftEntryId, draftContent) : entries.map((entry) => entry.content),
    );
    const fileName = buildExportFileName(note.title);

    if (isTauriRuntime()) {
      const selected = await saveDialog({
        title: 'Export note as markdown',
        defaultPath: fileName,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });

      if (typeof selected !== 'string' || !selected.trim()) {
        return;
      }

      await writeExportFile(selected, markdown);
      return;
    }

    downloadTextFile(markdown, fileName, 'text/markdown');
  }, [draftContent, draftEntryId, entries, isEditing, note]);

  const pinCurrentNote = React.useCallback(async () => {
    if (!note) return;

    if (!isTauriRuntime()) {
      window.alert('Pinning notes is available in the desktop app.');
      return;
    }

    try {
      await pinNoteWindow(note.id, displayTitle(note.title));
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, [note]);

  const startEditing = React.useCallback(() => {
    if (!note) return;
    const firstEntry = entries[0];
    setDraftEntryId(firstEntry?.id ?? null);
    setDraftContent(firstEntry?.content ?? '');
    setIsEditing(true);
  }, [entries, note]);

  const cancelEditing = React.useCallback(() => {
    setDraftEntryId(null);
    setDraftContent('');
    setIsEditing(false);
  }, []);

  const saveDraft = React.useCallback(() => {
    if (!note || !draftContent.trim()) return;
    if (draftEntryId) {
      useAppStore.getState().updateEntry(draftEntryId, draftContent);
    } else {
      addEntry(note.id, draftContent);
    }
    cancelEditing();
  }, [addEntry, cancelEditing, draftContent, draftEntryId, note]);

  const insertImage = React.useCallback(async () => {
    try {
      const image = await chooseMarkdownImage();
      if (!image) return;

      insertMarkdownAtCursor(editorViewRef.current, `![${image.altText}](${image.markdownUrl})`, setDraftContent);
      setStatus(`Image inserted: ${image.altText}`);
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, []);

  React.useEffect(() => {
    const onEdit = () => startEditing();
    const onDelete = () => deleteCurrentNote();
    const onCancel = () => {
      if (isEditing) {
        cancelEditing();
      }
    };
    const onSave = () => {
      if (isEditing) {
        saveDraft();
      }
    };

    window.addEventListener('otter:edit', onEdit);
    window.addEventListener('otter:delete', onDelete);
    window.addEventListener('otter:cancel', onCancel);
    window.addEventListener('otter:save', onSave);
    return () => {
      window.removeEventListener('otter:edit', onEdit);
      window.removeEventListener('otter:delete', onDelete);
      window.removeEventListener('otter:cancel', onCancel);
      window.removeEventListener('otter:save', onSave);
    };
  }, [cancelEditing, deleteCurrentNote, isEditing, saveDraft, startEditing]);

  if (!note) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <PageHeader subtitle={`Updated ${formatDate(note.updatedAt)}`}>
        <div className="flex items-center gap-3">
          <input
            value={note.title}
            onChange={(event) => updateNoteTitle(note.id, event.target.value)}
            placeholder="Untitled Note"
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
          />
        </div>
      </PageHeader>
      <WorkspaceToolbar
        mode={isEditing ? 'edit' : 'preview'}
        showEditButton={true}
        onExport={exportCurrentNote}
        onPin={pinCurrentNote}
        onInsertImage={isEditing ? insertImage : undefined}
        onSave={saveDraft}
        onEdit={startEditing}
        onDelete={deleteCurrentNote}
        saveLabel="Save"
      />
      {status ? <div className="px-6 pt-2 text-xs text-slate-500">{status}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto w-full max-w-3xl space-y-3.5">
          {isEditing ? (
            <div className="editor-shell">
              <CodeMirror
                value={draftContent}
                height="100%"
                extensions={[markdown(), imagePasteExtension((file, view) => insertImageFile(file, setDraftContent, view))]}
                basicSetup={{ lineNumbers: false, foldGutter: false }}
                onChange={setDraftContent}
                onCreateEditor={(view) => {
                  editorViewRef.current = view;
                }}
                placeholder={'Add note content...\n\n- [ ] Add a ToDo'}
              />
            </div>
          ) : entries.length === 0 ? (
            <article className="p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm italic text-slate-400">
                    No note text. This note only has a title.
                  </div>
                </div>
              </div>
            </article>
          ) : (
            entries.map((entry) => <EntryCard key={entry.id} entryId={entry.id} />)
          )}
        </div>
      </div>
    </div>
  );
}

function PinnedNewNoteWindow() {
  const createNote = useAppStore((state) => state.createNote);
  const createNoteWithEntry = useAppStore((state) => state.createNoteWithEntry);
  const updateNoteTitle = useAppStore((state) => state.updateNoteTitle);
  const addEntry = useAppStore((state) => state.addEntry);
  const storeHydrated = useStoreHydrated();
  const [titleDraft, setTitleDraft] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [savedNoteId, setSavedNoteId] = React.useState<string | null>(null);
  const [savedEntryId, setSavedEntryId] = React.useState<string | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [status, setStatus] = React.useState('Ready');
  const [showSavedToast, setShowSavedToast] = React.useState(false);
  const editorViewRef = React.useRef<EditorView | null>(null);
  const isInsertingImageRef = React.useRef(false);
  const lastSavedRef = React.useRef({ title: '', content: '' });
  const updateDraft = React.useCallback((value: React.SetStateAction<string>) => {
    setDraft((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      setTitleDraft(titleFromFirstLine(next));
      return next;
    });
  }, []);

  React.useEffect(() => {
    document.body.classList.add('pinned-note-body');
    return () => {
      document.body.classList.remove('pinned-note-body');
    };
  }, []);

  const saveDraftContent = React.useCallback(async (
    nextDraft: string,
    nextTitleDraft = titleFromFirstLine(nextDraft),
    mode: 'auto' | 'manual' = 'manual',
  ) => {
    await waitForStoreHydration();
    const content = nextDraft.trim();
    const title = nextTitleDraft.trim();
    if (!content && !title) {
      return;
    }

    if (lastSavedRef.current.title === title && lastSavedRef.current.content === nextDraft) {
      return;
    }

    setStatus('Saving...');

    if (!savedNoteId) {
      if (content) {
        createNoteWithEntry(nextDraft, title);
      } else {
        createNote(title);
      }

      const state = useAppStore.getState();
      const nextNoteId = state.selectedNoteId ?? state.notes[0]?.id ?? null;
      const nextEntryId = nextNoteId ? state.entries.find((entry) => entry.noteId === nextNoteId)?.id ?? null : null;
      setSavedNoteId(nextNoteId);
      setSavedEntryId(nextEntryId);
    } else {
      updateNoteTitle(savedNoteId, title || 'Untitled Note');
      if (savedEntryId) {
        useAppStore.getState().updateEntry(savedEntryId, nextDraft);
      } else if (content) {
        addEntry(savedNoteId, nextDraft);
        const nextEntryId = useAppStore.getState().entries.find((entry) => entry.noteId === savedNoteId)?.id ?? null;
        setSavedEntryId(nextEntryId);
      }
    }

    lastSavedRef.current = { title, content: nextDraft };
    setStatus(mode === 'auto' ? 'Saved automatically' : 'Saved');
    if (mode === 'auto') {
      setShowSavedToast(true);
    }
    await notifyAppStateChanged();
  }, [addEntry, createNote, createNoteWithEntry, savedEntryId, savedNoteId, updateNoteTitle]);

  const saveDraft = React.useCallback((mode: 'auto' | 'manual' = 'manual') => {
    return saveDraftContent(draft, titleDraft, mode);
  }, [draft, saveDraftContent, titleDraft]);

  React.useEffect(() => {
    if (!storeHydrated) {
      return;
    }

    const title = titleDraft.trim();
    const content = draft.trim();
    if (!title && !content) {
      return;
    }

    if (lastSavedRef.current.title === title && lastSavedRef.current.content === draft) {
      return;
    }

    setStatus('Unsaved changes');
    const timeout = window.setTimeout(() => {
      void saveDraft('auto');
    }, PINNED_NOTE_AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [draft, saveDraft, storeHydrated, titleDraft]);

  React.useEffect(() => {
    if (!showSavedToast) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowSavedToast(false);
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [showSavedToast]);

  const finishEditing = React.useCallback(() => {
    if (isInsertingImageRef.current) {
      return;
    }

    setIsEditing(false);
    editorViewRef.current = null;
    void saveDraft('auto');
  }, [saveDraft]);

  const insertPinnedImage = React.useCallback(async (payload: ClipboardImagePayload, view: EditorView | null) => {
    isInsertingImageRef.current = true;
    try {
      setStatus('Pasting image...');
      const image = await createMarkdownImageFromPayload(payload);
      const nextDraft = insertMarkdownAtCursorAndGetContent(
        view,
        `![${image.altText}](${image.markdownUrl})`,
        draft,
      );
      updateDraft(nextDraft);
      setIsEditing(true);
      await saveDraftContent(nextDraft, titleFromFirstLine(nextDraft), 'auto');
    } finally {
      isInsertingImageRef.current = false;
    }
  }, [draft, saveDraftContent, updateDraft]);

  const handlePaste = React.useCallback((event: React.ClipboardEvent) => {
    const image = extractClipboardImagePayload(event.nativeEvent);
    if (!image) {
      setStatus('Paste ignored: no image found');
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsEditing(true);
    void insertPinnedImage(image, editorViewRef.current).catch((error) => {
      setStatus(`Paste failed: ${errorMessage(error)}`);
      window.alert(errorMessage(error));
    });
  }, [insertPinnedImage]);

  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const image = extractClipboardImagePayload(event);
      if (!image) {
        setStatus('Paste ignored: no image found');
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsEditing(true);
      void insertPinnedImage(image, editorViewRef.current).catch((error) => {
        setStatus(`Paste failed: ${errorMessage(error)}`);
        window.alert(errorMessage(error));
      });
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [insertPinnedImage]);

  const startEditing = React.useCallback(async () => {
    if (savedNoteId) {
      try {
        const content = await readNoteBundle(savedNoteId);
        if (content) {
          const nextBundle = JSON.parse(content) as NoteBundleData;
          const firstEntry = nextBundle.entries[0];
          const nextTitle = displayTitle(nextBundle.note.title);
          const nextContent = firstEntry?.content ?? '';
          setTitleDraft(nextTitle);
          setDraft(nextContent);
          setSavedEntryId(firstEntry?.id ?? null);
          lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
        }
      } catch {
        const state = useAppStore.getState();
        const nextNote = state.notes.find((item) => item.id === savedNoteId);
        const firstEntry = state.entries.find((entry) => entry.noteId === savedNoteId);
        if (nextNote) {
          const nextTitle = displayTitle(nextNote.title);
          const nextContent = firstEntry?.content ?? draft;
          setTitleDraft(nextTitle);
          setDraft(nextContent);
          setSavedEntryId(firstEntry?.id ?? null);
          lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
        }
      }
    }

    setIsEditing(true);
  }, [draft, savedNoteId]);

  React.useEffect(() => {
    if (!isEditing) {
      return;
    }

    window.addEventListener('blur', finishEditing);
    return () => window.removeEventListener('blur', finishEditing);
  }, [finishEditing, isEditing]);

  return (
    <div className="pinned-note-window flex h-screen flex-col text-slate-950">
      <main
        className="pinned-note-content min-h-0 flex-1 overflow-y-auto p-4"
        onMouseLeave={isEditing ? finishEditing : undefined}
        onPaste={handlePaste}
      >
        {isEditing ? (
        <div className="pinned-editor-shell min-h-full">
          <CodeMirror
            value={draft}
            height="100%"
            extensions={[markdown(), imagePasteExtension((file, view) => insertPinnedImage({ type: 'file', file }, view))]}
            basicSetup={{ lineNumbers: false, foldGutter: false }}
            onChange={updateDraft}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
              view.dom.addEventListener('focusout', () => {
                window.setTimeout(() => {
                  if (!view.dom.contains(document.activeElement)) {
                    finishEditing();
                  }
                }, 0);
              });
              view.focus();
            }}
            placeholder={'Start writing...\n\n- [ ] Add a ToDo'}
          />
        </div>
        ) : (
          <PinnedNotePreview
            content={draft}
            emptyMessage="双击开始记录"
            onDoubleClick={() => void startEditing()}
          />
        )}
      </main>
      <PinnedSaveToast visible={showSavedToast} />
    </div>
  );
}

function PinnedNoteWindow({ noteId }: { noteId: string }) {
  const note = useAppStore((state) => state.notes.find((item) => item.id === noteId));
  const allEntries = useAppStore((state) => state.entries);
  const updateNoteTitle = useAppStore((state) => state.updateNoteTitle);
  const addEntry = useAppStore((state) => state.addEntry);
  const storeHydrated = useStoreHydrated();
  const [bundle, setBundle] = React.useState<NoteBundleData | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState('');
  const [draftEntryId, setDraftEntryId] = React.useState<string | null>(null);
  const [draftContent, setDraftContent] = React.useState('');
  const [status, setStatus] = React.useState('Ready');
  const [showSavedToast, setShowSavedToast] = React.useState(false);
  const editorViewRef = React.useRef<EditorView | null>(null);
  const isInsertingImageRef = React.useRef(false);
  const initializedRef = React.useRef(false);
  const lastSavedRef = React.useRef({ title: '', content: '' });
  const entries = React.useMemo(() => {
    if (bundle) {
      return bundle.entries;
    }

    return allEntries.filter((entry) => entry.noteId === noteId);
  }, [allEntries, bundle, noteId]);
  const title = bundle?.note.title ?? note?.title ?? 'Pinned Note';

  React.useEffect(() => {
    document.body.classList.add('pinned-note-body');
    return () => {
      document.body.classList.remove('pinned-note-body');
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const content = await readNoteBundle(noteId);
        if (!cancelled && content) {
          setBundle(JSON.parse(content) as NoteBundleData);
          setLoadFailed(false);
          return;
        }
      } catch {
        // Fall back to hydrated store state below.
      }

      if (!cancelled) {
        setBundle(null);
        const hasStoreNote = useAppStore.getState().notes.some((item) => item.id === noteId);
        setLoadFailed(!hasStoreNote);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  React.useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    if (!note && !bundle && !loadFailed) {
      return;
    }

    const firstEntry = entries[0];
    const nextTitle = displayTitle(title);
    const nextContent = firstEntry?.content ?? '';
    setDraftTitle(nextTitle);
    setDraftEntryId(firstEntry?.id ?? null);
    setDraftContent(nextContent);
    lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
    initializedRef.current = true;
  }, [bundle, entries, loadFailed, note, title]);

  const saveDraftContent = React.useCallback(async (
    nextDraftContent: string,
    nextDraftTitle = draftTitle,
    mode: 'auto' | 'manual' = 'manual',
  ) => {
    await waitForStoreHydration();
    const nextTitle = nextDraftTitle.trim();
    const nextContent = nextDraftContent.trim();
    if (!note && !bundle) {
      return;
    }

    if (lastSavedRef.current.title === nextTitle && lastSavedRef.current.content === nextDraftContent) {
      return;
    }

    setStatus('Saving...');
    updateNoteTitle(noteId, nextTitle || 'Untitled Note');
    if (draftEntryId) {
      useAppStore.getState().updateEntry(draftEntryId, nextDraftContent);
    } else if (nextContent) {
      addEntry(noteId, nextDraftContent);
      const nextEntryId = useAppStore.getState().entries.find((entry) => entry.noteId === noteId)?.id ?? null;
      setDraftEntryId(nextEntryId);
    }

    setBundle(null);
    lastSavedRef.current = { title: nextTitle, content: nextDraftContent };
    setStatus(mode === 'auto' ? 'Saved automatically' : 'Saved');
    if (mode === 'auto') {
      setShowSavedToast(true);
    }
    await notifyAppStateChanged();
  }, [addEntry, bundle, draftEntryId, draftTitle, note, noteId, updateNoteTitle]);

  const saveDraft = React.useCallback((mode: 'auto' | 'manual' = 'manual') => {
    return saveDraftContent(draftContent, draftTitle, mode);
  }, [draftContent, draftTitle, saveDraftContent]);

  React.useEffect(() => {
    if (!storeHydrated || !initializedRef.current || (!note && !bundle)) {
      return;
    }

    const title = draftTitle.trim();
    if (lastSavedRef.current.title === title && lastSavedRef.current.content === draftContent) {
      return;
    }

    setStatus('Unsaved changes');
    const timeout = window.setTimeout(() => {
      void saveDraft('auto');
    }, PINNED_NOTE_AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [bundle, draftContent, draftTitle, note, saveDraft, storeHydrated]);

  React.useEffect(() => {
    if (!showSavedToast) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowSavedToast(false);
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [showSavedToast]);

  const finishEditing = React.useCallback(() => {
    if (isInsertingImageRef.current) {
      return;
    }

    setIsEditing(false);
    editorViewRef.current = null;
    void saveDraft('auto');
  }, [saveDraft]);

  const insertPinnedImage = React.useCallback(async (payload: ClipboardImagePayload, view: EditorView | null) => {
    isInsertingImageRef.current = true;
    try {
      setStatus('Pasting image...');
      const image = await createMarkdownImageFromPayload(payload);
      const nextDraftContent = insertMarkdownAtCursorAndGetContent(
        view,
        `![${image.altText}](${image.markdownUrl})`,
        draftContent,
      );
      setDraftContent(nextDraftContent);
      setIsEditing(true);
      await saveDraftContent(nextDraftContent, draftTitle, 'auto');
    } finally {
      isInsertingImageRef.current = false;
    }
  }, [draftContent, draftTitle, saveDraftContent]);

  const handlePaste = React.useCallback((event: React.ClipboardEvent) => {
    const image = extractClipboardImagePayload(event.nativeEvent);
    if (!image) {
      setStatus('Paste ignored: no image found');
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsEditing(true);
    void insertPinnedImage(image, editorViewRef.current).catch((error) => {
      setStatus(`Paste failed: ${errorMessage(error)}`);
      window.alert(errorMessage(error));
    });
  }, [insertPinnedImage]);

  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const image = extractClipboardImagePayload(event);
      if (!image) {
        setStatus('Paste ignored: no image found');
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsEditing(true);
      void insertPinnedImage(image, editorViewRef.current).catch((error) => {
        setStatus(`Paste failed: ${errorMessage(error)}`);
        window.alert(errorMessage(error));
      });
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [insertPinnedImage]);

  const startEditing = React.useCallback(async () => {
    try {
      const content = await readNoteBundle(noteId);
      if (content) {
        const nextBundle = JSON.parse(content) as NoteBundleData;
        const firstEntry = nextBundle.entries[0];
        const nextTitle = displayTitle(nextBundle.note.title);
        const nextContent = firstEntry?.content ?? '';
        setBundle(nextBundle);
        setDraftTitle(nextTitle);
        setDraftEntryId(firstEntry?.id ?? null);
        setDraftContent(nextContent);
        lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
        setLoadFailed(false);
        setIsEditing(true);
        return;
      }
    } catch {
      // Fall back to hydrated store state below.
    }

    const state = useAppStore.getState();
    const nextNote = state.notes.find((item) => item.id === noteId);
    if (!nextNote) {
      setLoadFailed(true);
      return;
    }

    const firstEntry = state.entries.find((entry) => entry.noteId === noteId);
    const nextTitle = displayTitle(nextNote.title);
    const nextContent = firstEntry?.content ?? '';
    setBundle(null);
    setDraftTitle(nextTitle);
    setDraftEntryId(firstEntry?.id ?? null);
    setDraftContent(nextContent);
    lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
    setLoadFailed(false);
    setIsEditing(true);
  }, [noteId]);

  React.useEffect(() => {
    if (!isEditing) {
      return;
    }

    window.addEventListener('blur', finishEditing);
    return () => window.removeEventListener('blur', finishEditing);
  }, [finishEditing, isEditing]);

  return (
    <div className="pinned-note-window flex h-screen flex-col text-slate-950">
      <main
        className="pinned-note-content min-h-0 flex-1 overflow-y-auto p-4"
        onMouseLeave={isEditing ? finishEditing : undefined}
        onPaste={handlePaste}
      >
        {loadFailed ? (
          <div className="text-sm italic text-emerald-950">This pinned note is unavailable.</div>
        ) : !isEditing ? (
          <PinnedNotePreview
            content={draftContent}
            emptyMessage="双击编辑内容"
            onDoubleClick={() => void startEditing()}
          />
        ) : (
          <div className="pinned-editor-shell min-h-full">
            <CodeMirror
              value={draftContent}
              height="100%"
              extensions={[markdown(), imagePasteExtension((file, view) => insertPinnedImage({ type: 'file', file }, view))]}
              basicSetup={{ lineNumbers: false, foldGutter: false }}
              onChange={setDraftContent}
              onCreateEditor={(view) => {
                editorViewRef.current = view;
                view.dom.addEventListener('focusout', () => {
                  window.setTimeout(() => {
                    if (!view.dom.contains(document.activeElement)) {
                      finishEditing();
                    }
                  }, 0);
                });
                view.focus();
              }}
              placeholder={'Add note content...\n\n- [ ] Add a ToDo'}
            />
          </div>
        )}
      </main>
      <PinnedSaveToast visible={showSavedToast} />
    </div>
  );
}

function PinnedNotePreview({
  content,
  emptyMessage,
  onDoubleClick,
}: {
  content: string;
  emptyMessage: string;
  onDoubleClick: () => void;
}) {
  return (
    <div className="pinned-note-preview min-h-full" onDoubleClick={onDoubleClick}>
      {content.trim() ? (
        <MarkdownContent content={content} />
      ) : (
        <div className="pinned-note-empty">{emptyMessage}</div>
      )}
    </div>
  );
}

function PinnedSaveToast({ visible }: { visible: boolean }) {
  return (
    <div className={`pinned-save-toast ${visible ? 'pinned-save-toast-visible' : ''}`} aria-live="polite">
      保存成功
    </div>
  );
}

function WorkspaceToolbar({
  mode,
  showEditButton = true,
  onExport,
  onPin,
  onInsertImage,
  onSave,
  onEdit,
  onDelete,
  saveLabel,
}: {
  mode: 'preview' | 'edit';
  showEditButton?: boolean;
  onExport?: () => void;
  onPin?: () => void;
  onInsertImage?: () => void;
  onSave: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  saveLabel: string;
}) {
  return (
    <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onExport ? (
          <button type="button" className="secondary-button" onClick={onExport}>
            <Download className="h-4 w-4" />
            Export
          </button>
        ) : null}
        {onPin ? (
          <button type="button" className="secondary-button" onClick={onPin}>
            <Pin className="h-4 w-4" />
            Pin
          </button>
        ) : null}
        {mode === 'edit' && onInsertImage ? (
          <button type="button" className="secondary-button" onClick={onInsertImage}>
            <ImageIcon className="h-4 w-4" />
            Image
          </button>
        ) : null}
        {mode === 'edit' ? (
          <button type="button" className="primary-button" onClick={onSave}>
            <Save className="h-4 w-4" />
            {saveLabel}
          </button>
        ) : showEditButton ? (
          <button type="button" className="secondary-button" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            Edit
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" className="secondary-button text-red-700 hover:bg-red-50" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function useTheme(theme: ThemeMode) {
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
}

const appStateChangedEvent = 'otter:app-state-changed';

function useAppStateChangeSync() {
  React.useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void listen(appStateChangedEvent, () => {
      if (!disposed) {
        void useAppStore.persist.rehydrate?.();
      }
    }).then((unlisten) => {
      if (disposed) {
        void unlisten();
        return;
      }

      cleanup = unlisten;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
}

function useStoreHydrated() {
  const [hydrated, setHydrated] = React.useState(() => useAppStore.persist.hasHydrated?.() ?? false);

  React.useEffect(() => {
    if (hydrated) {
      return;
    }

    const unsubscribe = useAppStore.persist.onFinishHydration?.(() => {
      setHydrated(true);
    });

    return () => {
      unsubscribe?.();
    };
  }, [hydrated]);

  return hydrated;
}

function waitForStoreHydration() {
  if (useAppStore.persist.hasHydrated?.() ?? false) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const unsubscribe = useAppStore.persist.onFinishHydration?.(() => {
      unsubscribe?.();
      resolve();
    });
  });
}

async function notifyAppStateChanged() {
  if (!isTauriRuntime()) {
    return;
  }

  await new Promise((resolve) => window.setTimeout(resolve, 80));
  await emit(appStateChangedEvent);
}

function useOpenLatestNoteOnStartup(
  notes: Array<{ id: string; updatedAt: string }>,
  recentNoteIds: string[],
  setActiveSection: (section: NavSection) => void,
  selectNote: (noteId: string) => void,
  clearSelectedNote: () => void,
) {
  const [hydrated, setHydrated] = React.useState(() => useAppStore.persist.hasHydrated?.() ?? false);
  const appliedRef = React.useRef(false);

  React.useEffect(() => {
    if (hydrated) {
      return;
    }

    const unsubscribe = useAppStore.persist.onFinishHydration?.(() => {
      setHydrated(true);
    });

    return () => {
      unsubscribe?.();
    };
  }, [hydrated]);

  React.useEffect(() => {
    if (!hydrated || appliedRef.current) {
      return;
    }

    appliedRef.current = true;

    if (notes.length === 0) {
      clearSelectedNote();
      setActiveSection('new');
      return;
    }

    const noteById = new Map(notes.map((note) => [note.id, note] as const));
    const recent = recentNoteIds.map((id) => noteById.get(id)).find(Boolean);
    const latest = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const target = recent ?? latest;

    if (target) {
      selectNote(target.id);
      setActiveSection('notes');
    }
  }, [clearSelectedNote, hydrated, notes, recentNoteIds, selectNote, setActiveSection]);
}

type MarkdownImage = {
  altText: string;
  markdownUrl: string;
};

type ClipboardImagePayload =
  | { type: 'file'; file: File }
  | { type: 'path'; path: string };

type NoteBundleData = {
  schemaVersion?: number;
  note: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string;
  };
  entries: Array<{
    id: string;
    noteId: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  }>;
  todos: Array<{
    id: string;
    noteId?: string;
    entryId?: string;
    title: string;
    status: string;
    source: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
  }>;
};

async function chooseMarkdownImage() {
  if (isTauriRuntime()) {
    const selected = await openDialog({
      title: 'Choose image',
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }],
      multiple: false,
      fileAccessMode: 'copy',
    });

    if (typeof selected !== 'string' || !selected.trim()) {
      return null;
    }

    const stored = await storeSelectedImage(selected);
    if (!stored) return null;

    return stored;
  }

  const file = await chooseImageFile();
  if (!file) return null;

  return createMarkdownImageFromFile(file);
}

async function storeSelectedImage(selectedPath: string): Promise<MarkdownImage | null> {
  const attachmentBaseName = createId('img');
  const previewFileName = await saveImageAttachment(selectedPath, attachmentBaseName);
  window.dispatchEvent(new CustomEvent('otter:attachments-changed'));
  const markdownUrl = `attachment://${previewFileName}`;
  const altText = extractFileName(selectedPath).replace(/\.[^.]+$/, '') || 'image';

  return { altText, markdownUrl };
}

async function createMarkdownImageFromFile(file: File): Promise<MarkdownImage> {
  const sourceFileName = file.name || `pasted-image.${imageExtensionFromMimeType(file.type)}`;
  if (isTauriRuntime()) {
    const attachmentBaseName = createId('img');
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const previewFileName = await saveImageAttachmentBytes(bytes, sourceFileName, attachmentBaseName);
    window.dispatchEvent(new CustomEvent('otter:attachments-changed'));
    return {
      altText: extractAltText(sourceFileName),
      markdownUrl: `attachment://${previewFileName}`,
    };
  }

  return { altText: extractAltText(sourceFileName), markdownUrl: await readFileAsOptimizedDataUrl(file) };
}

async function createMarkdownImageFromPayload(payload: ClipboardImagePayload): Promise<MarkdownImage> {
  if (payload.type === 'file') {
    const image = await createMarkdownImageFromFile(payload.file);
    return image;
  }

  if (!isTauriRuntime()) {
    throw new Error('Pasting image files by path is available in the desktop app.');
  }

  const stored = await storeSelectedImage(payload.path);
  if (!stored) {
    throw new Error('Failed to store pasted image.');
  }

  return stored;
}

function imageExtensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'png';
  }
}

function mimeTypeFromFileName(fileName: string) {
  switch (extractFileExtension(fileName).toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'image/png';
  }
}

function extractAltText(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '') || 'image';
}

function extractFileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function extractFileExtension(fileName: string) {
  const index = fileName.lastIndexOf('.');
  if (index < 0 || index === fileName.length - 1) return '';
  return fileName.slice(index + 1).toLowerCase();
}

function extractAttachmentReferences(content: string) {
  const refs: string[] = [];
  let remaining = content;

  while (true) {
    const index = remaining.indexOf('attachment://');
    if (index < 0) break;

    const after = remaining.slice(index + 'attachment://'.length);
    const match = after.match(/^[A-Za-z0-9._-]+/);
    if (match?.[0]) {
      refs.push(match[0]);
      remaining = after.slice(match[0].length);
    } else {
      remaining = after.slice(1);
    }
  }

  return refs;
}

function formatAttachmentTime(value: string) {
  if (!value) return 'Unknown time';
  const timestamp = Number(value);
  if (Number.isFinite(timestamp)) {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp * 1000));
  }

  return value;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function mergeDraftEntries(entries: Array<{ id: string; content: string }>, draftEntryId: string | null, draftContent: string) {
  if (!draftContent.trim()) {
    return entries.map((entry) => entry.content);
  }

  if (draftEntryId) {
    return entries.map((entry) => (entry.id === draftEntryId ? draftContent : entry.content));
  }

  return entries.length === 0 ? [draftContent] : [draftContent, ...entries.map((entry) => entry.content)];
}

function buildNoteMarkdown(title: string, entryContents: string[]) {
  const lines = [`# ${displayTitle(title)}`];
  if (entryContents.length > 0) {
    lines.push('');
    entryContents.forEach((content, index) => {
      lines.push(content.replace(/\s+$/, ''));
      if (index < entryContents.length - 1) {
        lines.push('', '---', '');
      }
    });
  }

  return lines.join('\n').trimEnd() + '\n';
}

function buildExportFileName(title: string) {
  const normalized = displayTitle(title)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = normalized || 'Untitled Note';
  return `${safe}.md`;
}

function downloadTextFile(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function markdownUrlTransform(url: string) {
  if (url.startsWith('data:image/')) {
    return url;
  }

  if (url.startsWith('blob:')) {
    return url;
  }

  if (url.startsWith('attachment://')) {
    return url;
  }

  const colon = url.indexOf(':');
  const questionMark = url.indexOf('?');
  const numberSign = url.indexOf('#');
  const slash = url.indexOf('/');

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign)
  ) {
    return url;
  }

  const protocol = url.slice(0, colon).toLowerCase();
  if (['http', 'https', 'mailto', 'xmpp', 'irc', 'ircs'].includes(protocol)) {
    return url;
  }

  return '';
}

function insertMarkdownAtCursor(
  view: EditorView | null,
  text: string,
  fallbackUpdate: React.Dispatch<React.SetStateAction<string>>,
) {
  if (!view || !view.dom.isConnected) {
    fallbackUpdate((current) => `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${text}`);
    return;
  }

  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

function insertMarkdownAtCursorAndGetContent(view: EditorView | null, text: string, fallbackContent: string) {
  if (!view || !view.dom.isConnected) {
    return `${fallbackContent}${fallbackContent.endsWith('\n') || fallbackContent.length === 0 ? '' : '\n'}${text}`;
  }

  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return view.state.doc.toString();
}

function imagePasteExtension(onImage: (file: File, view: EditorView) => Promise<void>) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const file = extractClipboardImage(event);
      if (!file) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      void onImage(file, view).catch((error) => {
        window.alert(errorMessage(error));
      });
      view.focus();
      return true;
    },
  });
}

function extractClipboardImage(event: ClipboardEvent) {
  const payload = extractClipboardImagePayload(event);
  return payload?.type === 'file' ? payload.file : null;
}

function extractClipboardImagePayload(event: ClipboardEvent): ClipboardImagePayload | null {
  const data = event.clipboardData;
  if (!data) {
    return null;
  }

  const files = Array.from(data.files);
  for (const file of files) {
    if (isClipboardImageFile(file, file.type)) {
      return { type: 'file', file };
    }
  }

  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isClipboardImageFile(file, item.type)) {
      return { type: 'file', file };
    }
  }

  const path = extractClipboardImagePath(data);
  if (path) {
    return { type: 'path', path };
  }

  return null;
}

function isClipboardImageFile(file: File, itemType: string) {
  if (file.type.startsWith('image/') || itemType.startsWith('image/')) {
    return true;
  }

  return isImageFileName(file.name);
}

function isImageFileName(fileName: string) {
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(extractFileExtension(fileName));
}

function extractClipboardImagePath(data: DataTransfer) {
  const candidates = [
    ...data.getData('text/uri-list').split(/\r?\n/),
    data.getData('text/plain'),
  ];

  for (const candidate of candidates) {
    const path = normalizeClipboardImagePath(candidate);
    if (path && isImageFileName(path)) {
      return path;
    }
  }

  return null;
}

function normalizeClipboardImagePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return '';
  }

  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed);
      return decodeURIComponent(url.pathname);
    } catch {
      return decodeURIComponent(trimmed.replace(/^file:\/\//, ''));
    }
  }

  return trimmed;
}

async function insertImageFile(
  file: File,
  fallbackUpdate: React.Dispatch<React.SetStateAction<string>>,
  view: EditorView | null,
) {
  const image = await createMarkdownImageFromFile(file);
  insertMarkdownAtCursor(view, `![${image.altText}](${image.markdownUrl})`, fallbackUpdate);
}

function chooseImageFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.click();
  });
}

async function readFileAsOptimizedDataUrl(file: File) {
  const bitmap = await createBitmap(file);
  const maxSize = 1600;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare image preview.');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const mime = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const quality = mime === 'image/png' ? undefined : 0.82;
  return canvas.toDataURL(mime, quality);
}

async function createBitmap(file: File) {
  if ('createImageBitmap' in window) {
    return await createImageBitmap(file);
  }

  const source = URL.createObjectURL(file);
  try {
    const image = await loadImage(source);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to prepare image preview.');
    }
    context.drawImage(image, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(source);
  }
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load the selected image.'));
    image.src = source;
  });
}

function EntryCard({ entryId }: { entryId: string }) {
  const entry = useAppStore((state) => state.entries.find((item) => item.id === entryId));
  const allTodos = useAppStore((state) => state.todos);
  const toggleTodo = useAppStore((state) => state.toggleTodo);
  const todos = React.useMemo(
    () => allTodos.filter((todo) => todo.entryId === entryId),
    [allTodos, entryId],
  );

  if (!entry) return null;

  return (
    <article className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {entry.content.trim() ? (
            <div className="note-detail-content">
              <MarkdownContent content={entry.content} />
            </div>
          ) : (
            <div className="text-sm italic text-slate-400">No note text. This entry contains only ToDo items.</div>
          )}
        </div>
      </div>
      {todos.length > 0 ? (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {todos.map((todo) => (
            <label key={todo.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={todo.status === 'done'}
                onChange={(event) => toggleTodo(todo.id, event.target.checked)}
                className="mt-1"
              />
              <span className={todo.status === 'done' ? 'text-slate-400 line-through' : ''}>{todo.title}</span>
            </label>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TodosPage() {
  const todos = useFilteredTodos();
  const toggleTodo = useAppStore((state) => state.toggleTodo);
  const deleteTodo = useAppStore((state) => state.deleteTodo);
  const notes = useAppStore((state) => state.notes);
  const selectNote = useAppStore((state) => state.selectNote);

  const openTodoSource = React.useCallback(
    (todo: { noteId?: string }) => {
      if (!todo.noteId) {
        return;
      }

      selectNote(todo.noteId);
    },
    [selectNote],
  );

  return (
    <Page title="ToDos" subtitle="Tasks extracted from notes">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {todos.length === 0 ? (
          <EmptyMessage title="No ToDo items" message="Add - [ ] inside a note entry." />
        ) : (
          todos.map((todo) => {
            const source = notes.find((note) => note.id === todo.noteId)?.title ?? 'Standalone';
            return (
              <div key={todo.id} className="surface-card surface-card-hover flex items-center gap-3 rounded-lg border p-4">
                <input
                  type="checkbox"
                  checked={todo.status === 'done'}
                  onChange={(event) => toggleTodo(todo.id, event.target.checked)}
                  className="shrink-0"
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openTodoSource(todo)}
                  disabled={!todo.noteId}
                >
                  <div
                    className={`text-sm font-medium ${
                      todo.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-900'
                    }`}
                  >
                    {todo.title}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Created {formatDate(todo.createdAt)}
                    <span className="mx-1 text-slate-300">·</span>
                    {todo.noteId ? 'Open note: ' : 'Source: '}
                    <span className={todo.noteId ? 'font-medium text-slate-700 hover:text-slate-900' : ''}>{source}</span>
                  </div>
                </button>
                <button
                  className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => deleteTodo(todo.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </Page>
  );
}

function ImagesPage() {
  const entries = useAppStore((state) => state.entries);
  const [attachments, setAttachments] = React.useState<ImageAttachment[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [viewerFileName, setViewerFileName] = React.useState('');

  const refresh = React.useCallback(async () => {
    if (!isTauriRuntime()) {
      setAttachments([]);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const items = await listImageAttachments();
      setAttachments(items);
    } catch (currentError) {
      setError(errorMessage(currentError));
      setAttachments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const onChanged = () => {
      void refresh();
    };

    window.addEventListener('otter:attachments-changed', onChanged);
    window.addEventListener('otter:storage-changed', onChanged);
    return () => {
      window.removeEventListener('otter:attachments-changed', onChanged);
      window.removeEventListener('otter:storage-changed', onChanged);
    };
  }, [refresh]);

  const attachmentUsage = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const text of entries.map((entry) => entry.content)) {
      for (const fileName of extractAttachmentReferences(text)) {
        counts.set(fileName, (counts.get(fileName) ?? 0) + 1);
      }
    }
    return counts;
  }, [entries]);

  const copyReference = React.useCallback(async (fileName: string) => {
    try {
      await navigator.clipboard.writeText(`![${fileName.replace(/\.[^.]+$/, '') || 'image'}](attachment://${fileName})`);
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, []);

  const removeAttachment = React.useCallback(
    async (fileName: string) => {
      const count = attachmentUsage.get(fileName) ?? 0;
      const confirmMessage =
        count > 0
          ? `Delete ${fileName}? It is still referenced in ${count} place(s).`
          : `Delete ${fileName}?`;
      if (!window.confirm(confirmMessage)) {
        return;
      }

      try {
        await deleteImageAttachment(fileName);
        window.dispatchEvent(new CustomEvent('otter:attachments-changed'));
      } catch (currentError) {
        window.alert(errorMessage(currentError));
      }
    },
    [attachmentUsage],
  );

  const closeViewer = React.useCallback(() => setViewerFileName(''), []);

  return (
    <Page title="Images" subtitle="Manage uploaded image attachments">
      <div className="mx-auto w-full max-w-4xl space-y-3">
        {!isTauriRuntime() ? (
          <EmptyMessage
            title="Images are not stored separately here"
            message="Browser preview uses inline image data. Open the Tauri desktop app to manage uploaded images."
          />
        ) : loading ? (
          <EmptyMessage title="Loading images" message="Reading attachment files..." />
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : attachments.length === 0 ? (
          <EmptyMessage title="No uploaded images" message="Use the image button or paste an image into a note." />
        ) : (
          attachments.map((item) => {
            const usageCount = attachmentUsage.get(item.fileName) ?? 0;
            return (
              <div key={item.fileName} className="surface-card flex items-center gap-4 rounded-lg border p-4">
                <button
                  className="shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                  onClick={() => setViewerFileName(item.originalFileName)}
                  title="View original image"
                >
                  <AttachmentPreviewImage fileName={item.fileName} alt={item.fileName} className="h-20 w-20 object-cover" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{item.fileName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatBytes(item.size)} · Updated {formatAttachmentTime(item.modifiedAt)}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {usageCount > 0 ? `Referenced in ${usageCount} place(s)` : 'Not referenced'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="secondary-button" onClick={() => copyReference(item.fileName)}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </button>
                  <button className="secondary-button text-red-700 hover:bg-red-50" onClick={() => removeAttachment(item.fileName)}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {viewerFileName ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6"
          onClick={closeViewer}
          role="presentation"
        >
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col gap-3 rounded-lg bg-slate-900 p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-100">{viewerFileName}</div>
                <div className="text-xs text-slate-400">Original image</div>
              </div>
              <button className="secondary-button" onClick={closeViewer}>
                <X className="h-4 w-4" />
                Close
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md bg-slate-950 p-2">
              <AttachmentPreviewImage
                fileName={viewerFileName}
                fallbackFileName={viewerFileName}
                alt={viewerFileName}
                className="max-h-[82vh] max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}

function SearchResultsPage({ query }: { query: string }) {
  const selectNote = useAppStore((state) => state.selectNote);
  const setQuery = useAppStore((state) => state.setQuery);
  const [results, setResults] = React.useState<Array<{ noteId: string; title: string; updatedAt: string; preview: string }>>([]);
  const normalizedQuery = query.trim();

  React.useEffect(() => {
    let cancelled = false;
    if (!normalizedQuery) {
      setResults([]);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      try {
        const next = await searchNotes(normalizedQuery);
        if (!cancelled) {
          setResults(next);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [normalizedQuery]);

  return (
    <Page title="Search" subtitle={normalizedQuery ? `Results for "${query}"` : 'Type to search notes and ToDos'}>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        {!normalizedQuery ? (
          <EmptyMessage title="Search your notes" message="Type in the search box to see matching notes, entries, and ToDos." />
        ) : results.length === 0 ? (
          <EmptyMessage title="No matches" message="Try searching by note title, entry content, or ToDo text." />
        ) : null}

        {results.length > 0 ? (
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</div>
            <div className="space-y-2">
              {results.map((item) => (
                <button
                  key={item.noteId}
                  className="surface-card surface-card-hover w-full rounded-lg border p-4 text-left"
                  onClick={() => {
                    setQuery('');
                    selectNote(item.noteId);
                  }}
                >
                  <div className="text-sm font-medium text-slate-900">{displayTitle(item.title)}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.preview}</div>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Page>
  );
}

function SettingsPage() {
  const shortcuts = useAppStore((state) => state.shortcuts);
  const updateShortcut = useAppStore((state) => state.updateShortcut);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  return (
    <Page title="Settings" subtitle="Application settings">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <StorageSettings />
        <BackupSettings />
        <div className="surface-card rounded-lg border p-5">
          <div className="flex items-center gap-2 font-medium">
            <Moon className="h-4 w-4" />
            Theme
          </div>
          <p className="mt-1 text-sm text-slate-500">Switch between light and dark mode.</p>
          <div className="theme-choice-group mt-4" role="radiogroup" aria-label="Theme">
            {[
              { id: 'light', label: 'Light', icon: SunMedium },
              { id: 'dark', label: 'Dark', icon: Moon },
            ].map((item) => {
              const Icon = item.icon;
              const active = theme === item.id;
              return (
                <label
                  key={item.id}
                  className={`theme-choice ${active ? 'theme-choice-active' : ''}`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={item.id}
                    checked={active}
                    onChange={() => setTheme(item.id as 'light' | 'dark')}
                    className="sr-only"
                  />
                  <Icon className="h-4 w-4" />
                  <span className="theme-choice-dot" aria-hidden="true" />
                  {item.label}
                </label>
              );
            })}
          </div>
        </div>
        <div className="surface-card rounded-lg border p-5">
          <div className="flex items-center gap-2 font-medium">
            <Keyboard className="h-4 w-4" />
            Keyboard shortcuts
          </div>
          <div className="mt-4 space-y-3">
            {(['new', 'save', 'edit', 'delete', 'cancel'] as ShortcutAction[]).map((action) => (
              <ShortcutInput
                key={action}
                action={action}
                value={shortcuts?.[action] ?? defaultShortcuts[action]}
                onChange={(shortcut) => updateShortcut(action, shortcut)}
              />
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}

function BackupSettings() {
  const replaceAppState = useAppStore((state) => state.replaceAppState);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState('');

  const exportBackup = React.useCallback(() => {
    setStatus('');
    setError('');
    try {
      const snapshot = snapshotAppState(useAppStore.getState() as ReturnType<typeof useAppStore.getState>);
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `otternote-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus('Backup exported.');
    } catch (currentError) {
      setError(errorMessage(currentError));
    }
  }, []);

  const importBackup = React.useCallback(async (file: File | null) => {
    if (!file) return;
    setStatus('');
    setError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<AppStateSnapshot>;
      const snapshot = normalizeImportedSnapshot(parsed);
      if (!window.confirm('Import will replace the current data set. Continue?')) {
        return;
      }
      replaceAppState(snapshot);
      setStatus('Backup imported.');
    } catch (currentError) {
      setError(errorMessage(currentError));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [replaceAppState]);

  return (
    <div className="surface-card rounded-lg border p-5">
      <div className="flex items-center gap-2 font-medium">
        <Upload className="h-4 w-4" />
        Backup
      </div>
      <p className="mt-1 text-sm text-slate-500">Export or restore the entire local dataset as JSON.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="secondary-button" onClick={exportBackup}>
          <Download className="h-4 w-4" />
          Export JSON
        </button>
        <button className="secondary-button" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4" />
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void importBackup(event.target.files?.[0] ?? null)}
        />
      </div>
      {status ? <div className="mt-3 text-sm text-green-700">{status}</div> : null}
      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
    </div>
  );
}

function StorageSettings() {
  const [storageInfo, setStorageInfo] = React.useState<StorageInfo | null>(null);
  const [draftPath, setDraftPath] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isPicking, setIsPicking] = React.useState(false);
  const tauriRuntime = isTauriRuntime();

  const refreshStorageInfo = React.useCallback(async () => {
    setError('');
    try {
      const info = await getStorageInfo();
      setStorageInfo(info);
      setDraftPath(info?.customPath ?? info?.path ?? '');
    } catch (currentError) {
      setError(errorMessage(currentError));
    }
  }, []);

  React.useEffect(() => {
    if (tauriRuntime) {
      void refreshStorageInfo();
    }
  }, [refreshStorageInfo, tauriRuntime]);

  const applyStoragePath = async (storagePath: string, successMessage: string) => {
    setIsSaving(true);
    setStatus('');
    setError('');
    try {
      const info = await setStoragePath(storagePath);
      setStorageInfo(info);
      setDraftPath(info.customPath ?? info.path);
      window.dispatchEvent(new CustomEvent('otter:storage-changed'));
      setStatus(successMessage);
    } catch (currentError) {
      setError(errorMessage(currentError));
    } finally {
      setIsSaving(false);
    }
  };

  const resetPath = async () => {
    await applyStoragePath('', 'Storage folder reset to default.');
  };

  const choosePath = async () => {
    if (!tauriRuntime) return;
    setIsPicking(true);
    setStatus('');
    setError('');
    try {
      const selected = await openDialog({
        title: 'Choose storage folder',
        defaultPath: storageInfo?.path || storageInfo?.defaultPath,
        directory: true,
        multiple: false,
      });

      if (typeof selected === 'string' && selected.trim()) {
        await applyStoragePath(selected, 'Storage folder saved.');
      }
    } catch (currentError) {
      setError(errorMessage(currentError));
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <div className="surface-card rounded-lg border p-5">
      <div className="flex items-center gap-2 font-medium">
        <Database className="h-4 w-4" />
        Local storage
      </div>
      {tauriRuntime ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Storage folder</span>
            <div className="relative mt-2">
              <input
                value={draftPath}
                readOnly
                disabled={isPicking || isSaving}
                onClick={choosePath}
                placeholder={storageInfo?.defaultPath ?? 'Default app data folder'}
                className="h-10 w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 pr-20 font-mono text-sm outline-none ring-blue-200 focus:ring-2"
              />
              <button
                type="button"
                aria-label="Choose storage folder"
                disabled={isPicking || isSaving}
                onClick={choosePath}
                className="secondary-button absolute right-10 top-1.5 h-7 w-7 !p-0"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Use default storage folder"
                disabled={isPicking || isSaving}
                onClick={resetPath}
                className="secondary-button absolute right-1.5 top-1.5 h-7 w-7 !p-0"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </label>
          <div className="text-xs text-slate-500">
            Choose a folder to save it immediately. Current folder: <span className="font-mono text-slate-700">{storageInfo?.path ?? 'Loading...'}</span>
          </div>
          {status ? <div className="text-sm text-green-700">{status}</div> : null}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">
          Browser preview uses localStorage. Configurable storage folders are available in the Tauri desktop app.
        </p>
      )}
    </div>
  );
}

function HelpPage() {
  return (
    <Page title="Help" subtitle="Minimum usage guide">
      <div className="surface-card mx-auto w-full max-w-2xl rounded-lg border p-5">
        <div className="font-medium">Markdown ToDo</div>
        <pre className="mt-3 rounded-md bg-slate-950 p-4 text-sm text-slate-50">{'- [ ] incomplete task\n- [x] completed task'}</pre>
        <div className="mt-5 font-medium">Images</div>
        <p className="mt-2 text-sm text-slate-500">
          Use the image button in edit mode to insert a local image, or write markdown directly:
        </p>
        <pre className="mt-3 rounded-md bg-slate-950 p-4 text-sm text-slate-50">{'![alt text](data:image/png;base64,...)'}</pre>
      </div>
    </Page>
  );
}

function ShortcutInput({
  action,
  value,
  onChange,
}: {
  action: ShortcutAction;
  value: string;
  onChange: (shortcut: string) => void;
}) {
  const [isRecording, setIsRecording] = React.useState(false);

  React.useEffect(() => {
    if (!isRecording) {
      return;
    }

    setShortcutRecording(true);

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setIsRecording(false);
        return;
      }

      const shortcut = shortcutFromKeyboardEvent(event);
      if (shortcut) {
        onChange(shortcut);
        setIsRecording(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      setShortcutRecording(false);
    };
  }, [isRecording, onChange]);

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="capitalize text-sm font-medium text-slate-800">{action}</div>
        <div className="text-xs text-slate-500">{shortcutHelpText(action)}</div>
      </div>
      <button
        className={`${isRecording ? 'primary-button' : 'secondary-button'} min-w-40 justify-start font-mono`}
        onClick={() => setIsRecording(true)}
        onBlur={() => setIsRecording(false)}
        data-shortcut-recorder={isRecording ? 'true' : 'false'}
      >
        {isRecording ? 'Press keys...' : value}
      </button>
    </div>
  );
}

function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-slate-200 bg-slate-50 px-6 py-4">
      {children ?? <h1 className="text-lg font-semibold">{title}</h1>}
      {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
    </header>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={{ img: MarkdownImageElement }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function AttachmentPreviewImage({
  fileName,
  fallbackFileName,
  alt,
  className,
}: {
  fileName?: string;
  fallbackFileName?: string;
  alt?: string;
  className?: string;
}) {
  const src = useAttachmentObjectUrl(fileName, fallbackFileName);

  if (!src) {
    return alt ? <span>{alt}</span> : null;
  }

  return <img alt={alt ?? ''} src={src} className={className} loading="lazy" />;
}

function useAttachmentObjectUrl(fileName?: string, fallbackFileName?: string) {
  const [src, setSrc] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    const loadAttachment = async (targetFileName: string) => {
      const bytes = await readImageAttachmentBytes(targetFileName);
      if (cancelled) {
        return true;
      }

      objectUrl = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: mimeTypeFromFileName(targetFileName) }),
      );
      setSrc(objectUrl);
      return true;
    };

    const loadFallbacks = async (candidates: string[]) => {
      for (const candidate of candidates) {
        try {
          if (await loadAttachment(candidate)) {
            return true;
          }
        } catch {
          // Try next candidate.
        }
      }

      return false;
    };

    const load = async () => {
      if (!fileName || !isTauriRuntime()) {
        const fallbackCandidates = attachmentFallbackCandidates(fileName, fallbackFileName);
        if (fallbackCandidates.length > 0) {
          if (await loadFallbacks(fallbackCandidates)) {
            return;
          }
        }

        if (!cancelled) {
          setSrc('');
        }
        return;
      }

      try {
        if (await loadAttachment(fileName)) {
          return;
        }
      } catch {
      }

      if (await loadFallbacks(attachmentFallbackCandidates(fileName, fallbackFileName))) {
        return;
      }

      if (!cancelled) {
        setSrc('');
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fallbackFileName, fileName]);

  return src;
}

function MarkdownImageElement({
  src,
  alt,
}: {
  src?: string;
  alt?: string;
}) {
  const attachmentFileName = src?.startsWith('attachment://') ? src.slice('attachment://'.length) : undefined;
  const attachmentSrc = useAttachmentObjectUrl(attachmentFileName);

  if (!src) {
    return alt ? <span>{alt}</span> : null;
  }

  if (!src.startsWith('attachment://')) {
    return <img alt={alt ?? ''} src={src} loading="lazy" />;
  }

  if (!attachmentSrc) {
    return alt ? <span>{alt}</span> : null;
  }

  return <img alt={alt ?? ''} src={attachmentSrc} loading="lazy" />;
}

function attachmentFallbackCandidates(fileName?: string, fallbackFileName?: string) {
  const candidates: string[] = [];

  if (fallbackFileName && fallbackFileName !== fileName) {
    candidates.push(fallbackFileName);
  }

  if (fileName) {
    const previewIndex = fileName.indexOf('.preview.');
    if (previewIndex > 0) {
      const base = fileName.slice(0, previewIndex);
      const currentExt = extractFileExtension(fileName);
      const extensions = [currentExt, 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].filter(Boolean);
      for (const ext of extensions) {
        candidates.push(`${base}.original.${ext}`);
      }
    }
  }

  return Array.from(new Set(candidates));
}

function EmptyMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-blue-200 bg-white p-8 text-center">
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{message}</div>
    </div>
  );
}

function useFilteredTodos() {
  const query = useAppStore((state) => state.query.trim().toLowerCase());
  const todos = useAppStore((state) => state.todos);
  const notes = useAppStore((state) => state.notes);

  return React.useMemo(() => {
    if (!query) return todos;
    return todos.filter((todo) => {
      if (todo.title.toLowerCase().includes(query)) {
        return true;
      }

      const noteTitle = notes.find((note) => note.id === todo.noteId)?.title?.toLowerCase() ?? '';
      return noteTitle.includes(query);
    });
  }, [notes, query, todos]);
}

function formatDate(value: string) {
  return formatCompactDateTime(value);
}

function displayTitle(title: string) {
  return title.trim() || 'Untitled Note';
}

function titleFromFirstLine(content: string) {
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const title = firstLine.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return title.slice(0, 80);
}

function formatTime(value: string) {
  return formatCompactDateTime(value);
}

function formatCompactDateTime(value: string) {
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function groupNotesByDate(notes: ReturnType<typeof useAppStore.getState>['notes']) {
  const sorted = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = new Map<string, typeof sorted>();

  for (const note of sorted) {
    const label = dateGroupLabel(note.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), note]);
  }

  return Array.from(groups.entries()).map(([label, groupNotes]) => ({
    label,
    notes: groupNotes,
  }));
}

function dateGroupLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDate(date, today)) return 'Today';
  if (isSameDate(date, yesterday)) return 'Yesterday';

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function isSameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  const expected = parseShortcut(shortcut);
  if (!expected.key) return false;

  const key = normalizeKey(event.key);
  const primaryPressed = event.metaKey || event.ctrlKey;

  return (
    key === expected.key &&
    event.shiftKey === expected.shift &&
    event.altKey === expected.alt &&
    (expected.primary ? primaryPressed : !event.metaKey && !event.ctrlKey)
  );
}

function parseShortcut(shortcut: string) {
  const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean);
  return {
    primary: parts.some((part) => ['mod', 'cmd', 'command', 'meta', 'ctrl', 'control'].includes(part.toLowerCase())),
    shift: parts.some((part) => part.toLowerCase() === 'shift'),
    alt: parts.some((part) => part.toLowerCase() === 'alt' || part.toLowerCase() === 'option'),
    key: normalizeKey(parts[parts.length - 1] ?? ''),
  };
}

function shortcutFromKeyboardEvent(event: KeyboardEvent) {
  const key = normalizeKey(event.key);
  if (!key || ['Meta', 'Control', 'Shift', 'Alt'].includes(key)) {
    return '';
  }

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('Cmd');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  parts.push(key);
  return parts.join('+');
}

function normalizeKey(key: string) {
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Esc';
  if (key === 'Delete') return 'Delete';
  if (key === 'Backspace') return 'Backspace';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    target.isContentEditable ||
    Boolean(target.closest('.cm-editor'))
  );
}

function isShortcutRecorderTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('[data-shortcut-recorder="true"]'));
}

function setShortcutRecording(value: boolean) {
  document.documentElement.dataset.shortcutRecording = value ? 'true' : 'false';
}

function isShortcutRecording() {
  return document.documentElement.dataset.shortcutRecording === 'true';
}

function normalizeShortcutLabel(shortcut: string) {
  return shortcut
    .split('+')
    .map((part) => {
      const trimmed = part.trim();
      const lower = trimmed.toLowerCase();
      if (['mod', 'cmd', 'command', 'meta', 'ctrl', 'control'].includes(lower)) {
        return 'Cmd';
      }
      if (lower === 'escape') {
        return 'Esc';
      }
      return trimmed;
    })
    .filter(Boolean)
    .join('+');
}

function shortcutHelpText(action: ShortcutAction) {
  switch (action) {
    case 'new':
      return 'Open a new note composer.';
    case 'save':
      return 'Save the current new or edited content.';
    case 'edit':
      return 'Edit the current note content.';
    case 'delete':
      return 'Delete the current note.';
    case 'cancel':
      return 'Cancel the current edit or close the current composer.';
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function summarizeNotePreview(noteId: string, entries: ReturnType<typeof useAppStore.getState>['entries'], todos: ReturnType<typeof useAppStore.getState>['todos']) {
  const noteEntries = entries.filter((entry) => entry.noteId === noteId);
  const firstTextEntry = noteEntries.find((entry) => entry.content.trim());
  const todoCount = todos.filter((todo) => todo.noteId === noteId).length;

  if (!firstTextEntry) {
    return todoCount > 0 ? `${todoCount} ToDo${todoCount === 1 ? '' : 's'}` : 'No content yet.';
  }

  const preview = compactPreviewText(firstTextEntry.content);
  if (!preview) {
    return todoCount > 0 ? `${todoCount} ToDo${todoCount === 1 ? '' : 's'}` : 'No content yet.';
  }

  return todoCount > 0 ? `${preview} · ${todoCount} ToDo${todoCount === 1 ? '' : 's'}` : preview;
}

function compactPreviewText(content: string) {
  return content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function normalizeImportedSnapshot(value: Partial<AppStateSnapshot>): AppStateSnapshot {
  return {
    activeSection: value.activeSection ?? 'notes',
    selectedNoteId: value.selectedNoteId,
    query: value.query ?? '',
    searchFocused: false,
    notes: Array.isArray(value.notes) ? value.notes : [],
    entries: Array.isArray(value.entries) ? value.entries : [],
    todos: Array.isArray(value.todos) ? value.todos : [],
    recentNoteIds: Array.isArray(value.recentNoteIds) ? value.recentNoteIds : [],
    shortcuts: {
      ...defaultShortcuts,
      ...normalizeImportedShortcuts(value.shortcuts),
    },
    theme: value.theme ?? 'light',
    deletedStack: Array.isArray(value.deletedStack) ? value.deletedStack : [],
  };
}

function normalizeImportedShortcuts(shortcuts?: AppStateSnapshot['shortcuts']) {
  if (!shortcuts) {
    return {};
  }

  const { undo: _undo, ...rest } = shortcuts as Partial<AppStateSnapshot['shortcuts']> & { undo?: string };
  return Object.fromEntries(
    Object.entries(rest).map(([action, shortcut]) => [action, normalizeShortcutLabel(shortcut)]),
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
