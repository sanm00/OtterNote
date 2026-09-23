import { invoke } from '@tauri-apps/api/core';
import type { StateStorage } from 'zustand/middleware';

export type StorageInfo = {
  path: string;
  defaultPath: string;
  customPath?: string | null;
  otherWindows?: number;
};

export type ImageAttachment = {
  fileName: string;
  originalFileName: string;
  path: string;
  size: number;
  modifiedAt: string;
};

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

const browserStorageKey = 'otter-note-store';
let lastPersistedAppState: string | null | undefined;
let lastScheduledAppState: string | null | undefined;
let pendingAppStateWrite: { name: string; value: string } | null = null;
let appStateWriteLoop: Promise<void> | null = null;
let appStateHydrated = false;
let storageEpoch = 0;

export const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean((window as TauriWindow).__TAURI_INTERNALS__);

function rememberPersistedAppState(value: string | null) {
  lastPersistedAppState = value;
  lastScheduledAppState = value;
  appStateHydrated = true;
}

/// Called after the active storage root moved. In-flight writes carrying the
/// previous folder's snapshot are dropped instead of being copied forward.
export function invalidatePersistedAppState() {
  storageEpoch += 1;
  pendingAppStateWrite = null;
  lastPersistedAppState = null;
  lastScheduledAppState = null;
}

function queueAppStateWrite(name: string, value: string) {
  // Zustand may update transient UI state while its asynchronous desktop
  // storage is still hydrating. Never let that default snapshot overwrite the
  // on-disk state before getItem has completed.
  if (!appStateHydrated) {
    return Promise.resolve();
  }

  const epoch = storageEpoch;

  if (value === lastPersistedAppState && !pendingAppStateWrite && !appStateWriteLoop) {
    return Promise.resolve();
  }

  if (value !== lastScheduledAppState) {
    lastScheduledAppState = value;
    // Replacing the pending snapshot intentionally drops intermediate states;
    // the in-flight write completes, then only the newest snapshot is stored.
    pendingAppStateWrite = { name, value };
  }

  if (!appStateWriteLoop) {
    const loop = (async () => {
      let latestError: unknown;
      while (pendingAppStateWrite) {
        const next = pendingAppStateWrite;
        pendingAppStateWrite = null;
        try {
          if (epoch !== storageEpoch) {
            // The storage root moved mid-write: this snapshot belongs to the
            // previous folder and must not land in the new one.
            lastPersistedAppState = null;
            lastScheduledAppState = null;
            continue;
          }
          if (next.value !== lastPersistedAppState) {
            if (isTauriRuntime()) {
              await invoke('write_app_state', { value: next.value });
            } else {
              window.localStorage.setItem(next.name || browserStorageKey, next.value);
            }
            lastPersistedAppState = next.value;
          }
          latestError = undefined;
        } catch (error) {
          latestError = error;
        }
      }

      if (latestError) {
        throw latestError;
      }
    })();
    appStateWriteLoop = loop;
    void loop.then(
      () => {
        if (appStateWriteLoop === loop) appStateWriteLoop = null;
      },
      () => {
        if (appStateWriteLoop === loop) {
          appStateWriteLoop = null;
          lastScheduledAppState = lastPersistedAppState;
        }
      },
    );
  }

  return appStateWriteLoop;
}

export const appStorage: StateStorage = {
  async getItem(name) {
    if (!isTauriRuntime()) {
      const value = window.localStorage.getItem(name || browserStorageKey);
      rememberPersistedAppState(value);
      return value;
    }

    const fileValue = await invoke<string | null>('read_app_state');
    if (fileValue) {
      rememberPersistedAppState(fileValue);
      return fileValue;
    }

    const legacyValue = window.localStorage.getItem(name || browserStorageKey);
    if (legacyValue) {
      await invoke('write_app_state', { value: legacyValue });
    }

    rememberPersistedAppState(legacyValue);
    return legacyValue;
  },
  setItem(name, value) {
    return queueAppStateWrite(name, value);
  },
  async removeItem(name) {
    if (!isTauriRuntime()) {
      window.localStorage.removeItem(name || browserStorageKey);
      return;
    }

    await invoke('write_app_state', { value: '' });
  },
};

export async function getStorageInfo(): Promise<StorageInfo | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return invoke<StorageInfo>('get_storage_info');
}

export async function setStoragePath(storagePath: string): Promise<StorageInfo> {
  return invoke<StorageInfo>('set_storage_path', { storagePath });
}

export async function validateStoragePath(storagePath: string): Promise<void> {
  return invoke('validate_storage_path', { storagePath });
}

export async function saveImageAttachment(sourcePath: string, attachmentBaseName: string): Promise<string> {
  return invoke<string>('save_image_attachment', { sourcePath, attachmentBaseName });
}

export async function saveImageAttachmentBytes(
  bytes: number[],
  sourceFileName: string,
  attachmentBaseName: string,
): Promise<string> {
  return invoke<string>('save_image_attachment_bytes', { bytes, sourceFileName, attachmentBaseName });
}

export async function readImageAttachmentBytes(fileName: string): Promise<number[]> {
  return invoke<number[]>('read_image_attachment_bytes', { fileName });
}

export async function readNoteBundle(noteId: string): Promise<string | null> {
  return invoke<string | null>('read_note_bundle', { noteId });
}

export async function searchNotes(
  query: string,
): Promise<Array<{ noteId: string; title: string; updatedAt: string; preview: string }>> {
  return invoke<Array<{ noteId: string; title: string; updatedAt: string; preview: string }>>(
    'search_notes',
    {
      query,
    },
  );
}

export async function listImageAttachments(): Promise<ImageAttachment[]> {
  return invoke<ImageAttachment[]>('list_image_attachments');
}

export async function deleteImageAttachment(fileName: string): Promise<void> {
  return invoke('delete_image_attachment', { fileName });
}

export async function writeExportFile(filePath: string, content: string): Promise<void> {
  return invoke('write_export_file', { filePath, content });
}

export async function pinNoteWindow(noteId: string, title: string): Promise<void> {
  return invoke('pin_note_window', { noteId, title });
}

export async function pinNewNoteWindow(): Promise<void> {
  return invoke('pin_new_note_window');
}
