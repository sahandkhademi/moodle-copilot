import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Moodle Copilot',
    description: 'Ask your Moodle anything. Deadlines, grades and attendance in one side panel.',
    permissions: ['sidePanel', 'storage', 'alarms', 'notifications', 'tabs', 'scripting'],
    // Demo build: any Moodle host + api.anthropic.com + Zapier MCP
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Moodle Copilot' },
  },
});
