# Moodle Copilot

FestDev 26 hackathon project: a Chrome side-panel assistant for Yotkao's Moodle.

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
3. Settings → paste a Claude API key. Demo data is on by default.

`npm run dev` opens a separate Chrome with the extension loaded and hot reload.

## Code map

| Path | What |
|---|---|
| `src/lib/types.ts` | Shared data model (courses, grades, attendance, deadlines) |
| `src/lib/data/` | `getData()` → mock or real Moodle, with fallback to mock |
| `src/lib/grading.ts` | Austrian 1–5 math: standing, "what do I need", what-if |
| `src/lib/attendance.ts` | Absence limit math |
| `src/lib/settings.ts`, `storage.ts` | Settings + shared storage keys |
| `src/lib/ai/client.ts` | Claude client |
| `src/lib/google/sync.ts` | Google Calendar/Tasks via Zapier MCP |
| `src/components/*` | Chat, Dashboard, Settings, Google buttons |
| `src/entrypoints/` | Side panel + background service worker |

## Zapier setup (one time)

Google Calendar and Google Tasks are reached through a Zapier MCP server, so there is no Google OAuth screen.

1. Go to [mcp.zapier.com](https://mcp.zapier.com) and create a new MCP server (client: "Other" / "Anthropic API").
2. Add these three actions: **Google Calendar: Create Detailed Event**, **Google Calendar: Find Event(s)**, **Google Tasks: Create Task**.
3. When asked, connect your Google account for each action.
4. Copy the server URL (and the token, if one is shown separately).
5. In the extension: Settings, turn **Mock mode** off, paste the URL into "Zapier MCP server URL" (token optional), press "Verbindung testen". You should see the tool names.

Every created event or task counts against the Zapier free-plan task quota. Rehearse with Mock mode on; switch it off for the real run.
