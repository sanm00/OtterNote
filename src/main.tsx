import React from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { visit } from 'unist-util-visit';
import { type Root } from 'hast';
import { EditorView } from '@codemirror/view';
import { emit, listen } from '@tauri-apps/api/event';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import './styles.css';
import { createId } from './id';
import { collectTags } from './lib/tags';
import { addDays, todayKey } from './lib/dates';
import { updateTodoStatusInContent } from './todo-parser';
import { attachmentFallbackCandidates, extractAttachmentReferences } from './lib/attachments';
import {
  extractAltText,
  extractFileName,
  formatAttachmentTime,
  formatBytes,
  imageExtensionFromMimeType,
  isImageFileName,
  mimeTypeFromFileName,
  normalizeClipboardImagePath,
} from './lib/files';
import {
  buildExportFileName,
  buildNoteMarkdown,
  displayTitle,
  markdownUrlTransform,
  titleFromFirstLine,
} from './lib/markdown';
import {
  defaultShortcuts,
  migrateShortcuts,
  snapshotAppState,
  useAppStore,
  type AppStateSnapshot,
  type NavSection,
  type ThemeMode,
  type ShortcutAction,
  type Note,
  type Todo,
} from './store';
import { NoteInsights, NoteTags } from './components/NoteInsights';
import { EmptyMessage, Page } from './components/ui';
import { Icon } from './components/Icon';
import { confirmDeletion } from './lib/confirm';
import { downloadTextFile } from './lib/export-file';
import { localeLabels, locales, useI18n, type Locale, type MessageKey } from './lib/i18n';
import { PlanView } from './views/PlanView';
import { ReviewView } from './views/ReviewView';
import {
  getStorageInfo,
  invalidatePersistedAppState,
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
const SEARCH_DEBOUNCE_DELAY_MS = 180;
const NOTE_TITLE_SAVE_DELAY_MS = 500;

const navItems: Array<{ id: NavSection; labelKey: MessageKey; icon: 'calendar' | 'note' | 'bar-chart' }> = [
  { id: 'plan', labelKey: 'nav.plan', icon: 'calendar' },
  { id: 'notes', labelKey: 'nav.notes', icon: 'note' },
  { id: 'review', labelKey: 'nav.review', icon: 'bar-chart' },
];

const auxiliaryNavItems: Array<{
  id: NavSection;
  labelKey: MessageKey;
  icon: 'image' | 'settings' | 'help';
}> = [
  { id: 'images', labelKey: 'nav.images', icon: 'image' },
  { id: 'settings', labelKey: 'nav.settings', icon: 'settings' },
  { id: 'help', labelKey: 'nav.help', icon: 'help' },
];

function App() {
  const theme = useAppStore((state) => state.theme);
  useTheme(theme);
  useAppStateChangeSync();

  if (getPinnedNewNote()) {
    return <PinnedNewNoteWindow />;
  }

  const pinnedNoteId = getPinnedNoteId();
  if (pinnedNoteId) {
    return <PinnedNoteWindow noteId={pinnedNoteId} />;
  }

  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const activeSection = useAppStore((state) => state.activeSection);
  const query = useAppStore((state) => state.query.trim());
  const searchFocused = useAppStore((state) => state.searchFocused);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  useKeyboardShortcuts();
  useOpenLatestNoteOnStartup(setActiveSection);
  const showSearchResults =
    (searchFocused || Boolean(query)) &&
    activeSection !== 'new' &&
    activeSection !== 'settings' &&
    activeSection !== 'help' &&
    activeSection !== 'images';

  return (
    <div className="app-shell flex h-screen">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {showSearchResults ? <SearchResultsPage query={query} /> : null}
        {activeSection === 'plan' && !showSearchResults ? <PlanView /> : null}
        {activeSection === 'review' && !showSearchResults ? <ReviewView /> : null}
        {activeSection === 'new' && !showSearchResults ? <NewEntryPage /> : null}
        {activeSection === 'notes' && !showSearchResults ? <NotesWorkspace /> : null}
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
  const focusCapture = useAppStore((state) => state.focusCapture);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const config = migrateShortcuts(shortcuts);

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

      if (matchesShortcut(event, config.capture)) {
        if (event.repeat) {
          return;
        }
        event.preventDefault();
        focusCapture();
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

      if (
        matchesShortcut(event, (shortcuts as Record<string, string>).undo ?? '') &&
        !isTextInputTarget(event.target)
      ) {
        event.preventDefault();
        undoLastDelete();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    clearSelectedNote,
    focusCapture,
    searchFocused,
    setActiveSection,
    setQuery,
    setSearchFocused,
    shortcuts,
    undoLastDelete,
  ]);
}

function Sidebar() {
  const activeSection = useAppStore((state) => state.activeSection);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const clearSelectedNote = useAppStore((state) => state.clearSelectedNote);
  const setSearchFocused = useAppStore((state) => state.setSearchFocused);
  const query = useAppStore((state) => state.query);
  const setQuery = useAppStore((state) => state.setQuery);
  const notes = useAppStore((state) => state.notes);
  const selectNote = useAppStore((state) => state.selectNote);
  const shortcuts = useAppStore((state) => state.shortcuts);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const todos = useAppStore((state) => state.todos);
  const { t } = useI18n();
  const todayBadge = React.useMemo(() => {
    const key = todayKey();
    return todos.filter((todo) => todo.status !== 'done' && todo.due && todo.due <= key).length;
  }, [todos]);
  const newShortcutLabel = normalizeShortcutLabel((shortcuts?.new ?? defaultShortcuts.new) || '');
  const captureShortcutLabel = normalizeShortcutLabel((shortcuts?.capture ?? defaultShortcuts.capture) || '');

  const sortedNotes = React.useMemo(
    () => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes],
  );
  return (
    <aside className="sidebar-panel ds-sidebar flex shrink-0 flex-col border-r">
      <div className="ds-brand">
        <button
          type="button"
          className="ds-brand-button"
          onClick={() => {
            const latest = sortedNotes[0];
            if (latest) {
              selectNote(latest.id);
              return;
            }

            clearSelectedNote();
            setActiveSection('new');
          }}
        >
          <img className="ds-brand-mark" src="/app-logo-transparent.png" alt="" aria-hidden="true" />
          <span className="min-w-0">
            <span className="ds-brand-name block truncate">OtterNote</span>
            <span className="ds-brand-tagline block truncate">{t('sidebar.tagline')}</span>
          </span>
        </button>
      </div>

      <button
        type="button"
        className="ds-btn-new"
        onClick={() => {
          clearSelectedNote();
          setActiveSection('new');
        }}
      >
        <span aria-hidden="true">＋</span>
        {t('sidebar.newNote')}
        {newShortcutLabel ? <span className="ds-faint text-[11px]">{newShortcutLabel}</span> : null}
      </button>

      <label className="ds-search">
        <span className="shrink-0 flex items-center" aria-hidden="true">
          <Icon name="search" size={14} />
        </span>
        <input
          data-search-input="true"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            setSearchFocused(true);
            setActiveSection('notes');
          }}
          onBlur={() => setSearchFocused(false)}
          placeholder={t('sidebar.searchPlaceholder')}
        />
      </label>

      <nav className="ds-nav">
        {navItems.map((item) => {
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`ds-nav-item ${active ? 'is-active' : ''}`}
              onClick={() => {
                setActiveSection(item.id);
                if (item.id === 'notes') {
                  clearSelectedNote();
                }
              }}
            >
              <span className="ds-nav-icon" aria-hidden="true">
                <Icon name={item.icon} size={16} />
              </span>
              <span className="truncate">{t(item.labelKey)}</span>
              {item.id === 'plan' && todayBadge > 0 ? (
                <span className="ds-nav-badge">{todayBadge}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="ds-sidebar-foot">
        <div className="ds-capture-hint">
          <kbd>{newShortcutLabel}</kbd> {t('sidebar.captureNote')} · <kbd>{captureShortcutLabel}</kbd>{' '}
          {t('sidebar.captureTodo')}
        </div>
        <button
          type="button"
          className="ds-ghost-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <span aria-hidden="true">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </span>
          {t('settings.appearance')}
        </button>
        {auxiliaryNavItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ds-ghost-btn ${activeSection === item.id ? 'is-active' : ''}`}
            onClick={() => setActiveSection(item.id)}
          >
            <span aria-hidden="true">
              <Icon name={item.icon} size={15} />
            </span>
            {t(item.labelKey)}
          </button>
        ))}
      </div>
    </aside>
  );
}

function NewEntryPage() {
  const { t } = useI18n();
  const createNote = useAppStore((state) => state.createNote);
  const clearSelectedNote = useAppStore((state) => state.clearSelectedNote);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const [titleDraft, setTitleDraft] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [status, setStatus] = React.useState('');
  const editorViewRef = React.useRef<EditorView | null>(null);
  const hasDraftContent = Boolean(titleDraft.trim() || draft.trim());
  const updateTitleFromContent = React.useCallback((content: string) => {
    setTitleDraft(titleFromFirstLine(content));
  }, []);
  const updateDraft = React.useCallback(
    (value: React.SetStateAction<string>) => {
      setDraft((current) => {
        const next = typeof value === 'function' ? value(current) : value;
        updateTitleFromContent(next);
        return next;
      });
    },
    [updateTitleFromContent],
  );

  const insertImage = React.useCallback(async () => {
    try {
      const image = await chooseMarkdownImage();
      if (!image) return;

      insertMarkdownAtCursor(editorViewRef.current, `![${image.altText}](${image.markdownUrl})`, updateDraft);
      setStatus(t('editor.imageInserted', { name: image.altText }));
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, [t, updateDraft]);

  const pinNewNote = React.useCallback(async () => {
    if (!isTauriRuntime()) {
      window.alert(t('editor.desktopOnly'));
      return;
    }

    try {
      await pinNewNoteWindow();
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, [t]);

  const saveDraft = React.useCallback(() => {
    // CodeMirror commits its value through onChange asynchronously, so the
    // draft state can lag one frame behind the view. Read the live document
    // from the editor when it is available to avoid dropping the last keystrokes.
    const content = (editorViewRef.current?.state.doc.toString() ?? draft).trim();
    const title = titleDraft.trim();
    if (!content && !title) {
      return;
    }

    createNote(title, content);
    setTitleDraft('');
    setDraft('');
    setStatus(t('editor.saved'));
  }, [createNote, draft, t, titleDraft]);

  const cancelDraft = React.useCallback(() => {
    if (hasDraftContent && !window.confirm(t('editor.discardDraft'))) {
      return;
    }
    setTitleDraft('');
    setDraft('');
    setStatus('');
    clearSelectedNote();
    setActiveSection('notes');
  }, [clearSelectedNote, hasDraftContent, setActiveSection, t]);

  React.useEffect(() => {
    const onSave = () => saveDraft();
    const onCancel = () => cancelDraft();
    window.addEventListener('otter:save', onSave);
    window.addEventListener('otter:cancel', onCancel);
    return () => {
      window.removeEventListener('otter:save', onSave);
      window.removeEventListener('otter:cancel', onCancel);
    };
  }, [cancelDraft, saveDraft]);

  React.useEffect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => setStatus(''), 1800);
    return () => window.clearTimeout(timeout);
  }, [status]);

  return (
    <div className="app-workspace relative flex min-h-0 flex-1 flex-col">
      <DocumentHeader
        subtitle={t('editor.newSubtitle')}
        titleInput={
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                editorViewRef.current?.focus();
              }
            }}
            placeholder={t('editor.newTitle')}
            className="document-title-input"
          />
        }
        toolbar={
          <WorkspaceToolbar
            mode="edit"
            showEditButton={false}
            onPin={pinNewNote}
            onInsertImage={insertImage}
            onSave={saveDraft}
            onCancel={cancelDraft}
            saveDisabled={!hasDraftContent}
            isDirty={hasDraftContent}
            onDelete={undefined}
            saveLabel={t('editor.save')}
          />
        }
      />
      <StatusToast message={status} />
      <div className="flex min-h-0 flex-1 px-6 pb-16 pt-5">
        <div className="editor-workspace flex min-h-0 flex-1 w-full">
          <div className="editor-shell">
            <CodeMirror
              value={draft}
              height="100%"
              extensions={[
                markdown(),
                EditorView.lineWrapping,
                imagePasteExtension((file, view) => insertImageFile(file, updateDraft, view)),
              ]}
              basicSetup={{ lineNumbers: false, foldGutter: false }}
              onChange={updateDraft}
              onCreateEditor={(view) => {
                editorViewRef.current = view;
                view.focus();
              }}
              placeholder={t('editor.placeholder')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function NotesWorkspace() {
  const selectedNoteId = useAppStore((state) => state.selectedNoteId);
  const selectedNote = useAppStore((state) => state.notes.find((note) => note.id === selectedNoteId));

  return selectedNote ? <NoteDetail noteId={selectedNote.id} /> : <NotesListPage />;
}

const notesGroupLabel = {
  today: 'notes.group.today',
  yesterday: 'notes.group.yesterday',
  week: 'notes.group.week',
  earlier: 'notes.group.earlier',
} as const;

function NotesListPage() {
  const { t } = useI18n();
  const notes = useAppStore((state) => state.notes);
  const todos = useAppStore((state) => state.todos);
  const selectNote = useAppStore((state) => state.selectNote);
  const clearSelectedNote = useAppStore((state) => state.clearSelectedNote);
  const setActiveSection = useAppStore((state) => state.setActiveSection);
  const [activeTag, setActiveTag] = React.useState<string | null>(null);
  const sortedNotes = React.useMemo(
    () => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes],
  );
  const allTags = React.useMemo(() => collectTags(notes.map((note) => note.content)), [notes]);
  const tagsByNoteId = React.useMemo(() => {
    const next = new Map<string, string[]>();
    for (const note of sortedNotes) {
      next.set(
        note.id,
        collectTags([note.content]).map((item) => item.tag),
      );
    }
    return next;
  }, [sortedNotes]);
  const previewByNoteId = React.useMemo(() => {
    const next = new Map<string, string>();
    for (const note of sortedNotes) {
      next.set(note.id, compactPreviewText(note.content));
    }
    return next;
  }, [sortedNotes]);
  const openTodoByNoteId = React.useMemo(() => {
    const next = new Map<string, number>();
    for (const todo of todos) {
      if (todo.noteId && todo.status !== 'done') {
        next.set(todo.noteId, (next.get(todo.noteId) ?? 0) + 1);
      }
    }
    return next;
  }, [todos]);
  const visibleNotes = React.useMemo(
    () =>
      activeTag ? sortedNotes.filter((note) => tagsByNoteId.get(note.id)?.includes(activeTag)) : sortedNotes,
    [activeTag, sortedNotes, tagsByNoteId],
  );
  const noteGroups = React.useMemo(() => {
    const today = todayKey();
    const yesterday = addDays(today, -1);
    const weekAgo = addDays(today, -6);
    const groups = new Map<keyof typeof notesGroupLabel, Note[]>();
    for (const note of visibleNotes) {
      const day = note.updatedAt.slice(0, 10);
      const key: keyof typeof notesGroupLabel =
        day >= today ? 'today' : day >= yesterday ? 'yesterday' : day >= weekAgo ? 'week' : 'earlier';
      const items = groups.get(key);
      if (items) {
        items.push(note);
      } else {
        groups.set(key, [note]);
      }
    }
    return (Object.keys(notesGroupLabel) as Array<keyof typeof notesGroupLabel>)
      .map((key) => ({ key, notes: groups.get(key) ?? [] }))
      .filter((group) => group.notes.length > 0);
  }, [visibleNotes]);
  const recentCreatedCount = React.useMemo(() => {
    const cutoff = addDays(todayKey(), -6);
    return notes.filter((note) => note.createdAt.slice(0, 10) >= cutoff).length;
  }, [notes]);

  return (
    <Page title={t('nav.notes')} subtitle={t('notes.subtitle')}>
      <div className="ds-stats">
        <div className="ds-stat">
          <div className="n">{sortedNotes.length}</div>
          <div className="l">{t('notes.stat.total')}</div>
        </div>
        <div className="ds-stat">
          <div className="n">{recentCreatedCount}</div>
          <div className="l">{t('notes.stat.recent')}</div>
        </div>
        <div className="ds-stat">
          <div className="n">
            {todos.filter((todo) => todo.status !== 'done').length}
            <small>/{todos.length}</small>
          </div>
          <div className="l">{t('notes.stat.todos')}</div>
        </div>
        <div className="ds-stat">
          <div className="n">{allTags.length}</div>
          <div className="l">{t('notes.stat.tags')}</div>
        </div>
      </div>

      <div className="ds-chips">
        <button
          type="button"
          className={`ds-chip ${activeTag === null ? 'is-active' : ''}`}
          onClick={() => setActiveTag(null)}
        >
          {t('notes.all')}
        </button>
        {allTags.map((item) => (
          <button
            key={item.tag}
            type="button"
            className={`ds-chip ${activeTag === item.tag ? 'is-active' : ''}`}
            onClick={() => setActiveTag(item.tag)}
          >
            #{item.tag}
          </button>
        ))}
      </div>

      {visibleNotes.length === 0 ? (
        <EmptyMessage
          title={t('notes.empty')}
          message={activeTag ? t('notes.emptyTag') : t('notes.emptyHint')}
          icon={<Icon name="note" size={20} />}
          actionLabel={t('notes.newNote')}
          onAction={() => {
            clearSelectedNote();
            setActiveSection('new');
          }}
        />
      ) : (
        <div className="ds-note-groups">
          {noteGroups.map((group) => (
            <section key={group.key} className="ds-note-group">
              <div className="ds-note-group-head">
                <span className="g">{t(notesGroupLabel[group.key])}</span>
                <span className="line" />
                <span className="c">{group.notes.length}</span>
              </div>
              <div className="ds-note-list ds-note-grid">
                {group.notes.map((note) => {
                  const preview = previewByNoteId.get(note.id) ?? '';
                  const noteTags = tagsByNoteId.get(note.id) ?? [];
                  const openTodos = openTodoByNoteId.get(note.id) ?? 0;
                  return (
                    <button
                      key={note.id}
                      type="button"
                      className="ds-note-card"
                      onClick={() => selectNote(note.id)}
                    >
                      <span className="ds-note-card-main">
                        <span className="ds-note-card-title">{displayTitle(note.title)}</span>
                        {preview ? <span className="ds-note-card-preview">{preview}</span> : null}
                        <span className="ds-note-card-meta">
                          <span className="ds-note-card-date">
                            {formatDate(note.updatedAt).replace(' ', ' · ')}
                          </span>
                          {openTodos > 0 ? (
                            <span className="ds-note-card-todos" title={t('notes.stat.todos')}>
                              {openTodos} ☑
                            </span>
                          ) : null}
                        </span>
                        {noteTags.length > 0 ? (
                          <span className="ds-note-card-tags">
                            {noteTags.map((tag) => (
                              <span key={tag} className="ds-tag">
                                #{tag}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <span className="ds-note-card-arrow" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

function NoteDetail({ noteId }: { noteId: string }) {
  const { t } = useI18n();
  const note = useAppStore((state) => state.notes.find((item) => item.id === noteId));
  const updateNoteTitle = useAppStore((state) => state.updateNoteTitle);
  const updateNoteContent = useAppStore((state) => state.updateNoteContent);
  const deleteNote = useAppStore((state) => state.deleteNote);
  const [bundle, setBundle] = React.useState<NoteBundleData | null>(null);
  const [titleDraft, setTitleDraft] = React.useState(note?.title ?? '');
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftContent, setDraftContent] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [showDeleteConfirmation, setShowDeleteConfirmation] = React.useState(false);
  const editorViewRef = React.useRef<EditorView | null>(null);
  // Snapshot of the saved body when editing began; compared against the live
  // draft to decide whether there are unsaved changes.
  const [editingBaseline, setEditingBaseline] = React.useState<string | null>(null);
  // While editing, the draft is authoritative: a checkbox toggled in preview
  // would otherwise rewrite the saved body and clobber unsaved edits.
  const content = isEditing ? draftContent : (bundle?.note.content ?? note?.content ?? '');
  const hasUnsavedChanges = isEditing && draftContent !== (editingBaseline ?? content);
  const canSaveDraft = isEditing && hasUnsavedChanges;

  // In-note find (preview mode only): highlight matches, jump with Cmd+F.
  const [findOpen, setFindOpen] = React.useState(false);
  const [findQuery, setFindQuery] = React.useState('');
  const [findIndex, setFindIndex] = React.useState(0);
  const [findCount, setFindCount] = React.useState(0);
  const findInputRef = React.useRef<HTMLInputElement>(null);

  const openFind = React.useCallback(() => {
    setFindOpen(true);
    window.setTimeout(() => findInputRef.current?.focus(), 0);
  }, []);

  React.useEffect(() => {
    setFindQuery('');
    setFindIndex(0);
    setFindCount(0);
    setFindOpen(false);
  }, [noteId, isEditing]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey)) {
        if (isEditing) {
          return;
        }
        event.preventDefault();
        openFind();
        return;
      }
      if (!findOpen) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setFindOpen(false);
        setFindQuery('');
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (findCount === 0) {
          return;
        }
        if (event.shiftKey) {
          setFindIndex((current) => (current - 1 + findCount) % findCount);
        } else {
          setFindIndex((current) => (current + 1) % findCount);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [findCount, findOpen, isEditing, openFind]);

  React.useEffect(() => {
    if (findCount === 0) {
      setFindIndex(0);
      return;
    }
    setFindIndex((current) => Math.min(current, findCount - 1));
  }, [findCount]);

  const normalizedFindQuery = findOpen ? findQuery.trim() : '';

  React.useEffect(() => {
    setTitleDraft(note?.title ?? '');
  }, [noteId]);

  const saveTitleDraft = React.useCallback(() => {
    if (!note || titleDraft === note.title) return;
    updateNoteTitle(note.id, titleDraft);
  }, [note, titleDraft, updateNoteTitle]);

  React.useEffect(() => {
    if (!note || titleDraft === note.title) return;
    const timeout = window.setTimeout(saveTitleDraft, NOTE_TITLE_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [note, saveTitleDraft, titleDraft]);

  React.useEffect(() => {
    let cancelled = false;
    setBundle(null);
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

  React.useEffect(() => {
    editorViewRef.current = null;
    setStatus('');
    setBundle(null);
    if (!isEditing) {
      return;
    }

    setDraftContent(useAppStore.getState().notes.find((item) => item.id === noteId)?.content ?? '');
  }, [noteId]);

  const deleteCurrentNote = React.useCallback(() => {
    if (!note) return;
    setShowDeleteConfirmation(true);
  }, [note]);

  const confirmNoteDeletion = React.useCallback(() => {
    if (!note) return;
    deleteNote(note.id);
    setShowDeleteConfirmation(false);
    // Tell sibling windows to drop the deleted note from their in-memory
    // copies immediately, before any of them flushes a stale snapshot.
    void notifyAppStateChanged();
  }, [deleteNote, note]);

  const exportCurrentNote = React.useCallback(async () => {
    if (!note) return;

    const markdown = buildNoteMarkdown(note.title, isEditing ? draftContent : content);
    const fileName = buildExportFileName(note.title);

    if (isTauriRuntime()) {
      const selected = await saveDialog({
        title: t('editor.exportDialog'),
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
  }, [content, draftContent, isEditing, note, t]);

  const pinCurrentNote = React.useCallback(async () => {
    if (!note) return;

    if (!isTauriRuntime()) {
      window.alert(t('editor.desktopOnly'));
      return;
    }

    try {
      await pinNoteWindow(note.id, displayTitle(note.title));
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, [note, t]);

  const startEditing = React.useCallback(() => {
    if (!note) return;
    setEditingBaseline(content);
    setDraftContent(content);
    setIsEditing(true);
  }, [content, note]);

  const finishEditing = React.useCallback(() => {
    setEditingBaseline(null);
    setDraftContent('');
    setIsEditing(false);
  }, []);

  const cancelEditing = React.useCallback(() => {
    if (hasUnsavedChanges && !window.confirm(t('editor.discardChanges'))) {
      return;
    }
    finishEditing();
  }, [finishEditing, hasUnsavedChanges, t]);

  const saveDraft = React.useCallback(() => {
    if (!note) return;
    // Read the live document: CodeMirror's onChange can lag one frame behind,
    // which would otherwise drop the final keystrokes on save.
    const draftValue = editorViewRef.current?.state.doc.toString() ?? draftContent;
    if (draftValue === (editingBaseline ?? content)) {
      finishEditing();
      return;
    }
    updateNoteContent(note.id, draftValue);
    setStatus(t('editor.saved'));
    finishEditing();
  }, [content, draftContent, editingBaseline, finishEditing, note, t, updateNoteContent]);

  const togglePreviewTodo = React.useCallback(
    (occurrenceIndex: number, done: boolean) => {
      if (!note) return;
      const nextContent = updateTodoStatusInContent(content, occurrenceIndex, done ? 'done' : 'todo');
      updateNoteContent(note.id, nextContent);
    },
    [content, note, updateNoteContent],
  );

  const insertImage = React.useCallback(async () => {
    try {
      const image = await chooseMarkdownImage();
      if (!image) return;

      insertMarkdownAtCursor(
        editorViewRef.current,
        `![${image.altText}](${image.markdownUrl})`,
        setDraftContent,
      );
      setStatus(t('editor.imageInserted', { name: image.altText }));
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, [t]);

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

  React.useEffect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => setStatus(''), 1800);
    return () => window.clearTimeout(timeout);
  }, [status]);

  if (!note) return null;

  return (
    <div className="app-workspace relative flex min-h-0 flex-1 flex-col">
      <DocumentHeader
        meta={<NoteTags noteId={noteId} />}
        subtitle={t('notes.updatedAt', { date: formatDate(note.updatedAt) })}
        titleInput={
          <div className="flex items-center gap-3">
            <input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={saveTitleDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveTitleDraft();
                  if (!isEditing) {
                    startEditing();
                    window.setTimeout(() => editorViewRef.current?.focus(), 0);
                    return;
                  }
                  editorViewRef.current?.focus();
                }
              }}
              placeholder={t('editor.newTitle')}
              className="document-title-input"
            />
          </div>
        }
        toolbar={
          <WorkspaceToolbar
            mode={isEditing ? 'edit' : 'preview'}
            showEditButton={true}
            onFind={openFind}
            onExport={exportCurrentNote}
            onPin={pinCurrentNote}
            onInsertImage={isEditing ? insertImage : undefined}
            onSave={saveDraft}
            onEdit={startEditing}
            onCancel={isEditing ? cancelEditing : undefined}
            saveDisabled={isEditing ? !canSaveDraft : false}
            isDirty={hasUnsavedChanges}
            onDelete={deleteCurrentNote}
            saveLabel={t('editor.save')}
          />
        }
      />
      <StatusToast message={status} />
      {!isEditing && findOpen ? (
        <div className="find-bar" role="search" aria-label={t('find.searchInNote')}>
          <span className="find-bar-icon" aria-hidden="true">
            <Icon name="search" size={13} />
          </span>
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(event) => {
              setFindQuery(event.target.value);
              setFindIndex(0);
            }}
            placeholder={t('find.placeholder')}
            aria-label={t('find.searchInNote')}
            className="find-bar-input"
          />
          <span className="find-bar-count" aria-live="polite">
            {findCount > 0 ? t('find.count', { n: findIndex + 1, m: findCount }) : `0 / 0`}
          </span>
          <button
            type="button"
            className="find-bar-btn"
            onClick={() =>
              setFindIndex((current) => (findCount > 0 ? (current - 1 + findCount) % findCount : current))
            }
            disabled={findCount === 0}
            aria-label={t('find.prev')}
            title={t('find.prev')}
          >
            ↑
          </button>
          <button
            type="button"
            className="find-bar-btn"
            onClick={() => setFindIndex((current) => (findCount > 0 ? (current + 1) % findCount : current))}
            disabled={findCount === 0}
            aria-label={t('find.next')}
            title={t('find.next')}
          >
            ↓
          </button>
          <button
            type="button"
            className="find-bar-btn find-bar-close"
            onClick={() => {
              setFindOpen(false);
              setFindQuery('');
            }}
            aria-label={t('find.close')}
            title={t('find.close')}
          >
            ✕
          </button>
        </div>
      ) : null}
      <div className={`min-h-0 flex-1 px-7 pb-16 pt-5 ${isEditing ? 'flex' : 'overflow-y-auto'}`}>
        <div className={`w-full ${isEditing ? 'editor-workspace flex min-h-0 flex-1' : 'space-y-3.5'}`}>
          {isEditing ? (
            <div className="editor-shell">
              <CodeMirror
                key={noteId}
                value={draftContent}
                height="100%"
                extensions={[
                  markdown(),
                  EditorView.lineWrapping,
                  imagePasteExtension((file, view) => insertImageFile(file, setDraftContent, view)),
                ]}
                basicSetup={{ lineNumbers: false, foldGutter: false }}
                onChange={setDraftContent}
                onCreateEditor={(view) => {
                  editorViewRef.current = view;
                }}
                placeholder={t('editor.addContent')}
              />
            </div>
          ) : (
            <div className="ds-view">
              <article className="entry-card">
                <NoteBodyPreview
                  content={content}
                  emptyMessage={t('editor.emptyNote')}
                  onTodoToggle={(occurrence, done) => togglePreviewTodo(occurrence, done)}
                  findQuery={normalizedFindQuery}
                  activeIndex={findCount > 0 ? findIndex : undefined}
                  onMatchCount={setFindCount}
                />
              </article>
              <NoteInsights noteId={noteId} />
            </div>
          )}
        </div>
      </div>
      {showDeleteConfirmation ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6"
          role="presentation"
        >
          <div
            className="ds-card w-full max-w-sm p-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-note-title"
          >
            <h2 id="delete-note-title" className="ds-text text-base font-semibold">
              {t('editor.deleteTitle')}
            </h2>
            <p className="ds-muted mt-2 text-sm">{t('editor.deleteHint')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowDeleteConfirmation(false)}
              >
                {t('common.cancel')}
              </button>
              <button type="button" className="danger-button" onClick={confirmNoteDeletion}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PinnedNewNoteWindow() {
  const createNote = useAppStore((state) => state.createNote);
  const updateNoteTitle = useAppStore((state) => state.updateNoteTitle);
  const updateNoteContent = useAppStore((state) => state.updateNoteContent);
  const storeHydrated = useStoreHydrated();
  const [titleDraft, setTitleDraft] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [savedNoteId, setSavedNoteId] = React.useState<string | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  // Save status messages are currently not surfaced in this view, but the
  // setter is kept because the save flow still records status transitions.
  const [, setStatus] = React.useState('Ready');
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

  const saveDraftContent = React.useCallback(
    async (
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
        createNote(title, nextDraft);
        const state = useAppStore.getState();
        setSavedNoteId(state.selectedNoteId ?? state.notes[0]?.id ?? null);
      } else {
        updateNoteTitle(savedNoteId, title || 'Untitled Note');
        updateNoteContent(savedNoteId, nextDraft);
      }

      lastSavedRef.current = { title, content: nextDraft };
      setStatus(mode === 'auto' ? 'Saved automatically' : 'Saved');
      if (mode === 'auto') {
        setShowSavedToast(true);
      }
      await notifyAppStateChanged();
    },
    [createNote, savedNoteId, updateNoteContent, updateNoteTitle],
  );

  const saveDraft = React.useCallback(
    (mode: 'auto' | 'manual' = 'manual') => {
      // Read the live document so a manual save does not drop the final keystrokes.
      const nextDraft = editorViewRef.current?.state.doc.toString() ?? draft;
      return saveDraftContent(nextDraft, titleFromFirstLine(nextDraft), mode);
    },
    [draft, saveDraftContent, titleDraft],
  );

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

  const togglePreviewTodo = React.useCallback(
    (occurrenceIndex: number, done: boolean) => {
      const nextDraft = updateTodoStatusInContent(draft, occurrenceIndex, done ? 'done' : 'todo');
      updateDraft(nextDraft);
      void saveDraftContent(nextDraft, titleFromFirstLine(nextDraft), 'auto');
    },
    [draft, saveDraftContent, updateDraft],
  );

  const insertPinnedImage = React.useCallback(
    async (payload: ClipboardImagePayload, view: EditorView | null) => {
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
    },
    [draft, saveDraftContent, updateDraft],
  );

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent) => {
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
    },
    [insertPinnedImage],
  );

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
      const applyNote = (nextTitle: string, nextContent: string) => {
        setTitleDraft(nextTitle);
        setDraft(nextContent);
        lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
      };

      try {
        const raw = await readNoteBundle(savedNoteId);
        if (raw) {
          const nextBundle = JSON.parse(raw) as NoteBundleData;
          applyNote(displayTitle(nextBundle.note.title), nextBundle.note.content ?? '');
        }
      } catch {
        const nextNote = useAppStore.getState().notes.find((item) => item.id === savedNoteId);
        if (nextNote) {
          applyNote(displayTitle(nextNote.title), nextNote.content);
        }
      }
    }

    setIsEditing(true);
  }, [savedNoteId]);

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
              extensions={[
                markdown(),
                EditorView.lineWrapping,
                imagePasteExtension((file, view) => insertPinnedImage({ type: 'file', file }, view)),
              ]}
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
          <NoteBodyPreview
            content={draft}
            emptyMessage="双击开始记录"
            onDoubleClick={() => void startEditing()}
            onTodoToggle={togglePreviewTodo}
          />
        )}
      </main>
      <PinnedSaveToast visible={showSavedToast} />
    </div>
  );
}

function PinnedNoteWindow({ noteId }: { noteId: string }) {
  const note = useAppStore((state) => state.notes.find((item) => item.id === noteId));
  const updateNoteTitle = useAppStore((state) => state.updateNoteTitle);
  const updateNoteContent = useAppStore((state) => state.updateNoteContent);
  const storeHydrated = useStoreHydrated();
  const [bundle, setBundle] = React.useState<NoteBundleData | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState('');
  const [draftContent, setDraftContent] = React.useState('');
  // Save status messages are currently not surfaced in this view, but the
  // setter is kept because the save flow still records status transitions.
  const [, setStatus] = React.useState('Ready');
  const [showSavedToast, setShowSavedToast] = React.useState(false);
  const editorViewRef = React.useRef<EditorView | null>(null);
  const isInsertingImageRef = React.useRef(false);
  const initializedRef = React.useRef(false);
  const lastSavedRef = React.useRef({ title: '', content: '' });
  const draftContentRef = React.useRef('');
  const isEditingRef = React.useRef(false);
  const title = bundle?.note.title ?? note?.title ?? 'Pinned Note';

  React.useEffect(() => {
    draftContentRef.current = draftContent;
    isEditingRef.current = isEditing;
  }, [draftContent, isEditing]);

  React.useEffect(() => {
    document.body.classList.add('pinned-note-body');
    return () => {
      document.body.classList.remove('pinned-note-body');
    };
  }, []);

  const applyNoteContent = React.useCallback((rawTitle: string, rawContent: string) => {
    const nextTitle = displayTitle(rawTitle);
    setBundle(null);
    setDraftTitle(nextTitle);
    setDraftContent(rawContent);
    lastSavedRef.current = { title: nextTitle.trim(), content: rawContent };
    initializedRef.current = true;
    setLoadFailed(false);
  }, []);

  const refreshLatestNote = React.useCallback(async () => {
    // Never rewind an in-progress draft: focus events fire while the user is
    // editing or before the debounced write has landed, and clobbering
    // `lastSavedRef` here would make the dedupe guard swallow every later save.
    if (isEditingRef.current || draftContentRef.current !== lastSavedRef.current.content) {
      return;
    }

    // The hydrated store is at least as fresh as disk (writes are debounced and
    // every writer goes through it), so prefer it when its note is newer.
    const stored = useAppStore.getState().notes.find((item) => item.id === noteId);

    try {
      const raw = await readNoteBundle(noteId);
      if (raw) {
        const nextBundle = JSON.parse(raw) as NoteBundleData;
        if (stored && stored.updatedAt > nextBundle.note.updatedAt) {
          applyNoteContent(stored.title, stored.content ?? '');
          return;
        }
        const nextTitle = displayTitle(nextBundle.note.title);
        const nextContent = nextBundle.note.content ?? '';
        setBundle(nextBundle);
        setDraftTitle(nextTitle);
        setDraftContent(nextContent);
        lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
        initializedRef.current = true;
        setLoadFailed(false);
        return;
      }
    } catch {
      // Fall back to the hydrated store state below.
    }

    if (stored) {
      applyNoteContent(stored.title, stored.content ?? '');
      return;
    }

    setLoadFailed(true);
  }, [applyNoteContent, noteId]);

  React.useEffect(() => {
    void refreshLatestNote();
    window.addEventListener('focus', refreshLatestNote);
    return () => window.removeEventListener('focus', refreshLatestNote);
  }, [refreshLatestNote]);

  React.useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    if (!note && !bundle && !loadFailed) {
      return;
    }

    const nextTitle = displayTitle(title);
    const nextContent = bundle?.note.content ?? note?.content ?? '';
    setDraftTitle(nextTitle);
    setDraftContent(nextContent);
    lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
    initializedRef.current = true;
  }, [bundle, loadFailed, note, title]);

  const saveDraftContent = React.useCallback(
    async (nextDraftContent: string, nextDraftTitle = draftTitle, mode: 'auto' | 'manual' = 'manual') => {
      await waitForStoreHydration();
      const nextTitle = nextDraftTitle.trim();
      if (!note && !bundle) {
        return;
      }

      if (lastSavedRef.current.title === nextTitle && lastSavedRef.current.content === nextDraftContent) {
        return;
      }

      setStatus('Saving...');
      updateNoteTitle(noteId, nextTitle || 'Untitled Note');
      updateNoteContent(noteId, nextDraftContent);
      setBundle(null);
      lastSavedRef.current = { title: nextTitle, content: nextDraftContent };
      setStatus(mode === 'auto' ? 'Saved automatically' : 'Saved');
      if (mode === 'auto') {
        setShowSavedToast(true);
      }
      await notifyAppStateChanged();
    },
    [bundle, draftTitle, note, noteId, updateNoteContent, updateNoteTitle],
  );

  const saveDraft = React.useCallback(
    (mode: 'auto' | 'manual' = 'manual') => {
      // Read the live document so a manual save does not drop the final keystrokes.
      const nextDraftContent = editorViewRef.current?.state.doc.toString() ?? draftContent;
      return saveDraftContent(nextDraftContent, draftTitle, mode);
    },
    [draftContent, draftTitle, saveDraftContent],
  );

  React.useEffect(() => {
    if (!storeHydrated || !initializedRef.current || (!note && !bundle)) {
      return;
    }

    const title = draftTitle.trim();
    const liveDraft = editorViewRef.current?.state.doc.toString() ?? draftContent;
    if (lastSavedRef.current.title === title && lastSavedRef.current.content === liveDraft) {
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

  const togglePreviewTodo = React.useCallback(
    (occurrenceIndex: number, done: boolean) => {
      const nextDraftContent = updateTodoStatusInContent(
        draftContent,
        occurrenceIndex,
        done ? 'done' : 'todo',
      );
      setDraftContent(nextDraftContent);
      void saveDraftContent(nextDraftContent, draftTitle, 'auto');
    },
    [draftContent, draftTitle, saveDraftContent],
  );

  const insertPinnedImage = React.useCallback(
    async (payload: ClipboardImagePayload, view: EditorView | null) => {
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
    },
    [draftContent, draftTitle, saveDraftContent],
  );

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent) => {
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
    },
    [insertPinnedImage],
  );

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
    const apply = (nextTitle: string, nextContent: string) => {
      setDraftTitle(nextTitle);
      setDraftContent(nextContent);
      lastSavedRef.current = { title: nextTitle.trim(), content: nextContent };
      setLoadFailed(false);
      setIsEditing(true);
    };

    try {
      const raw = await readNoteBundle(noteId);
      if (raw) {
        const nextBundle = JSON.parse(raw) as NoteBundleData;
        setBundle(nextBundle);
        apply(displayTitle(nextBundle.note.title), nextBundle.note.content ?? '');
        return;
      }
    } catch {
      // Fall back to hydrated store state below.
    }

    const nextNote = useAppStore.getState().notes.find((item) => item.id === noteId);
    if (!nextNote) {
      setLoadFailed(true);
      return;
    }

    setBundle(null);
    apply(displayTitle(nextNote.title), nextNote.content);
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
          <NoteBodyPreview
            content={draftContent}
            emptyMessage="双击编辑内容"
            onDoubleClick={() => void startEditing()}
            onTodoToggle={togglePreviewTodo}
          />
        ) : (
          <div className="pinned-editor-shell min-h-full">
            <CodeMirror
              value={draftContent}
              height="100%"
              extensions={[
                markdown(),
                EditorView.lineWrapping,
                imagePasteExtension((file, view) => insertPinnedImage({ type: 'file', file }, view)),
              ]}
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
  onFind,
  onExport,
  onPin,
  onInsertImage,
  onSave,
  onEdit,
  onCancel,
  onDelete,
  saveDisabled = false,
  isDirty = false,
  saveLabel,
}: {
  mode: 'preview' | 'edit';
  showEditButton?: boolean;
  onFind?: () => void;
  onExport?: () => void;
  onPin?: () => void;
  onInsertImage?: () => void;
  onSave: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  saveDisabled?: boolean;
  isDirty?: boolean;
  saveLabel: string;
}) {
  const shortcuts = useAppStore((state) => state.shortcuts);
  const { t } = useI18n();
  const shortcutConfig = {
    ...defaultShortcuts,
    ...shortcuts,
  };
  const tooltip = React.useCallback(
    (label: string, action?: ShortcutAction) => {
      const shortcut = action ? normalizeShortcutLabel(shortcutConfig[action] ?? '') : '';
      return shortcut ? `${label} · ${shortcut}` : label;
    },
    [shortcutConfig],
  );

  return (
    <div className="app-toolbar">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {onExport || onPin || (mode === 'edit' && onInsertImage) ? (
          <div className="toolbar-group">
            {onExport ? (
              <button
                type="button"
                className="icon-button tooltip-button"
                data-tooltip={t('editor.export')}
                onClick={onExport}
                aria-label={t('editor.export')}
              >
                <span className="icon-glyph" aria-hidden="true">
                  <Icon name="download" size={15} />
                </span>
              </button>
            ) : null}
            {onPin ? (
              <button
                type="button"
                className="icon-button tooltip-button"
                data-tooltip={t('editor.pin')}
                onClick={onPin}
                aria-label={t('editor.pin')}
              >
                <span className="icon-glyph" aria-hidden="true">
                  <Icon name="pin" size={15} />
                </span>
              </button>
            ) : null}
            {mode === 'edit' && onInsertImage ? (
              <button
                type="button"
                className="icon-button tooltip-button"
                data-tooltip={t('editor.image')}
                onClick={onInsertImage}
                aria-label={t('editor.image')}
              >
                <span className="icon-glyph" aria-hidden="true">
                  <Icon name="image" size={15} />
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
        {mode === 'edit' || showEditButton ? (
          <div className="toolbar-group">
            {onFind && mode === 'preview' ? (
              <button
                type="button"
                className="icon-button tooltip-button"
                data-tooltip={t('find.searchInNote')}
                onClick={onFind}
                aria-label={t('find.searchInNote')}
              >
                <span className="icon-glyph" aria-hidden="true">
                  <Icon name="search" size={15} />
                </span>
              </button>
            ) : null}
            {mode === 'edit' ? (
              <button
                type="button"
                className={`icon-button icon-button-primary tooltip-button ${isDirty ? 'icon-button-dirty' : ''}`}
                data-tooltip={tooltip(saveLabel, 'save')}
                onClick={onSave}
                aria-label={saveLabel}
                disabled={saveDisabled}
              >
                <span className="icon-glyph" aria-hidden="true">
                  <Icon name="check" size={15} />
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="icon-button icon-button-primary tooltip-button"
                data-tooltip={tooltip(t('editor.edit'), 'edit')}
                onClick={onEdit}
                aria-label={t('editor.edit')}
              >
                <span className="icon-glyph" aria-hidden="true">
                  <Icon name="edit" size={15} />
                </span>
              </button>
            )}
            {mode === 'edit' && onCancel ? (
              <button
                type="button"
                className="icon-button tooltip-button"
                data-tooltip={tooltip(t('editor.cancel'), 'cancel')}
                onClick={onCancel}
                aria-label={t('editor.cancel')}
              >
                <span className="icon-glyph" aria-hidden="true">
                  ×
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
        {onDelete ? (
          <div className="toolbar-group toolbar-group-danger">
            <button
              type="button"
              className="icon-button icon-button-danger tooltip-button tooltip-align-end"
              data-tooltip={tooltip(t('editor.delete'), 'delete')}
              onClick={onDelete}
              aria-label={t('editor.delete')}
            >
              <span className="icon-glyph" aria-hidden="true">
                <Icon name="trash" size={15} />
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DocumentHeader({
  titleInput,
  subtitle,
  meta,
  toolbar,
}: {
  titleInput: React.ReactNode;
  subtitle?: string;
  meta?: React.ReactNode;
  toolbar: React.ReactNode;
}) {
  return (
    <header className="document-header shrink-0 border-b px-7 py-4">
      <div className="ds-view ds-view-head">
        <div className="min-w-0 flex-1">
          {titleInput}
          {meta || subtitle ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {meta}
              {subtitle ? <span className="ds-pill">{subtitle}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="document-header-toolbar pt-0.5">{toolbar}</div>
      </div>
    </header>
  );
}

function StatusToast({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div className="workspace-toast" role="status" aria-live="polite">
      {message}
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
const storageChangedEvent = 'otter:storage-changed';

function useAppStateChangeSync() {
  React.useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    const cleanups: Array<() => void> = [];

    void listen(appStateChangedEvent, () => {
      if (!disposed) {
        void useAppStore.persist.rehydrate?.();
      }
    }).then((unlisten) => {
      if (disposed) {
        void unlisten();
        return;
      }

      cleanups.push(unlisten);
    });

    // The storage root moved (this or another window switched folders): drop
    // any queued snapshot of the old root, then pull the new one in.
    void listen(storageChangedEvent, () => {
      if (disposed) {
        return;
      }

      invalidatePersistedAppState();
      void useAppStore.persist.rehydrate?.();
    }).then((unlisten) => {
      if (disposed) {
        void unlisten();
        return;
      }

      cleanups.push(unlisten);
    });

    return () => {
      disposed = true;
      for (const cleanup of cleanups) {
        cleanup();
      }
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

function useOpenLatestNoteOnStartup(setActiveSection: (section: NavSection) => void) {
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
    setActiveSection('plan');
  }, [hydrated, setActiveSection]);
}

type MarkdownImage = {
  altText: string;
  markdownUrl: string;
};

type ClipboardImagePayload = { type: 'file'; file: File } | { type: 'path'; path: string };

type NoteBundleData = {
  schemaVersion?: number;
  note: {
    id: string;
    title: string;
    content?: string;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string;
  };
  todos: Array<{
    id: string;
    noteId?: string;
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

function insertMarkdownAtCursor(
  view: EditorView | null,
  text: string,
  fallbackUpdate: React.Dispatch<React.SetStateAction<string>>,
) {
  if (!view || !view.dom.isConnected) {
    fallbackUpdate(
      (current) => `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${text}`,
    );
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

function extractClipboardImagePath(data: DataTransfer) {
  const candidates = [...data.getData('text/uri-list').split(/\r?\n/), data.getData('text/plain')];

  for (const candidate of candidates) {
    const path = normalizeClipboardImagePath(candidate);
    if (path && isImageFileName(path)) {
      return path;
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

  const mime =
    file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
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

function ImagesPage() {
  const { t } = useI18n();
  const notes = useAppStore((state) => state.notes);
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
    for (const text of notes.map((note) => note.content)) {
      for (const fileName of extractAttachmentReferences(text)) {
        counts.set(fileName, (counts.get(fileName) ?? 0) + 1);
      }
    }
    return counts;
  }, [notes]);

  const copyReference = React.useCallback(async (fileName: string) => {
    try {
      await navigator.clipboard.writeText(
        `![${fileName.replace(/\.[^.]+$/, '') || 'image'}](attachment://${fileName})`,
      );
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, []);

  const removeAttachment = React.useCallback(
    async (fileName: string) => {
      const count = attachmentUsage.get(fileName) ?? 0;
      const confirmMessage =
        count > 0
          ? t('images.deleteConfirmUsed', { name: fileName, n: count })
          : t('images.deleteConfirm', { name: fileName });
      if (!(await confirmDeletion(confirmMessage))) {
        return;
      }

      try {
        await deleteImageAttachment(fileName);
        window.dispatchEvent(new CustomEvent('otter:attachments-changed'));
      } catch (currentError) {
        window.alert(errorMessage(currentError));
      }
    },
    [attachmentUsage, t],
  );

  const closeViewer = React.useCallback(() => setViewerFileName(''), []);

  return (
    <Page title={t('nav.images')} subtitle={t('images.subtitle')}>
      {!isTauriRuntime() ? (
        <EmptyMessage
          title={t('images.browserTitle')}
          message={t('images.browserHint')}
          icon={<Icon name="image" size={20} />}
        />
      ) : loading ? (
        <EmptyMessage
          title={t('images.loadingTitle')}
          message={t('images.loadingHint')}
          icon={<Icon name="image" size={20} />}
        />
      ) : error ? (
        <div className="ds-card p-4 text-sm text-[color:var(--ds-danger)]">{error}</div>
      ) : attachments.length === 0 ? (
        <EmptyMessage
          title={t('images.emptyTitle')}
          message={t('images.emptyHint')}
          icon={<Icon name="image" size={20} />}
        />
      ) : (
        <div className="ds-card ds-note-list">
          {attachments.map((item) => {
            const usageCount = attachmentUsage.get(item.fileName) ?? 0;
            return (
              <div key={item.fileName} className="ds-att-row">
                <button
                  type="button"
                  className="h-11 w-11 flex-none overflow-hidden rounded-md"
                  onClick={() => setViewerFileName(item.originalFileName)}
                  title={t('images.view')}
                  aria-label={t('images.view')}
                >
                  <AttachmentPreviewImage
                    fileName={item.fileName}
                    alt={item.fileName}
                    className="h-full w-full object-cover"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="ds-note-row-title truncate" title={item.fileName}>
                    {item.fileName}
                  </div>
                  <div className="ds-note-row-preview mt-0.5 truncate">
                    {formatBytes(item.size)} · {formatAttachmentTime(item.modifiedAt)} ·{' '}
                    {usageCount > 0
                      ? usageCount === 1
                        ? t('images.referencesOne')
                        : t('images.references', { n: usageCount })
                      : t('images.notReferenced')}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-1">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void copyReference(item.fileName)}
                    title={t('images.copy')}
                    aria-label={t('images.copy')}
                  >
                    <span className="icon-glyph" aria-hidden="true">
                      <Icon name="copy" size={14} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-danger"
                    onClick={() => void removeAttachment(item.fileName)}
                    title={t('images.delete')}
                    aria-label={t('images.delete')}
                  >
                    <span className="icon-glyph" aria-hidden="true">
                      <Icon name="trash" size={14} />
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {viewerFileName ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6"
          onClick={closeViewer}
          role="presentation"
        >
          <div
            className="ds-card flex max-h-[92vh] w-full max-w-6xl flex-col gap-3 p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="ds-text truncate text-sm font-medium">{viewerFileName}</div>
                <div className="ds-muted text-xs">{t('images.original')}</div>
              </div>
              <button type="button" className="secondary-button" onClick={closeViewer}>
                <span aria-hidden="true">×</span>
                {t('images.close')}
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md bg-[color:var(--ds-bg)] p-2">
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
  const { t } = useI18n();
  const selectNote = useAppStore((state) => state.selectNote);
  const setQuery = useAppStore((state) => state.setQuery);
  const storeNotes = useAppStore((state) => state.notes);
  const todos = useAppStore((state) => state.todos);
  const [results, setResults] = React.useState<
    Array<{ noteId: string; title: string; updatedAt: string; preview: string }>
  >([]);
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

    const timer = window.setTimeout(() => {
      void run();
    }, SEARCH_DEBOUNCE_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedQuery]);

  const tagsByNoteId = React.useMemo(() => {
    const next = new Map<string, string[]>();
    for (const note of storeNotes) {
      next.set(
        note.id,
        collectTags([note.content]).map((item) => item.tag),
      );
    }
    return next;
  }, [storeNotes]);
  const openTodoByNoteId = React.useMemo(() => {
    const next = new Map<string, number>();
    for (const todo of todos) {
      if (todo.noteId && todo.status !== 'done') {
        next.set(todo.noteId, (next.get(todo.noteId) ?? 0) + 1);
      }
    }
    return next;
  }, [todos]);
  const noteGroups = React.useMemo(() => {
    const today = todayKey();
    const yesterday = addDays(today, -1);
    const weekAgo = addDays(today, -6);
    const groups = new Map<keyof typeof notesGroupLabel, typeof results>();
    for (const item of results) {
      const day = item.updatedAt.slice(0, 10);
      const key: keyof typeof notesGroupLabel =
        day >= today ? 'today' : day >= yesterday ? 'yesterday' : day >= weekAgo ? 'week' : 'earlier';
      const items = groups.get(key);
      if (items) {
        items.push(item);
      } else {
        groups.set(key, [item]);
      }
    }
    return (Object.keys(notesGroupLabel) as Array<keyof typeof notesGroupLabel>)
      .map((key) => ({ key, items: groups.get(key) ?? [] }))
      .filter((group) => group.items.length > 0);
  }, [results]);

  return (
    <Page
      title={t('search.title')}
      subtitle={
        normalizedQuery
          ? t('search.resultsFor', { q: normalizedQuery, n: results.length })
          : t('search.subtitle')
      }
    >
      {!normalizedQuery ? (
        <EmptyMessage
          title={t('search.emptyTitle')}
          message={t('search.emptyHint')}
          icon={<Icon name="search" size={20} />}
        />
      ) : results.length === 0 ? (
        <EmptyMessage
          title={t('search.noResults')}
          message={t('search.noResultsHint')}
          icon={<Icon name="search" size={20} />}
        />
      ) : (
        <div className="ds-note-groups">
          {noteGroups.map((group) => (
            <section key={group.key} className="ds-note-group">
              <div className="ds-note-group-head">
                <span className="g">{t(notesGroupLabel[group.key])}</span>
                <span className="line" />
                <span className="c">{group.items.length}</span>
              </div>
              <div className="ds-note-list">
                {group.items.map((item) => {
                  const noteTags = tagsByNoteId.get(item.noteId) ?? [];
                  const openTodos = openTodoByNoteId.get(item.noteId) ?? 0;
                  return (
                    <button
                      key={item.noteId}
                      type="button"
                      className="ds-note-card"
                      onClick={() => {
                        setQuery('');
                        selectNote(item.noteId);
                      }}
                    >
                      <span className="ds-note-card-glyph" aria-hidden="true">
                        <Icon name="note" size={16} />
                      </span>
                      <span className="ds-note-card-main">
                        <span className="ds-note-card-title">
                          {highlightTextMatches(displayTitle(item.title), normalizedQuery)}
                        </span>
                        {item.preview ? (
                          <span className="ds-note-card-preview">
                            {highlightTextMatches(item.preview, normalizedQuery)}
                          </span>
                        ) : null}
                        <span className="ds-note-card-meta">
                          <span className="ds-note-card-date">
                            {formatDate(item.updatedAt).replace(' ', ' · ')}
                          </span>
                          {openTodos > 0 ? (
                            <span className="ds-note-card-todos" title={t('notes.stat.todos')}>
                              {openTodos} ☑
                            </span>
                          ) : null}
                        </span>
                        {noteTags.length > 0 ? (
                          <span className="ds-note-card-tags">
                            {noteTags.map((tag) => (
                              <span key={tag} className="ds-tag">
                                #{tag}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <span className="ds-note-card-arrow" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

function SettingsPage() {
  const shortcuts = useAppStore((state) => state.shortcuts);
  const updateShortcut = useAppStore((state) => state.updateShortcut);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const locale = useAppStore((state) => state.locale);
  const setLocale = useAppStore((state) => state.setLocale);
  const { t } = useI18n();

  return (
    <Page title={t('nav.settings')} subtitle={t('settings.subtitle')}>
      <div className="space-y-4">
        <StorageSettings />
        <BackupSettings />
        <div className="ds-card p-5">
          <div className="flex items-center gap-2 font-medium">
            <span aria-hidden="true" className="flex">
              <Icon name="globe" size={16} />
            </span>
            {t('settings.language')}
          </div>
          <p className="ds-muted mt-1 text-sm">{t('settings.languageHint')}</p>
          <div className="theme-choice-group mt-4" role="radiogroup" aria-label={t('settings.language')}>
            {locales.map((item) => {
              const active = locale === item;
              return (
                <label key={item} className={`theme-choice ${active ? 'theme-choice-active' : ''}`}>
                  <input
                    type="radio"
                    name="locale"
                    value={item}
                    checked={active}
                    onChange={() => setLocale(item as Locale)}
                    className="sr-only"
                  />
                  <span className="theme-choice-dot" aria-hidden="true" />
                  {localeLabels[item]}
                </label>
              );
            })}
          </div>
        </div>
        <div className="ds-card p-5">
          <div className="flex items-center gap-2 font-medium">
            <span aria-hidden="true">
              <Icon name="sun" size={16} />
            </span>
            {t('settings.theme')}
          </div>
          <p className="ds-muted mt-1 text-sm">{t('settings.themeHint')}</p>
          <div className="theme-choice-group mt-4" role="radiogroup" aria-label={t('settings.theme')}>
            {[
              { id: 'light', label: t('settings.light'), icon: 'sun' as const },
              { id: 'dark', label: t('settings.dark'), icon: 'moon' as const },
            ].map((item) => {
              const active = theme === item.id;
              return (
                <label key={item.id} className={`theme-choice ${active ? 'theme-choice-active' : ''}`}>
                  <input
                    type="radio"
                    name="theme"
                    value={item.id}
                    checked={active}
                    onChange={() => setTheme(item.id as 'light' | 'dark')}
                    className="sr-only"
                  />
                  <span aria-hidden="true" className="flex items-center">
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span className="theme-choice-dot" aria-hidden="true" />
                  {item.label}
                </label>
              );
            })}
          </div>
        </div>
        <div className="ds-card p-5">
          <div className="flex items-center gap-2 font-medium">
            <span aria-hidden="true" className="flex">
              <Icon name="keyboard" size={16} />
            </span>
            {t('settings.shortcuts')}
          </div>
          <div className="mt-4 space-y-3">
            {(['new', 'capture', 'save', 'edit', 'delete', 'cancel'] as ShortcutAction[]).map((action) => (
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
  const { t } = useI18n();
  const replaceAppState = useAppStore((state) => state.replaceAppState);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState('');

  const exportBackup = React.useCallback(async () => {
    setStatus('');
    setError('');
    const fileName = `otternote-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const snapshot = snapshotAppState(useAppStore.getState() as ReturnType<typeof useAppStore.getState>);
    const content = JSON.stringify(snapshot, null, 2);

    try {
      if (isTauriRuntime()) {
        const selected = await saveDialog({
          title: t('settings.exportDialog'),
          defaultPath: fileName,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });

        if (typeof selected !== 'string' || !selected.trim()) {
          return;
        }

        await writeExportFile(selected, content);
        setStatus(t('settings.backupExported'));
        return;
      }

      downloadTextFile(content, fileName, 'application/json');
      setStatus(t('settings.backupExported'));
    } catch (currentError) {
      setError(errorMessage(currentError));
    }
  }, [t]);

  const importBackup = React.useCallback(
    async (file: File | null) => {
      if (!file) return;
      setStatus('');
      setError('');
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as Partial<AppStateSnapshot>;
        const snapshot = normalizeImportedSnapshot(parsed);
        if (!window.confirm(t('settings.importConfirm'))) {
          return;
        }
        replaceAppState(snapshot);
        setStatus(t('settings.backupImported'));
      } catch (currentError) {
        setError(errorMessage(currentError));
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [replaceAppState, t],
  );

  return (
    <div className="ds-card p-5">
      <div className="flex items-center gap-2 font-medium">
        <span aria-hidden="true">
          <Icon name="download" size={15} />
        </span>
        <span className="hidden">{t('settings.backup')}</span>
      </div>
      <p className="ds-muted mt-1 text-sm">{t('settings.backupHint')}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="secondary-button" onClick={exportBackup}>
          <span aria-hidden="true">
            <Icon name="download" size={15} />
          </span>
          {t('settings.exportJson')}
        </button>
        <button className="secondary-button" onClick={() => fileInputRef.current?.click()}>
          <span aria-hidden="true">
            <Icon name="upload" size={15} />
          </span>
          {t('settings.importJson')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void importBackup(event.target.files?.[0] ?? null)}
        />
      </div>
      {status ? <div className="mt-3 text-sm text-[color:var(--ds-accent)]">{status}</div> : null}
      {error ? <div className="mt-3 text-sm text-[color:var(--ds-danger)]">{error}</div> : null}
    </div>
  );
}

function StorageSettings() {
  const { t } = useI18n();
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
    const currentRoot = storageInfo?.path ?? '';
    const targetRoot = storagePath || storageInfo?.defaultPath || '';
    if (currentRoot && targetRoot && targetRoot !== currentRoot) {
      const otherWindows = storageInfo?.otherWindows ?? 0;
      const message =
        otherWindows > 0
          ? t('settings.storageSwitchConfirmMulti', { n: otherWindows })
          : t('settings.storageSwitchConfirm');
      if (!window.confirm(message)) {
        return;
      }
    }
    setIsSaving(true);
    setStatus('');
    setError('');
    try {
      const info = await setStoragePath(storagePath);
      setStorageInfo(info);
      setDraftPath(info.customPath ?? info.path);
      invalidatePersistedAppState();
      window.dispatchEvent(new CustomEvent('otter:storage-changed'));
      void useAppStore.persist.rehydrate?.();
      setStatus(successMessage);
    } catch (currentError) {
      setError(errorMessage(currentError));
    } finally {
      setIsSaving(false);
    }
  };

  const resetPath = async () => {
    await applyStoragePath('', t('settings.storageReset'));
  };

  const choosePath = async () => {
    if (!tauriRuntime) return;
    setIsPicking(true);
    setStatus('');
    setError('');
    try {
      const selected = await openDialog({
        title: t('settings.chooseFolder'),
        defaultPath: storageInfo?.path || storageInfo?.defaultPath,
        directory: true,
        multiple: false,
      });

      if (typeof selected === 'string' && selected.trim()) {
        await applyStoragePath(selected, t('settings.storageSaved'));
      }
    } catch (currentError) {
      setError(errorMessage(currentError));
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <div className="ds-card p-5">
      <div className="flex items-center gap-2 font-medium">
        <span aria-hidden="true" className="flex">
          <Icon name="folder" size={16} />
        </span>
        {t('settings.storage')}
      </div>
      {tauriRuntime ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="ds-text text-sm font-medium">{t('settings.storageFolder')}</span>
            <div className="relative mt-2">
              <input
                value={draftPath}
                readOnly
                disabled={isPicking || isSaving}
                onClick={choosePath}
                placeholder={storageInfo?.defaultPath ?? t('settings.storageDefault')}
                className="h-10 w-full cursor-pointer rounded-md border border-[color:var(--ds-border)] bg-[color:var(--ds-panel)] px-3 pr-20 font-mono text-sm outline-none focus:ring-2 focus:ring-[color:var(--ds-focus-ring)]"
              />
              <button
                type="button"
                aria-label={t('settings.chooseFolder')}
                disabled={isPicking || isSaving}
                onClick={choosePath}
                className="secondary-button absolute right-10 top-1.5 h-7 w-7 !p-0"
              >
                <span aria-hidden="true" className="flex">
                  <Icon name="folder" size={15} />
                </span>
              </button>
              <button
                type="button"
                aria-label={t('settings.useDefault')}
                disabled={isPicking || isSaving}
                onClick={resetPath}
                className="secondary-button absolute right-1.5 top-1.5 h-7 w-7 !p-0"
              >
                <span aria-hidden="true" className="flex">
                  <Icon name="refresh" size={14} />
                </span>
              </button>
            </div>
          </label>
          <div className="ds-muted text-xs">
            {t('settings.storageHint')}{' '}
            <span className="ds-text font-mono">{storageInfo?.path ?? t('settings.storageLoading')}</span>
          </div>
          <div className="ds-muted text-xs">{t('settings.storageSharedHint')}</div>
          {status ? <div className="text-sm text-[color:var(--ds-accent)]">{status}</div> : null}
          {error ? <div className="text-sm text-[color:var(--ds-danger)]">{error}</div> : null}
        </div>
      ) : (
        <p className="ds-muted mt-2 text-sm">{t('settings.storageBrowser')}</p>
      )}
    </div>
  );
}

function HelpPage() {
  const { t } = useI18n();
  const shortcuts = useAppStore((state) => state.shortcuts);

  const shortcutItems: ShortcutAction[] = ['new', 'capture', 'save', 'edit', 'delete', 'cancel'];

  return (
    <Page title={t('nav.help')} subtitle={t('help.subtitle')}>
      <div className="ds-card p-5">
        <div className="flex items-center gap-2 font-medium">
          <span aria-hidden="true" className="flex">
            <Icon name="help" size={16} />
          </span>
          {t('help.shortcuts')}
        </div>
        <div className="mt-4 space-y-3">
          {shortcutItems.map((action) => (
            <div key={action} className="flex items-center justify-between gap-4">
              <div>
                <div className="ds-text text-sm font-medium capitalize">{t(shortcutLabelKeys[action])}</div>
                <div className="ds-muted text-xs">{t(shortcutHelpKeys[action])}</div>
              </div>
              <kbd
                className="rounded-md border border-[color:var(--ds-border)] bg-[color:var(--ds-surface-2)] px-2 py-1 font-mono text-[11.5px] text-[color:var(--ds-text)]"
                data-shortcut-key
              >
                {shortcuts?.[action] ?? defaultShortcuts[action]}
              </kbd>
            </div>
          ))}
        </div>
      </div>

      <div className="ds-card p-5">
        <div className="flex items-center gap-2 font-medium">
          <span aria-hidden="true" className="flex">
            <Icon name="check" size={16} />
          </span>
          {t('help.tips')}
        </div>
        <ul className="ds-muted mt-4 space-y-3 text-sm">
          <li className="flex gap-3">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ds-accent)]"
              aria-hidden="true"
            />
            <span>
              {t('help.tip.capture')
                .split('%SC%')
                .flatMap((part, index) =>
                  index > 0
                    ? [
                        <kbd key={`kbd-${index}`} className="text-[#4ea16b]">
                          {shortcuts?.capture ?? defaultShortcuts.capture}
                        </kbd>,
                        part,
                      ]
                    : [part],
                )}
            </span>
          </li>
          <li className="flex gap-3">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ds-accent)]"
              aria-hidden="true"
            />
            <span>{t('help.tip.plan')}</span>
          </li>
          <li className="flex gap-3">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ds-accent)]"
              aria-hidden="true"
            />
            <span>{t('help.tip.span')}</span>
          </li>
          <li className="flex gap-3">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ds-accent)]"
              aria-hidden="true"
            />
            <span>{t('help.tip.review')}</span>
          </li>
        </ul>
      </div>

      <div className="ds-card p-5">
        <div className="flex items-center gap-2 font-medium">
          <span aria-hidden="true" className="flex">
            <Icon name="calendar" size={16} />
          </span>
          {t('help.stats')}
        </div>
        <ul className="ds-muted mt-4 space-y-3 text-sm">
          <li className="flex gap-3">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ds-warn)]"
              aria-hidden="true"
            />
            <span>{t('help.stat.completed')}</span>
          </li>
          <li className="flex gap-3">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ds-warn)]"
              aria-hidden="true"
            />
            <span>{t('help.stat.plan')}</span>
          </li>
          <li className="flex gap-3">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ds-warn)]"
              aria-hidden="true"
            />
            <span>{t('help.stat.daily')}</span>
          </li>
        </ul>
      </div>

      <div className="ds-card p-5">
        <div className="flex items-center gap-2 font-medium">
          <span aria-hidden="true" className="flex">
            <Icon name="note" size={16} />
          </span>
          {t('help.todo')}
        </div>
        <p className="ds-muted mt-2 text-sm">{t('help.todoHint')}</p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-[color:var(--ds-code-border)] bg-[color:var(--ds-code-surface)] p-4 font-mono text-xs text-[color:var(--ds-text)]">
          {'- [ ] incomplete task\n- [x] completed task'}
        </pre>
        <div className="mt-5 flex items-center gap-2 font-medium">
          <span aria-hidden="true" className="flex">
            <Icon name="image" size={16} />
          </span>
          {t('help.images')}
        </div>
        <p className="ds-muted mt-2 text-sm">{t('help.imagesHint')}</p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-[color:var(--ds-code-border)] bg-[color:var(--ds-code-surface)] p-4 font-mono text-xs text-[color:var(--ds-text)]">
          {'![alt text](data:image/png;base64,...)'}
        </pre>
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
  const { t } = useI18n();

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
        <div className="ds-text text-sm font-medium capitalize">{t(shortcutLabelKeys[action])}</div>
        <div className="ds-muted text-xs">{t(shortcutHelpKeys[action])}</div>
      </div>
      <button
        className={`${isRecording ? 'primary-button' : 'secondary-button'} min-w-40 justify-start font-mono`}
        onClick={() => setIsRecording(true)}
        onBlur={() => setIsRecording(false)}
        data-shortcut-recorder={isRecording ? 'true' : 'false'}
      >
        {isRecording ? t('settings.recording') : value}
      </button>
    </div>
  );
}

type MarkdownAstNode = {
  type?: string;
  value?: unknown;
  properties?: { className?: unknown };
  children?: MarkdownAstNode[];
};

const markdownRemarkPlugins: NonNullable<React.ComponentProps<typeof ReactMarkdown>['remarkPlugins']> = [
  remarkGfm,
];

const markdownRehypePlugins: NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']> = [
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];

/**
 * Rehype plugin that wraps occurrences of `query` in plain text with <mark className="find-hl">.
 * Runs after rehype-highlight so code-block text is left untouched.
 */
function findHighlightRehypePlugin(query: string) {
  const pattern = query ? new RegExp(`(${escapeRegExp(query)})`, 'gi') : null;

  return () => {
    return (tree: Root) => {
      if (!pattern) {
        return;
      }

      visit(tree, 'text', (node, index, parent) => {
        if (
          !parent ||
          index === undefined ||
          typeof node.value !== 'string' ||
          !parent.children ||
          index < 0
        ) {
          return;
        }

        const parts = node.value.split(pattern);
        if (parts.length <= 1) {
          return;
        }

        const replacement: Array<
          | { type: 'text'; value: string }
          | {
              type: 'element';
              tagName: 'mark';
              properties: { className: string[] };
              children: Array<{ type: 'text'; value: string }>;
            }
        > = [];

        parts.forEach((part, partIndex) => {
          if (!part) {
            return;
          }
          replacement.push(
            partIndex % 2 === 1
              ? {
                  type: 'element',
                  tagName: 'mark',
                  properties: { className: ['find-hl'] },
                  children: [{ type: 'text', value: part }],
                }
              : { type: 'text', value: part },
          );
        });

        parent.children.splice(index, 1, ...replacement);
        return index + replacement.length;
      });
    };
  };
}

function markdownCodeLanguage(node?: ExtraProps['node']) {
  const codeChild = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const className = codeChild?.type === 'element' ? codeChild.properties?.className : undefined;
  const classes = Array.isArray(className)
    ? className.filter((item): item is string => typeof item === 'string')
    : typeof className === 'string'
      ? className.split(/\s+/)
      : [];
  const language = classes.find((item) => item.startsWith('language-'));
  return language ? language.slice('language-'.length) : '';
}

function markdownNodeHasClass(node: ExtraProps['node'], className: string) {
  const value = node?.properties?.className;
  const classes = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? value.split(/\s+/)
      : [];
  return classes.includes(className);
}

function markdownNodeText(node?: ExtraProps['node'] | MarkdownAstNode): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  const current = node as MarkdownAstNode;
  if (current.type === 'text') {
    return typeof current.value === 'string' ? current.value : '';
  }

  if (!Array.isArray(current.children)) {
    return '';
  }

  return current.children.map((child) => markdownNodeText(child)).join('');
}

function MarkdownCodeBlock({ node, children, ...props }: React.ComponentProps<'pre'> & ExtraProps) {
  const { t } = useI18n();
  const language = markdownCodeLanguage(node);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyCode = React.useCallback(async () => {
    const text = markdownNodeText(node);
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (currentError) {
      window.alert(errorMessage(currentError));
    }
  }, [node]);

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-block-header">
        <span className="markdown-code-block-language">{language || 'text'}</span>
        <button
          type="button"
          className="markdown-code-block-copy"
          onClick={copyCode}
          aria-label={copied ? t('code.copiedLabel') : t('code.copyLabel')}
        >
          <span aria-hidden="true" className="flex">
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </span>
          {copied ? t('code.copied') : t('code.copy')}
        </button>
      </div>
      <pre {...props} tabIndex={0}>
        {children}
      </pre>
    </div>
  );
}

/**
 * Task list items use a two-column grid (checkbox + text). Keep every child after
 * the checkbox in one inline flow so injected nodes such as find-highlight `<mark>`
 * or `<strong>` cannot land in the narrow checkbox column.
 */
function MarkdownListItem({ node, children, ...props }: React.ComponentProps<'li'> & ExtraProps) {
  if (!markdownNodeHasClass(node, 'task-list-item')) {
    return <li {...props}>{children}</li>;
  }

  const [checkbox, ...rest] = React.Children.toArray(children);
  return (
    <li {...props}>
      {checkbox}
      <span className="task-list-item-content">{rest}</span>
    </li>
  );
}

/** Rendered markdown body. Task checkboxes become clickable when `onTodoToggle` is given. */
function MarkdownContent({
  content,
  onTodoToggle,
  findQuery,
  activeIndex,
  onMatchCount,
}: {
  content: string;
  onTodoToggle?: (occurrenceIndex: number, done: boolean) => void;
  findQuery?: string;
  activeIndex?: number;
  onMatchCount?: (count: number) => void;
}) {
  const handleTodoChange = React.useCallback(
    (event: React.ChangeEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!onTodoToggle || !(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
        return;
      }

      const checkboxes = Array.from(
        event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      );
      const occurrenceIndex = checkboxes.indexOf(target);
      if (occurrenceIndex >= 0) {
        onTodoToggle(occurrenceIndex, target.checked);
      }
    },
    [onTodoToggle],
  );

  const rootRef = React.useRef<HTMLDivElement>(null);
  const findQueryNormalized = findQuery?.trim().toLowerCase() ?? '';

  const components = {
    img: MarkdownImageElement,
    li: MarkdownListItem,
    pre: MarkdownCodeBlock,
    ...(onTodoToggle
      ? {
          input: ({
            node: _node,
            checked: _checked,
            disabled: _disabled,
            ...props
          }: React.ComponentProps<'input'> & { node?: unknown; checked?: boolean }) => (
            <input {...props} type="checkbox" defaultChecked={_checked} disabled={false} />
          ),
        }
      : {}),
  };

  const findHighlightPlugin = React.useMemo(
    () => findHighlightRehypePlugin(findQueryNormalized),
    [findQueryNormalized],
  );

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const marks = Array.from(root.querySelectorAll<HTMLElement>('mark.find-hl'));
    onMatchCount?.(marks.length);
    for (const mark of marks) {
      mark.classList.remove('is-current');
    }
    const active = marks[activeIndex ?? -1];
    if (active) {
      active.classList.add('is-current');
      active.scrollIntoView({ block: 'center' });
    }
  }, [activeIndex, content, findQuery, onMatchCount]);

  return (
    <div ref={rootRef} className="markdown-content" onChange={onTodoToggle ? handleTodoChange : undefined}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={[...markdownRehypePlugins, findHighlightPlugin]}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Read-only note body with an empty hint, used by the detail and pinned windows. */
function NoteBodyPreview({
  content,
  emptyMessage,
  onDoubleClick,
  onTodoToggle,
  findQuery,
  activeIndex,
  onMatchCount,
}: {
  content: string;
  emptyMessage: string;
  onDoubleClick?: () => void;
  onTodoToggle?: (occurrenceIndex: number, done: boolean) => void;
  findQuery?: string;
  activeIndex?: number;
  onMatchCount?: (count: number) => void;
}) {
  return (
    <div className="pinned-note-preview min-h-full" onDoubleClick={onDoubleClick}>
      {content.trim() ? (
        <MarkdownContent
          content={content}
          onTodoToggle={onTodoToggle}
          findQuery={findQuery}
          activeIndex={activeIndex}
          onMatchCount={onMatchCount}
        />
      ) : (
        <div className="pinned-note-empty">{emptyMessage}</div>
      )}
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
        // Loading the primary attachment failed; fall through to the legacy
        // fallback candidates below.
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

function MarkdownImageElement({ src, alt }: { src?: string; alt?: string }) {
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

function formatDate(value: string) {
  return formatCompactDateTime(value);
}

function formatCompactDateTime(value: string) {
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
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
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    primary: parts.some((part) =>
      ['mod', 'cmd', 'command', 'meta', 'ctrl', 'control'].includes(part.toLowerCase()),
    ),
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

const shortcutLabelKeys: Record<ShortcutAction, MessageKey> = {
  new: 'shortcut.new.label',
  save: 'shortcut.save.label',
  edit: 'shortcut.edit.label',
  delete: 'shortcut.delete.label',
  cancel: 'shortcut.cancel.label',
  capture: 'shortcut.capture.label',
};

const shortcutHelpKeys: Record<ShortcutAction, MessageKey> = {
  new: 'shortcut.new.help',
  save: 'shortcut.save.help',
  edit: 'shortcut.edit.help',
  delete: 'shortcut.delete.help',
  cancel: 'shortcut.cancel.help',
  capture: 'shortcut.capture.help',
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

/** Split the text on case-insensitive `query` and wrap the matched parts in <mark class="find-hl">. */
function highlightTextMatches(text: string, query: string, keyPrefix?: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized || !text) {
    return text;
  }
  const parts = text.split(new RegExp(`(${escapeRegExp(normalized)})`, 'gi'));
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={`${keyPrefix ?? 'hl'}-${index}`} className="find-hl">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function normalizeImportedSnapshot(value: Partial<AppStateSnapshot>): AppStateSnapshot {
  return {
    activeSection: value.activeSection ?? 'notes',
    selectedNoteId: value.selectedNoteId,
    query: value.query ?? '',
    searchFocused: false,
    notes: Array.isArray(value.notes) ? value.notes.map(normalizeImportedNote) : [],
    todos: Array.isArray(value.todos) ? value.todos.map(normalizeImportedTodo) : [],
    recentNoteIds: (Array.isArray(value.recentNoteIds)
      ? value.recentNoteIds.filter((item): item is string => typeof item === 'string')
      : []
    ).slice(0, 10),
    shortcuts: {
      ...defaultShortcuts,
      ...normalizeImportedShortcuts(value.shortcuts),
    },
    theme: value.theme === 'dark' ? 'dark' : 'light',
    locale: value.locale === 'zh' ? 'zh' : 'en',
    deletedStack: Array.isArray(value.deletedStack) ? value.deletedStack : [],
  };
}

const nowIso = () => new Date().toISOString();

/**
 * A hand-edited or cross-version backup may omit required note fields. Fill in
 * safe defaults so every import round-trips into the store without crashing
 * the renderers (which call `updatedAt.localeCompare`, `slice`, etc.).
 */
function normalizeImportedNote(value: unknown): Note {
  const raw = (value ?? {}) as Partial<Note> & Record<string, unknown>;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('note'),
    title:
      typeof raw.title === 'string'
        ? raw.title
        : titleFromFirstLine(raw.content as string) || 'Untitled Note',
    content: typeof raw.content === 'string' ? raw.content : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    archivedAt: typeof raw.archivedAt === 'string' ? raw.archivedAt : undefined,
  };
}

function normalizeImportedTodo(value: unknown): Todo {
  const raw = (value ?? {}) as Partial<Todo> & Record<string, unknown>;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('todo'),
    noteId: typeof raw.noteId === 'string' ? raw.noteId : undefined,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled Todo',
    status: raw.status === 'done' ? 'done' : 'todo',
    source: raw.source === 'note' ? 'note' : 'standalone',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : undefined,
    start: typeof raw.start === 'string' ? raw.start : undefined,
    days: typeof raw.days === 'number' && Number.isFinite(raw.days) ? Math.max(1, raw.days) : undefined,
    due: typeof raw.due === 'string' ? raw.due : undefined,
    priority:
      raw.priority === 'low' || raw.priority === 'medium' || raw.priority === 'high'
        ? raw.priority
        : undefined,
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
