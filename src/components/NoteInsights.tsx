import React from 'react';
import { useI18n } from '../lib/i18n';
import { contentPreview } from '../lib/review';
import {
  buildBacklinks,
  extractTags,
  extractWikiLinks,
  findNoteByTitle,
  normalizeTag,
  removeTagFromContent,
  setFrontTags,
} from '../lib/tags';
import { useAppStore } from '../store';

/** Editable note-header tag chips. Chips mirror every `#tag` in the body. */
export function NoteTags({ noteId }: { noteId: string }) {
  const { t } = useI18n();
  const note = useAppStore((state) => state.notes.find((item) => item.id === noteId));
  const updateNoteContent = useAppStore((state) => state.updateNoteContent);
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const tags = React.useMemo(() => (note ? extractTags(note.content) : []), [note]);

  if (!note) {
    return null;
  }

  const commit = (next: string[]) => {
    updateNoteContent(note.id, setFrontTags(note.content, next));
  };

  const addTag = () => {
    const tag = normalizeTag(draft);
    setDraft('');
    if (!tag || tags.includes(tag)) {
      return;
    }
    commit([...tags, tag]);
    inputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    updateNoteContent(note.id, removeTagFromContent(note.content, tag));
  };

  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className="ds-doc-tag is-editable">
          <button
            type="button"
            className="ds-doc-tag-remove"
            aria-label={t('notes.removeTag', { tag })}
            onClick={() => removeTag(tag)}
          >
            ×
          </button>
          #{tag}
        </span>
      ))}
      <span className="ds-tag-add">
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addTag();
            } else if (event.key === 'Escape') {
              setDraft('');
              event.currentTarget.blur();
            }
          }}
          onBlur={() => draft && addTag()}
          placeholder={t('notes.addTagPlaceholder')}
          aria-label={t('notes.addTag')}
          className="ds-tag-add-input"
        />
      </span>
    </>
  );
}

/** Outgoing wiki links and backlinks for a note. Renders nothing when empty. */
export function NoteInsights({ noteId }: { noteId: string }) {
  const { t } = useI18n();
  const notes = useAppStore((state) => state.notes);
  const selectNote = useAppStore((state) => state.selectNote);

  const note = notes.find((item) => item.id === noteId);

  const outgoing = React.useMemo(() => {
    if (!note) {
      return [];
    }

    return [...new Set(extractWikiLinks(note.content))]
      .map((title) => ({ title, note: findNoteByTitle(notes, title) }))
      .filter((item) => item.note && item.note.id !== noteId);
  }, [note, noteId, notes]);

  const backlinks = React.useMemo(() => buildBacklinks(notes, noteId), [notes, noteId]);

  if (outgoing.length === 0 && backlinks.length === 0) {
    return null;
  }

  return (
    <div className="pb-2">
      {outgoing.length > 0 ? (
        <div className="ds-tags mt-2">
          <span className="ds-faint" aria-hidden="true">
            →
          </span>
          {outgoing.map((item) => (
            <button
              key={item.title}
              type="button"
              className="ds-tag"
              onClick={() => selectNote(item.note!.id)}
            >
              《{item.title}》
            </button>
          ))}
        </div>
      ) : null}

      {backlinks.length > 0 ? (
        <div className="backlinks">
          <h3>
            {t('notes.backlinks')} · {backlinks.length}
          </h3>
          {backlinks.map((link) => (
            <div key={link.noteId} className="bl">
              <button type="button" className="ds-tag" onClick={() => selectNote(link.noteId)}>
                《{link.title}》
              </button>
              <span className="ctx truncate">{contentPreview(link.snippet) || link.snippet}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
