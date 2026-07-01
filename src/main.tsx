import React from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EditorView } from '@codemirror/view';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  Download,
  CheckSquare,
  Clock3,
  Database,
  Copy,
  HelpCircle,
  Eye,
  Image as ImageIcon,
  Keyboard,
  NotebookText,
  Pencil,
  Plus,
  Moon,
  Upload,
  RotateCcw,
  Save,
  Search,
  Settings,
  Trash2,
  SunMedium,
  X,
} from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { isAbsolute } from '@tauri-apps/api/path';
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
  setStoragePath,
  searchNotes,
  writeExportFile,
  validateStoragePath,
  type ImageAttachment,
  type StorageInfo,
} from './storage';
import { parseTodosFromEntry } from './todo-parser';

const navItems: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'notes', label: 'Notes', icon: NotebookText },
  { id: 'todos', label: 'ToDo List', icon: CheckSquare },
  { id: 'timeline', label: 'Timeline', icon: Clock3 },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'help', label: 'Help', icon: HelpCircle },
];

function App() {
  const hasContent = useAppStore((state) => state.notes.length > 0 || state.todos.length > 0);
  const activeSection = useAppStore((state) => state.activeSection);
  const query = useAppStore((state) => state.query.trim());
  const theme = useAppStore((state) => state.theme);
  useKeyboardShortcuts();
  useTheme(theme);
  const showSearchResults =
    Boolean(query) && activeSection !== 'new' && activeSection !== 'settings' && activeSection !== 'help' && activeSection !== 'images';

  return (
    <div className="app-shell flex h-screen bg-slate-50 text-slate-950">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {showSearchResults ? <SearchResultsPage query={query} /> : null}
        {activeSection === 'timeline' && !showSearchResults ? (hasContent ? <Timeline /> : <TimelineEmptyState />) : null}
        {activeSection === 'new' ? <NewEntryPage /> : null}
        {activeSection === 'notes' && !showSearchResults ? <NotesWorkspace /> : null}
        {activeSection === 'todos' && !showSearchResults ? <TodosPage /> : null}
        {activeSection === 'images' ? <ImagesPage /> : null}
        {activeSection === 'settings' ? <SettingsPage /> : null}
        {activeSection === 'help' ? <HelpPage /> : null}
      </main>
    </div>
  );
}

function useKeyboardShortcuts() {
  const shortcuts = useAppStore((state) => state.shortcuts);
  const undoLastDelete = useAppStore((state) => state.undoLastDelete);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const config = {
        ...defaultShortcuts,
        ...shortcuts,
      };

      if (matchesShortcut(event, config.save)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('otter:save'));
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

      if (matchesShortcut(event, config.undo) && !isTextInputTarget(event.target)) {
        event.preventDefault();
        undoLastDelete();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [shortcuts, undoLastDelete]);
}

