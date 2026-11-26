// Adds Copilot to Moodle's own Dashboard when "Show Copilot inside Moodle" is on.
// Matches every /my/ page; mountCopilot() then checks that it's really the Moodle Dashboard of the configured site.
import { getSettings } from '@/lib/settings';
import { watchItem, KEYS } from '@/lib/storage';
import { mountCopilot, shouldMount } from '@/lib/inpage/mount';

export default defineContentScript({
  matches: ['*://*/my/*'],
  runAt: 'document_idle',
  async main() {
    let unmount: (() => void) | null = null;
    const sync = async () => {
      const on = await shouldMount(await getSettings());
      if (on && !unmount) unmount = await mountCopilot();
      if (!on && unmount) {
        unmount();
        unmount = null;
      }
    };
    await sync();
    // Toggling the setting takes effect without a reload.
    watchItem(KEYS.settings, () => void sync());
  },
});
