import { invoke } from '@tauri-apps/api/core';
import type { StateStorage } from 'zustand/middleware';

export type StorageInfo = {
  path: string;
  defaultPath: string;
  customPath?: string | null;
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

export const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean((window as TauriWindow).__TAURI_INTERNALS__);

export const appStorage: StateStorage = {
  async getItem(name) {
    if (!isTauriRuntime()) {
      return window.localStorage.getItem(name);
    }

    const fileValue = await invoke<string | null>('read_app_state');
    if (fileValue) {
      return fileValue;
    }

    const legacyValue = window.localStorage.getItem(name || browserStorageKey);
    if (legacyValue) {
      await invoke('write_app_state', { value: legacyValue });
    }

    return legacyValue;
  },
  async setItem(name, value) {
    if (!isTauriRuntime()) {
      window.localStorage.setItem(name || browserStorageKey, value);
      return;
    }

    await invoke('write_app_state', { value });
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

export async function searchNotes(query: string): Promise<Array<{ noteId: string; title: string; updatedAt: string; preview: string }>> {
  return invoke<Array<{ noteId: string; title: string; updatedAt: string; preview: string }>>('search_notes', {
    query,
  });
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
