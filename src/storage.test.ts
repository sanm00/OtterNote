import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

function enableTauriRuntime() {
  (window as TauriWindow).__TAURI_INTERNALS__ = {};
}

function disableTauriRuntime() {
  delete (window as TauriWindow).__TAURI_INTERNALS__;
}

/**
 * storage.ts keeps hydration and write-loop state at module scope, so every
 * test loads a fresh copy of the module.
 */
async function loadStorageModule() {
  vi.resetModules();
  return import('./storage');
}

const STORE_NAME = 'otter-note-store';

beforeEach(() => {
  invokeMock.mockReset();
  window.localStorage.clear();
  disableTauriRuntime();
});

afterEach(() => {
  vi.restoreAllMocks();
  disableTauriRuntime();
});

describe('browser runtime', () => {
  it('reads and writes app state through localStorage', async () => {
    const { appStorage } = await loadStorageModule();

    expect(await appStorage.getItem(STORE_NAME)).toBeNull();
    await appStorage.setItem(STORE_NAME, '{"notes":[]}');

    expect(window.localStorage.getItem(STORE_NAME)).toBe('{"notes":[]}');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('removes app state from localStorage', async () => {
    const { appStorage } = await loadStorageModule();

    await appStorage.getItem(STORE_NAME);
    await appStorage.setItem(STORE_NAME, 'value');
    await appStorage.removeItem(STORE_NAME);

    expect(window.localStorage.getItem(STORE_NAME)).toBeNull();
  });

  it('ignores writes that arrive before hydration', async () => {
    const { appStorage } = await loadStorageModule();

    await appStorage.setItem(STORE_NAME, 'early write');

    expect(window.localStorage.getItem(STORE_NAME)).toBeNull();
  });

  it('skips writes when the value has not changed', async () => {
    const { appStorage } = await loadStorageModule();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await appStorage.getItem(STORE_NAME);
    await appStorage.setItem(STORE_NAME, 'value');
    await appStorage.setItem(STORE_NAME, 'value');

    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  it('reports no storage info outside the desktop app', async () => {
    const { getStorageInfo } = await loadStorageModule();

    expect(await getStorageInfo()).toBeNull();
  });
});

describe('desktop runtime', () => {
  it('reads app state from the storage file', async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValue('{"notes":[{"id":"note-1"}]}');

    const { appStorage } = await loadStorageModule();

    expect(await appStorage.getItem(STORE_NAME)).toBe('{"notes":[{"id":"note-1"}]}');
    expect(invokeMock).toHaveBeenCalledWith('read_app_state');
  });

  it('writes app state to the storage file after hydration', async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValue(null);

    const { appStorage } = await loadStorageModule();
    await appStorage.getItem(STORE_NAME);
    await appStorage.setItem(STORE_NAME, '{"notes":[]}');

    expect(invokeMock).toHaveBeenCalledWith('write_app_state', { value: '{"notes":[]}' });
  });

  it('migrates legacy browser state into the storage file', async () => {
    enableTauriRuntime();
    window.localStorage.setItem(STORE_NAME, '{"notes":[{"id":"legacy"}]}');
    invokeMock.mockResolvedValue(null);

    const { appStorage } = await loadStorageModule();

    expect(await appStorage.getItem(STORE_NAME)).toBe('{"notes":[{"id":"legacy"}]}');
    expect(invokeMock).toHaveBeenCalledWith('write_app_state', { value: '{"notes":[{"id":"legacy"}]}' });
  });

  it('does not overwrite the storage file when it already has state', async () => {
    enableTauriRuntime();
    window.localStorage.setItem(STORE_NAME, '{"notes":[{"id":"legacy"}]}');
    invokeMock.mockResolvedValue('{"notes":[{"id":"file"}]}');

    const { appStorage } = await loadStorageModule();

    expect(await appStorage.getItem(STORE_NAME)).toBe('{"notes":[{"id":"file"}]}');
    expect(invokeMock).not.toHaveBeenCalledWith('write_app_state', expect.anything());
  });

  it('clears app state by writing an empty value', async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValue(null);

    const { appStorage } = await loadStorageModule();
    await appStorage.getItem(STORE_NAME);
    await appStorage.removeItem(STORE_NAME);

    expect(invokeMock).toHaveBeenCalledWith('write_app_state', { value: '' });
  });

  it('surfaces write failures to the caller', async () => {
    enableTauriRuntime();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_app_state') return null;
      throw new Error('disk full');
    });

    const { appStorage } = await loadStorageModule();
    await appStorage.getItem(STORE_NAME);

    await expect(appStorage.setItem(STORE_NAME, '{"notes":[]}')).rejects.toThrow('disk full');
  });

  it('keeps only the newest value when writes are coalesced', async () => {
    enableTauriRuntime();
    const writes: string[] = [];
    invokeMock.mockImplementation(async (command: string, payload?: { value?: string }) => {
      if (command === 'read_app_state') return null;
      if (command === 'write_app_state' && payload?.value !== undefined) {
        writes.push(payload.value);
      }
      return null;
    });

    const { appStorage } = await loadStorageModule();
    await appStorage.getItem(STORE_NAME);

    const first = appStorage.setItem(STORE_NAME, 'first');
    const second = appStorage.setItem(STORE_NAME, 'second');
    await Promise.all([first, second]);

    expect(writes.at(-1)).toBe('second');
    expect(writes.length).toBeLessThanOrEqual(2);
  });
});

describe('storage path and attachment commands', () => {
  it('forwards storage information requests', async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValue({ path: '/data', defaultPath: '/data' });

    const { getStorageInfo, setStoragePath, validateStoragePath } = await loadStorageModule();

    await expect(getStorageInfo()).resolves.toEqual({ path: '/data', defaultPath: '/data' });
    await setStoragePath('/custom');
    await validateStoragePath('/custom');

    expect(invokeMock).toHaveBeenCalledWith('set_storage_path', { storagePath: '/custom' });
    expect(invokeMock).toHaveBeenCalledWith('validate_storage_path', { storagePath: '/custom' });
  });

  it('forwards attachment and export commands', async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValue(null);

    const {
      deleteImageAttachment,
      listImageAttachments,
      readImageAttachmentBytes,
      readNoteBundle,
      searchNotes,
      writeExportFile,
    } = await loadStorageModule();

    await listImageAttachments();
    await deleteImageAttachment('asset-1.png');
    await readImageAttachmentBytes('asset-1.png');
    await readNoteBundle('note-1');
    await searchNotes('milk');
    await writeExportFile('/tmp/note.md', '# Note');

    expect(invokeMock).toHaveBeenCalledWith('list_image_attachments');
    expect(invokeMock).toHaveBeenCalledWith('delete_image_attachment', { fileName: 'asset-1.png' });
    expect(invokeMock).toHaveBeenCalledWith('read_image_attachment_bytes', { fileName: 'asset-1.png' });
    expect(invokeMock).toHaveBeenCalledWith('read_note_bundle', { noteId: 'note-1' });
    expect(invokeMock).toHaveBeenCalledWith('search_notes', { query: 'milk' });
    expect(invokeMock).toHaveBeenCalledWith('write_export_file', {
      filePath: '/tmp/note.md',
      content: '# Note',
    });
  });
});
