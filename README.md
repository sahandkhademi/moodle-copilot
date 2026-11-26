# Moodle Copilot

FestDev 26 hackathon project: a Chrome side-panel assistant for JKU Moodle.

- 💬 Ask about your grades, attendance and deadlines in plain language
- 📅 One dashboard with everything that's coming up
- 🔗 Push deadlines to Google Calendar and Google Tasks

See [PLAN.md](PLAN.md) for the roadmap.

## Run locally

```bash
npm install
npm run build        # → .output/chrome-mv3
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick `.output/chrome-mv3`.
2. Click the toolbar icon → the side panel opens.
3. Settings → paste a Gemini API key (Google AI Studio). Demo data is on by default.

`npm run dev` opens a separate Chrome with the extension loaded and hot reload.

## Checks

```bash
npm run compile && npm run build
npx tsx scripts/check-chat-tools.ts        # tool + grade math (live Gemini call if GEMINI_API_KEY is set)
npx tsx scripts/check-notifications.ts
npx tsx scripts/check-google.ts
npx tsx scripts/check-moodle-parsers.ts    # fixtures only
node scripts/e2e-extension.mjs             # loads the built extension in real Chromium
```

## Code map

| Path | What |
|---|---|
| `src/lib/types.ts` | Shared data model (courses, grades, attendance, deadlines) |
| `src/lib/data/` | `getData()` → mock or real Moodle, with fallback to mock |
| `src/lib/grading.ts` | Austrian 1–5 math: standing, "what do I need", what-if |
| `src/lib/attendance.ts` | Absence limit math |
| `src/lib/settings.ts`, `storage.ts` | Settings + shared storage keys |
| `src/lib/ai/client.ts` | Gemini client |
| `src/components/ui/moodle.tsx` | Moodle-look building blocks: Block, Button, Badge, Input, ActivityIcon |
| `src/lib/google/sync.ts` | Google Calendar/Tasks via Zapier MCP |
| `src/components/*` | Chat, Dashboard, Settings, Google buttons |
| `src/entrypoints/` | Side panel + background service worker |

## Zapier setup (one time)

Google Calendar and Google Tasks are reached through a Zapier MCP server, so there is no Google OAuth screen.

1. Go to [mcp.zapier.com](https://mcp.zapier.com) and create a new MCP server (client: "Other").
2. Add these actions:
   - **Google Calendar: Create Detailed Event** and **Google Tasks: Create Task** (adding)
   - **Google Calendar: Delete Event** and **Google Tasks: Delete Task** (for **Undo**; if Delete Task isn't offered, **Update Task** works too — the task is marked done)
   - optional: **Google Calendar: Find Event(s)** (only used by the Gemini fallback)
3. When asked, connect your Google account for each action.
4. Copy the server URL (and the token, if one is shown separately).
5. In the extension: Settings, turn **Demo data** off, paste the URL into "Zapier MCP server URL" (token optional), press "Test connection". You should see the tool names.

Adding is instant in the UI (the tick shows right away while Zapier works in the background) and every added item can be undone at any time.

Every created event or task counts against the Zapier free-plan task quota. Rehearse with Mock mode on; switch it off for the real run.