function Sidebar() {
  const activeSection = useAppStore((state) => state.activeSection);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const clearSelectedNote = useAppStore((state) => state.clearSelectedNote);
  const query = useAppStore((state) => state.query);
  const setQuery = useAppStore((state) => state.setQuery);
  const notes = useAppStore((state) => state.notes);
  const recentNoteIds = useAppStore((state) => state.recentNoteIds);
  const selectedNoteId = useAppStore((state) => state.selectedNoteId);
  const selectNote = useAppStore((state) => state.selectNote);

  const recentNotes = recentNoteIds
    .map((id) => notes.find((note) => note.id === id))
    .filter((note): note is NonNullable<typeof note> => Boolean(note))
    .slice(0, 5);
  const sortedNotes = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <aside className="sidebar-panel flex w-80 shrink-0 flex-col border-r border-blue-100 bg-blue-50/80">
      <div className="px-3 pt-3">
        <div className="px-1 py-1.5">
          <div className="flex items-center gap-3">
            <img
              src="/app-logo.png"
              alt=""
              aria-hidden="true"
              className="h-10 w-10 rounded-xl object-cover"
            />
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-blue-950">OtterNote</div>
              <div className="truncate text-[11px] text-slate-500">Notes, todo, timeline</div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setActiveSection('notes')}
            placeholder="Search notes, todos..."
            className="h-10 w-full rounded-md border border-blue-100 bg-white pl-9 pr-3 text-sm outline-none ring-blue-200 focus:ring-2"
          />
        </label>
      </div>

      <div className="px-3 py-2.5">
        <button className="primary-button h-10 w-full" onClick={() => setActiveSection('new')}>
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto px-3">
        <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recent opened</div>
        {recentNotes.length === 0 ? (
          <p className="rounded-md border border-dashed border-blue-200 bg-white/60 p-3 text-sm text-slate-500">
            No recently opened notes.
          </p>
        ) : (
          <div className="mb-4 space-y-1">
            {recentNotes.map((note) => (
              <button
                key={note.id}
                className={`sidebar-item w-full rounded-md px-3 py-2 text-left text-sm ${
                  selectedNoteId === note.id ? 'sidebar-selected shadow-sm' : 'text-slate-700 hover:bg-white'
                }`}
                onClick={() => selectNote(note.id)}
              >
                <div className="truncate font-medium">{displayTitle(note.title)}</div>
                <div className={`truncate text-xs ${selectedNoteId === note.id ? 'sidebar-selected-meta' : 'text-slate-500'}`}>
                  {formatDate(note.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Notes</div>
        {sortedNotes.length === 0 ? (
          <p className="rounded-md border border-dashed border-blue-200 bg-white/60 p-3 text-sm text-slate-500">
            No notes yet.
          </p>
        ) : (
          <div className="space-y-1">
            {sortedNotes.map((note) => (
              <button
                key={note.id}
                className={`sidebar-item w-full rounded-md px-3 py-2 text-left text-sm ${
                  selectedNoteId === note.id ? 'sidebar-selected shadow-sm' : 'text-slate-700 hover:bg-white'
                }`}
                onClick={() => selectNote(note.id)}
              >
                <div className="truncate font-medium">{displayTitle(note.title)}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      <nav className="border-t border-blue-100 p-3">
        <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Navigation
        </div>
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                className={`sidebar-item flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  active ? 'sidebar-selected' : 'text-slate-700 hover:bg-white'
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

function EmptyState() {
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const createStandaloneTodo = useAppStore((state) => state.createStandaloneTodo);
  const setQuery = useAppStore((state) => state.setQuery);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <h1 className="mb-3 text-center text-2xl font-semibold">Start with search or create</h1>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
          <input
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes, todos..."
            className="h-12 w-full rounded-lg border border-blue-100 bg-white pl-12 pr-4 outline-none ring-blue-200 focus:ring-2"
          />
        </label>
        <div className="mt-5 flex justify-center gap-3">
          <button className="primary-button h-11 px-5" onClick={() => setActiveSection('new')}>
            <Plus className="h-4 w-4" />
            New
          </button>
          <button className="secondary-button h-11 px-5" onClick={() => createStandaloneTodo('Untitled ToDo')}>
            <CheckSquare className="h-4 w-4" />
            New ToDo
          </button>
        </div>
      </div>
    </div>
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
  const createNoteWithEntry = useAppStore((state) => state.createNoteWithEntry);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const [draft, setDraft] = React.useState('');
  const [isPreviewing, setIsPreviewing] = React.useState(false);
  const editorViewRef = React.useRef<EditorView | null>(null);

  const insertImage = React.useCallback(async () => {
    try {
      const image = await chooseMarkdownImage();
      if (!image) return;

      insertMarkdownAtCursor(editorViewRef.current, `![${image.altText}](${image.markdownUrl})`, setDraft);
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, []);

  const saveDraft = React.useCallback(() => {
    if (!draft.trim()) return;
    createNoteWithEntry(draft);
    setDraft('');
    setIsPreviewing(false);
  }, [createNoteWithEntry, draft]);

  React.useEffect(() => {
    const onSave = () => saveDraft();
    window.addEventListener('otter:save', onSave);
    return () => window.removeEventListener('otter:save', onSave);
  }, [saveDraft]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <header className="border-b border-slate-200 px-6 py-4">
        <h1 className="text-lg font-semibold">New</h1>
        <p className="mt-1 text-sm text-slate-500">Write a note and capture ToDo items inline.</p>
      </header>
      <WorkspaceToolbar
        mode={isPreviewing ? 'preview' : 'edit'}
        showPreviewButton
        onInsertImage={isPreviewing ? undefined : insertImage}
        onTogglePreview={() => setIsPreviewing((value) => !value)}
        onSave={saveDraft}
        onCancel={() => {
          setDraft('');
          setIsPreviewing(false);
          setActiveSection('timeline');
        }}
        onDelete={undefined}
        previewLabel="Preview"
        editLabel="Edit"
        saveLabel="Save"
        cancelLabel="Cancel"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {isPreviewing ? (
          <div className="mx-auto w-full max-w-3xl">
            <div className="rounded-lg bg-white p-4">
              {draft.trim() ? <MarkdownContent content={draft} /> : <EmptyMessage title="Empty draft" message="Type content to preview it." />}
            </div>
          </div>
        ) : (
          <div className="editor-shell mx-auto w-full max-w-3xl">
            <CodeMirror
              value={draft}
              height="100%"
              extensions={[markdown(), imagePasteExtension((file, view) => insertImageFile(file, setDraft, view))]}
              basicSetup={{ lineNumbers: false, foldGutter: false }}
              onChange={setDraft}
              onCreateEditor={(view) => {
                editorViewRef.current = view;
              }}
              placeholder={'Start writing...\n\n- [ ] Add a ToDo'}
            />
          </div>
        )}
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
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
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
  const selectNote = useAppStore((state) => state.selectNote);
  const sortedNotes = React.useMemo(() => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [notes]);

  return (
    <Page title="Notes" subtitle="All notes">
      <div className="mx-auto w-full max-w-3xl space-y-2.5">
        {sortedNotes.length === 0 ? (
          <EmptyMessage title="No notes yet" message="Create a note to start writing." />
        ) : (
          sortedNotes.map((note) => (
            <button
              key={note.id}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50"
              onClick={() => selectNote(note.id)}
            >
              <div className="text-sm font-medium text-slate-900">{displayTitle(note.title)}</div>
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
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, []);

  React.useEffect(() => {
    const onEdit = () => startEditing();
    const onDelete = () => deleteCurrentNote();
    const onSave = () => {
      if (isEditing) {
        saveDraft();
      }
    };

    window.addEventListener('otter:edit', onEdit);
    window.addEventListener('otter:delete', onDelete);
    window.addEventListener('otter:save', onSave);
    return () => {
      window.removeEventListener('otter:edit', onEdit);
      window.removeEventListener('otter:delete', onDelete);
      window.removeEventListener('otter:save', onSave);
    };
  }, [deleteCurrentNote, isEditing, saveDraft, startEditing]);

  if (!note) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <header className="border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <input
            value={note.title}
            onChange={(event) => updateNoteTitle(note.id, event.target.value)}
            placeholder="Untitled Note"
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
          />
        </div>
        <p className="mt-1 text-sm text-slate-500">Updated {formatDate(note.updatedAt)}</p>
      </header>
      <WorkspaceToolbar
        mode={isEditing ? 'edit' : 'preview'}
        showPreviewButton={isEditing}
        onExport={exportCurrentNote}
        onInsertImage={isEditing ? insertImage : undefined}
        onTogglePreview={() => {
          if (isEditing) {
            cancelEditing();
          } else {
            startEditing();
          }
        }}
        onSave={saveDraft}
        onCancel={cancelEditing}
        onDelete={deleteCurrentNote}
        previewLabel="Preview"
        editLabel="Edit"
        saveLabel="Save"
        cancelLabel="Cancel"
      />
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
            <article className="bg-white p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm italic text-slate-400">
                    No note text. This note only has a title.
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-400">{formatDate(note.updatedAt)}</div>
            </article>
          ) : (
            entries.map((entry) => <EntryCard key={entry.id} entryId={entry.id} />)
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceToolbar({
  mode,
  showPreviewButton = true,
  onExport,
  onInsertImage,
  onTogglePreview,
  onSave,
  onCancel,
  onDelete,
  previewLabel,
  editLabel,
  saveLabel,
  cancelLabel,
}: {
  mode: 'preview' | 'edit';
  showPreviewButton?: boolean;
  onExport?: () => void;
  onInsertImage?: () => void;
  onTogglePreview: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  previewLabel: string;
  editLabel: string;
  saveLabel: string;
  cancelLabel: string;
}) {
  return (
    <div className="border-b border-slate-200 px-6 py-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onExport ? (
          <button className="secondary-button" onClick={onExport}>
            <Download className="h-4 w-4" />
            Export
          </button>
        ) : null}
        {mode === 'edit' && onInsertImage ? (
          <button className="secondary-button" onClick={onInsertImage}>
            <ImageIcon className="h-4 w-4" />
            Image
          </button>
        ) : null}
        {showPreviewButton ? (
          <button
            className={`secondary-button ${mode === 'preview' ? 'bg-slate-100 text-slate-800' : ''}`}
            onClick={onTogglePreview}
            aria-pressed={mode === 'preview'}
          >
            <Eye className="h-4 w-4" />
            {previewLabel}
          </button>
        ) : null}
        {mode === 'edit' ? (
          <>
            <button className="secondary-button" onClick={onCancel}>
              <X className="h-4 w-4" />
              {cancelLabel}
            </button>
            <button className="primary-button" onClick={onSave}>
              <Save className="h-4 w-4" />
              {saveLabel}
            </button>
          </>
        ) : (
          <button className="secondary-button" onClick={onTogglePreview}>
            <Pencil className="h-4 w-4" />
            {editLabel}
          </button>
        )}
        {onDelete ? (
          <button className="secondary-button text-red-700 hover:bg-red-50" onClick={onDelete}>
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

type MarkdownImage = {
  altText: string;
  markdownUrl: string;
};

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
  if (isTauriRuntime()) {
    const attachmentBaseName = createId('img');
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const previewFileName = await saveImageAttachmentBytes(bytes, file.name, attachmentBaseName);
    window.dispatchEvent(new CustomEvent('otter:attachments-changed'));
    return {
      altText: extractAltText(file.name),
      markdownUrl: `attachment://${previewFileName}`,
    };
  }

  return { altText: extractAltText(file.name), markdownUrl: await readFileAsOptimizedDataUrl(file) };
}

function mimeTypeToExtension(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return '';
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
  if (!view) {
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
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && file.type.startsWith('image/')) {
      return file;
    }
  }

  return null;
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

  const visibleContent = stripTaskLines(entry.content);

  return (
    <article className="bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {visibleContent ? (
            <MarkdownContent content={visibleContent} />
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
      <div className="mt-3 text-xs text-slate-400">{formatDate(entry.createdAt)}</div>
    </article>
  );
}

function TodosPage() {
  const todos = useFilteredTodos();
  const toggleTodo = useAppStore((state) => state.toggleTodo);
  const deleteTodo = useAppStore((state) => state.deleteTodo);
  const notes = useAppStore((state) => state.notes);

  return (
    <Page title="ToDo List" subtitle="All standalone and note-sourced tasks">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {todos.length === 0 ? (
          <EmptyMessage title="No ToDo items" message="Create standalone tasks or add - [ ] inside a note entry." />
        ) : (
          todos.map((todo) => {
            const source = notes.find((note) => note.id === todo.noteId)?.title ?? 'Standalone';
            return (
              <div key={todo.id} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
                <input
                  type="checkbox"
                  checked={todo.status === 'done'}
                  onChange={(event) => toggleTodo(todo.id, event.target.checked)}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className={todo.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-900'}>{todo.title}</div>
                  <div className="mt-1 text-xs text-slate-500">Source: {source}</div>
                </div>
                <button className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => deleteTodo(todo.id)}>
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
              <div key={item.fileName} className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-4">
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

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const next = await searchNotes(query);
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
  }, [query]);

  return (
    <Page title="Search" subtitle={`Results for "${query}"`}>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        {results.length === 0 ? (
          <EmptyMessage title="No matches" message="Try searching by note title, entry content, or ToDo text." />
        ) : null}

        {results.length > 0 ? (
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</div>
            <div className="space-y-2">
              {results.map((item) => (
                <button
                  key={item.noteId}
                  className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left hover:bg-slate-50"
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
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 font-medium">
            <Moon className="h-4 w-4" />
            Theme
          </div>
          <p className="mt-1 text-sm text-slate-500">Switch between light and dark mode.</p>
          <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {[
              { id: 'light', label: 'Light', icon: SunMedium },
              { id: 'dark', label: 'Dark', icon: Moon },
            ].map((item) => {
              const Icon = item.icon;
              const active = theme === item.id;
              return (
                <button
                  key={item.id}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                    active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                  aria-pressed={active}
                  onClick={() => setTheme(item.id as 'light' | 'dark')}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 font-medium">
            <Keyboard className="h-4 w-4" />
            Keyboard shortcuts
          </div>
          <div className="mt-4 space-y-3">
            {(['save', 'edit', 'delete', 'undo'] as ShortcutAction[]).map((action) => (
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
    <div className="rounded-lg border border-slate-200 bg-white p-5">
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

  const validateDraftPath = React.useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (tauriRuntime) {
      const absolute = await isAbsolute(trimmed);
      if (!absolute && !trimmed.startsWith('~/')) {
        return 'Storage folder must be an absolute path or start with ~/.'; 
      }

      try {
        await validateStoragePath(trimmed);
      } catch (currentError) {
        return errorMessage(currentError);
      }
    }

    return '';
  }, [tauriRuntime]);

  const [pathIssue, setPathIssue] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const issue = await validateDraftPath(draftPath);
      if (!cancelled) {
        setPathIssue(issue);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [draftPath, validateDraftPath]);

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

  const savePath = async () => {
    const issue = await validateDraftPath(draftPath);
    if (issue) {
      setPathIssue(issue);
      setError(issue);
      return;
    }

    setIsSaving(true);
    setStatus('');
    setError('');
    try {
      const info = await setStoragePath(draftPath);
      setStorageInfo(info);
      setDraftPath(info.customPath ?? info.path);
      window.dispatchEvent(new CustomEvent('otter:storage-changed'));
      setStatus('Storage folder saved.');
    } catch (currentError) {
      setError(errorMessage(currentError));
    } finally {
      setIsSaving(false);
    }
  };

  const resetPath = async () => {
    setDraftPath('');
    setIsSaving(true);
    setStatus('');
    setError('');
    try {
      const info = await setStoragePath('');
      setStorageInfo(info);
      setDraftPath(info.path);
      window.dispatchEvent(new CustomEvent('otter:storage-changed'));
      setStatus('Storage folder reset to default.');
    } catch (currentError) {
      setError(errorMessage(currentError));
    } finally {
      setIsSaving(false);
    }
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
        setDraftPath(selected);
      }
    } catch (currentError) {
      setError(errorMessage(currentError));
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 font-medium">
        <Database className="h-4 w-4" />
        Local storage
      </div>
      {tauriRuntime ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Storage folder</span>
            <input
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
              placeholder={storageInfo?.defaultPath ?? 'Default app data folder'}
              className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-sm outline-none ring-blue-200 focus:ring-2"
            />
          </label>
          <div className="flex flex-wrap justify-between gap-2">
            <button className="secondary-button" disabled={isPicking || isSaving} onClick={choosePath}>
              <Search className="h-4 w-4" />
              Choose Folder
            </button>
            <div className="text-xs text-slate-500">
              Leave empty to use the default app data folder.
            </div>
          </div>
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">
            Current folder: <span className="font-mono text-slate-700">{storageInfo?.path ?? 'Loading...'}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button className="secondary-button" disabled={isSaving} onClick={resetPath}>
              <RotateCcw className="h-4 w-4" />
              Default
            </button>
            <button className="primary-button" disabled={isSaving || Boolean(pathIssue) || !draftPath.trim()} onClick={savePath}>
              <Save className="h-4 w-4" />
              Save Path
            </button>
          </div>
          {pathIssue ? <div className="text-sm text-red-600">{pathIssue}</div> : null}
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
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-5">
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

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="capitalize text-sm font-medium text-slate-800">{action}</div>
        <div className="text-xs text-slate-500">{shortcutHelpText(action)}</div>
      </div>
      <button
        className={`min-w-40 rounded-md border px-3 py-2 text-left font-mono text-sm ${
          isRecording ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700'
        }`}
        onClick={() => setIsRecording(true)}
        onBlur={() => setIsRecording(false)}
        onKeyDown={(event) => {
          event.preventDefault();
          const shortcut = shortcutFromKeyboardEvent(event.nativeEvent);
          if (shortcut) {
            onChange(shortcut);
            setIsRecording(false);
          }
        }}
      >
        {isRecording ? 'Press keys...' : value}
      </button>
    </div>
  );
}

function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-3.5">
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </div>
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

    const load = async () => {
      if (!fileName || !isTauriRuntime()) {
        if (fallbackFileName && fallbackFileName !== fileName) {
          try {
            const bytes = await readImageAttachmentBytes(fallbackFileName);
            if (cancelled) {
              return;
            }

            objectUrl = URL.createObjectURL(
              new Blob([new Uint8Array(bytes)], { type: mimeTypeFromFileName(fallbackFileName) }),
            );
            setSrc(objectUrl);
            return;
          } catch {
            if (!cancelled) {
              setSrc('');
            }
          }
        } else {
          setSrc('');
        }
        return;
      }

      try {
        const bytes = await readImageAttachmentBytes(fileName);
        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: mimeTypeFromFileName(fileName) }),
        );
        setSrc(objectUrl);
      } catch {
        if (fallbackFileName && fallbackFileName !== fileName) {
          try {
            const bytes = await readImageAttachmentBytes(fallbackFileName);
            if (cancelled) {
              return;
            }

            objectUrl = URL.createObjectURL(
              new Blob([new Uint8Array(bytes)], { type: mimeTypeFromFileName(fallbackFileName) }),
            );
            setSrc(objectUrl);
          } catch {
            if (!cancelled) {
              setSrc('');
            }
          }
        } else if (!cancelled) {
          setSrc('');
        }
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

function stripTaskLines(content: string) {
  return content
    .split('\n')
    .filter((line) => parseTodosFromEntry(line).length === 0)
    .join('\n')
    .trim();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function displayTitle(title: string) {
  return title.trim() || 'Untitled Note';
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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
  const modPressed = event.metaKey || event.ctrlKey;

  return (
    key === expected.key &&
    event.shiftKey === expected.shift &&
    event.altKey === expected.alt &&
    (expected.mod ? modPressed : !event.metaKey && !event.ctrlKey)
  );
}

function parseShortcut(shortcut: string) {
  const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean);
  return {
    mod: parts.some((part) => part.toLowerCase() === 'mod'),
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
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
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

function shortcutHelpText(action: ShortcutAction) {
  switch (action) {
    case 'save':
      return 'Save the current new or edited content.';
    case 'edit':
      return 'Edit the current note content.';
    case 'delete':
      return 'Delete the current note.';
    case 'undo':
      return 'Restore the last deleted note, entry, or ToDo.';
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function buildSearchResults(
  query: string,
  notes: ReturnType<typeof useAppStore.getState>['notes'],
  entries: ReturnType<typeof useAppStore.getState>['entries'],
  todos: ReturnType<typeof useAppStore.getState>['todos'],
) {
  if (!query) {
    return { total: 0, notes: [], entries: [], todos: [] };
  }

  const noteResults = notes
    .map((note) => {
      const matchedEntry = entries.find(
        (entry) => entry.noteId === note.id && entry.content.toLowerCase().includes(query),
      );
      const matchedTodo = todos.find(
        (todo) => todo.noteId === note.id && todo.title.toLowerCase().includes(query),
      );
      if (
        !note.title.toLowerCase().includes(query) &&
        !matchedEntry &&
        !matchedTodo
      ) {
        return null;
      }

      return {
        note,
        preview:
          note.title.toLowerCase().includes(query)
            ? 'Matched note title'
            : matchedEntry
              ? snippetFromContent(matchedEntry.content, query)
              : `Matched ToDo: ${matchedTodo?.title ?? ''}`,
      };
    })
    .filter((item): item is { note: (typeof notes)[number]; preview: string } => Boolean(item));

  const entryResults = entries
    .filter((entry) => entry.content.toLowerCase().includes(query))
    .map((entry) => ({
      entry,
      note: notes.find((note) => note.id === entry.noteId)!,
      preview: snippetFromContent(entry.content, query),
    }))
    .filter((item) => Boolean(item.note));

  const todoResults = todos
    .filter((todo) => todo.title.toLowerCase().includes(query))
    .map((todo) => ({
      todo,
      note: notes.find((note) => note.id === todo.noteId),
      source:
        notes.find((note) => note.id === todo.noteId)?.title ?? 'Standalone',
    }));

  return {
    total: noteResults.length + entryResults.length + todoResults.length,
    notes: noteResults,
    entries: entryResults,
    todos: todoResults,
  };
}

function snippetFromContent(content: string, query: string) {
  const lower = content.toLowerCase();
  const index = lower.indexOf(query);
  if (index < 0) {
    return content.slice(0, 120);
  }

  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + query.length + 80);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return `${prefix}${content.slice(start, end).replace(/\s+/g, ' ')}${suffix}`;
}

function normalizeImportedSnapshot(value: Partial<AppStateSnapshot>): AppStateSnapshot {
  return {
    activeSection: value.activeSection ?? 'timeline',
    selectedNoteId: value.selectedNoteId,
    query: value.query ?? '',
    notes: Array.isArray(value.notes) ? value.notes : [],
    entries: Array.isArray(value.entries) ? value.entries : [],
    todos: Array.isArray(value.todos) ? value.todos : [],
    activities: Array.isArray(value.activities) ? value.activities : [],
    recentNoteIds: Array.isArray(value.recentNoteIds) ? value.recentNoteIds : [],
    shortcuts: {
      ...defaultShortcuts,
      ...(value.shortcuts ?? {}),
    },
    theme: value.theme ?? 'light',
    deletedStack: Array.isArray(value.deletedStack) ? value.deletedStack : [],
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
