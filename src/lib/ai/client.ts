// Shared Claude client. Runs in extension pages (side panel / background), key from settings.
import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from '../settings';

export const CLAUDE_MODEL = 'claude-opus-5-5';

export async function getClaude(): Promise<Anthropic> {
  const { anthropicApiKey } = await getSettings();
  if (!anthropicApiKey) throw new Error('No Claude API key. Add one in Settings.');
  // Local demo only: the key lives in chrome.storage on this machine.
  return new Anthropic({ apiKey: anthropicApiKey, dangerouslyAllowBrowser: true });
}
