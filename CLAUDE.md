# Moodle Copilot — FestDev 26 hackathon

Chrome side-panel extension for Yotkao's Moodle: AI chat over your Moodle data, a deadline dashboard, and Google Calendar/Tasks sync. Full plan and build order: `PLAN.md`.

## Priorities
- **The demo is what matters.** It only has to run on this laptop. Choose whatever gets a working, good-looking demo fastest over anything "production-grade".
- Every feature needs a mock-data fallback (`MOCK_MODE`) so the demo can't break.
- **Zero friction for the user.** The whole point is to be easier and faster than Moodle. No file downloads, no copy-paste, no "now go to this other site" steps. One click or one sentence, then it's done.
- Work through `PLAN.md` box by box. Tick a box (`- [x]`) when it works, in the same commit as the work.

## Commits — no work gets lost
- Commit after every working step, small and often. Message format: `feat(<plan box>): <what>`, e.g. `feat(2.1): streaming chat UI`. Use `fix(...)`, `chore(...)`, `docs(...)` as needed.
- Before a risky refactor or a big generated change, commit the current state first (`wip: ...`).
- Never leave a session with uncommitted working code.
- If a GitHub remote is set up, push after each commit.
- Never commit secrets: API keys, OAuth client secrets, `.env`, `.pem`.

## Stack
WXT + React + TypeScript + Tailwind, Manifest V3, `chrome.sidePanel`. Claude via `@anthropic-ai/sdk` (model `claude-opus-5-5`) with tool use. Google Calendar and Google Tasks via **Zapier MCP**, which Claude calls through the API's MCP connector (no Google OAuth, no .ics files).

## Parallel branches
Features are built on separate branches (`feat/chat`, `feat/dashboard`, `feat/google-zapier`, `feat/notifications`, `feat/moodle-data`) and merged into `main`.
- Shared contracts live on main and are only changed there: `src/lib/types.ts`, `storage.ts` (KEYS), `settings.ts`, `grading.ts`, `attendance.ts`, `data/index.ts`, `sidepanel/App.tsx`.
- Each branch stays in its own folders. If a branch truly needs a contract change, keep it additive (new optional field / new key) and say so in the commit message.
- Check before committing: `npm run compile && npm run build`.
