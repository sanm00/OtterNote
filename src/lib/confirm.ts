import { ask as askDialog } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from '../storage';

export async function confirmDeletion(message: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return window.confirm(message);
  }

  return askDialog(message, {
    title: 'Confirm deletion',
    kind: 'warning',
    okLabel: 'Delete',
    cancelLabel: 'Cancel',
  });
}
