// Content script → background messages. The background has host permissions (no CORS) and can open the side panel.
import type { SyncItem, SyncOptions, SyncResult, UndoResult } from '../google/sync';

export type BridgeMessage =
  | { type: 'google-sync'; items: SyncItem[]; opts: SyncOptions }
  | { type: 'google-undo'; deadlineIds: string[] }
  | { type: 'google-prewarm' }
  | { type: 'open-panel'; prompt?: string };

const hasRuntime = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id;

export async function syncViaBackground(items: SyncItem[], opts: SyncOptions): Promise<SyncResult[]> {
  if (!hasRuntime()) {
    // Preview outside the extension (e.g. injected for testing): pretend it worked.
    await new Promise((r) => setTimeout(r, 600));
    return items.map((i) => ({ deadlineId: i.deadline.id, calendar: opts.calendar ? 'created' : 'skipped', tasks: opts.tasks ? 'created' : 'skipped' }));
  }
  return chrome.runtime.sendMessage({ type: 'google-sync', items, opts } satisfies BridgeMessage);
}

/** Opens the Copilot side panel, optionally sending a question to the Assistant. Must be called from a click. */
export async function openAssistant(prompt?: string): Promise<void> {
  if (!hasRuntime()) return;
  await chrome.runtime.sendMessage({ type: 'open-panel', prompt } satisfies BridgeMessage).catch(() => {});
}

export async function undoViaBackground(deadlineIds: string[]): Promise<UndoResult[]> {
  if (!hasRuntime()) {
    await new Promise((r) => setTimeout(r, 300));
    return deadlineIds.map((id) => ({ deadlineId: id, ok: true }));
  }
  return chrome.runtime.sendMessage({ type: 'google-undo', deadlineIds } satisfies BridgeMessage);
}

/** Opens the Zapier connection in the background ahead of the first click. */
export function prewarmViaBackground(): void {
  if (hasRuntime()) chrome.runtime.sendMessage({ type: 'google-prewarm' } satisfies BridgeMessage).catch(() => {});
}
