# Moodle Copilot — Hackathon Plan (FestDev 26)

> Working name. Alternatives: *StudyPilot*, *Moodle Mate*, *Yotkao Buddy*.

**One-liner:** A Chrome side-panel extension for Yotkao's Moodle. Ask it questions ("How did I do on the last logic test?"), see every upcoming deadline in one dashboard, and push deadlines to Google Calendar and Google Tasks.

**Ground rule: the demo comes first.** It only needs to run on one laptop. Every feature has a **mock-data fallback**, so the live demo never depends on Moodle, Google or the network being well-behaved.

Work through this file top to bottom. Tick each box when it's done **and committed**.

---

## 0. Architecture (decided once, then left alone)

| Piece | Choice | Why |
|---|---|---|
| Extension framework | **WXT** (wxt.dev) + **React** + **TypeScript** + **Tailwind** | Manifest V3, side-panel support, hot reload, minimal setup |
| UI surface | `chrome.sidePanel` (stays open next to Moodle) + a full-tab dashboard page | Matches "sidebar thing on the side" |
| Moodle data | Reuse the **logged-in browser session**: call Moodle's own AJAX endpoint `/lib/ajax/service.php?sesskey=…` (the one Moodle's own UI uses). Fall back to scraping HTML pages (grades, attendance) | No API token or admin access needed |
| AI | **Claude API** (`@anthropic-ai/sdk`, model `claude-opus-5-5`, low effort for snappy chat) with **tool use**: the model calls `getGrades`, `getDeadlines`, `getAttendance`, … and we run them against Moodle | Answers come from real data, not guesses |
| API key | Pasted into the extension's options page, kept in `chrome.storage.local` | Fine for a local demo. **Never commit it** |
| Google | **Zapier MCP**: Google Calendar + Google Tasks actions enabled once on zapier.com. Claude reaches them through the API's **MCP connector** (`mcp_servers` + `mcp_toolset`, beta `mcp-client-2025-11-20`) | No Google Cloud project, no OAuth screens, no files to download. The user clicks, it shows up in their calendar |
| Google fallback | None in the UI. If Zapier fails during the demo, switch to mock mode, which fakes a "✓ added" | The user never downloads anything or does a manual step |
| Demo safety | `MOCK_MODE` toggle with realistic seed data (courses, grades, attendance, deadlines) | The demo can't break |

```
┌──────────── Chrome ────────────┐
│ Moodle tab   │  Side panel      │
│ (logged in)  │  ├─ Chat         │──► Claude API (tool use)
│              │  ├─ Dashboard    │
│              │  └─ Settings     │   (Claude ──► Zapier MCP ──► Google Calendar / Tasks)
│  content     │                  │
│  script ◄────┤ background SW    │──► Moodle AJAX / HTML (session cookie)
└──────────────┴──────────────────┘
```

---

## Phase 1 — Foundation (must have)

- [x] **1.1 Scaffold**: WXT + React + TS + Tailwind; side panel opens from the toolbar icon; loads unpacked in `chrome://extensions`
- [x] **1.2 Settings page**: Moodle base URL, Claude API key, mock-mode toggle, language (DE/EN)
- [x] **1.3 Mock data layer**: `src/data/mock.ts` with ~5 courses (incl. *Logik*), grades, attendance, 10+ deadlines spread over the next 3 weeks. Same TypeScript interface as the real layer
- [ ] **1.4 Moodle spike** (time-box 45 min): on the real Moodle, confirm which calls work with the session:
  - `core_course_get_enrolled_courses_by_timeline_classification` → courses
  - `core_calendar_get_action_events_by_timesort` → deadlines
  - grades → AJAX if allowed, else scrape `grade/report/user/index.php?id=…`
  - attendance (`mod_attendance`) → scrape the attendance view page
  - Write down what worked here ⤵︎ and pick real or mock per data type
- [ ] **1.5 Moodle data layer**: `getCourses()`, `getDeadlines()`, `getGrades(courseId)`, `getAttendance(courseId)`, cached in `chrome.storage`

## Phase 2 — The two hero features

- [ ] **2.1 AI chat in the side panel**
  - Chat UI: streaming answers, markdown, suggested-question chips ("What's due this week?", "How did I do in Logik?", "Am I at risk anywhere for attendance?")
  - Claude tool-use loop over the data-layer functions
  - System prompt: student assistant, answers briefly, replies in the user's language, cites the course and links to the Moodle page
- [x] **2.2 Deadline dashboard**
  - Timeline grouped into *Overdue / Today / This week / Later*, color-coded by urgency
  - Course filter, "mark done" (local), countdown badges
  - Toolbar icon badge = number of deadlines in the next 48 h

## Phase 3 — Google integration (via Zapier MCP)

Principle: **one click or one sentence, and it's in Google.** No downloads, no copy-paste, no extra tabs.

- [x] **3.1 Zapier setup (one time, ~10 min)**: on zapier.com, create an MCP server and enable *Google Calendar: Create Detailed Event*, *Google Calendar: Find Event* and *Google Tasks: Create Task*, connected to our Google account. Paste the MCP server URL and token into the extension's settings
- [x] **3.2 MCP connector in the chat**: add the Zapier server to the Claude request (`mcp_servers` + `mcp_toolset`, beta `mcp-client-2025-11-20`). Check that Claude can list and call the Zapier tools
- [ ] **3.3 Ask the chat to do it**: "Put my logic exam in my calendar", "Make tasks for everything due this week". Show a confirmation card listing what will be created, then one tap writes it
- [x] **3.4 One-click buttons on the dashboard**: "📅 Add to Calendar" per deadline and "Sync all to Calendar + Tasks" at the top. They run the same Zapier tools, so no typing is needed
- [x] **3.5 No duplicates**: store Moodle-event-ID → "synced" locally, and use *Find Event* before creating. Show a ✓ on deadlines that are already synced
- [ ] *(only if Zapier blocks us)* **3.6 Direct Google APIs** through `chrome.identity` OAuth, as plan B. Skip otherwise

> Watch the Zapier free-plan task limit: every create counts. Use mock mode while rehearsing, and switch to live Zapier for the real run.

## Phase 4 — Committed extras (must ship, all in the demo)

- [x] **4.1 Grade calculator** — "What do I need on the final to get a 2?"
  - Austrian scale: 1 Sehr gut, 2 Gut, 3 Befriedigend, 4 Genügend, 5 Nicht genügend. Percentage cut-offs are configurable per course (default 1 ≥ 89 %, 2 ≥ 76 %, 3 ≥ 63 %, 4 ≥ 50 %)
  - Uses the course's grade items and weights from Moodle and does the math **in code** (a Claude tool `calculateNeededScore`), so the numbers are always right. Claude only explains the result
  - Answers like: "You need 34/50 (68 %) on the final for a 2. A 1 is no longer possible."
  - Small "what if" slider on the course's grade card in the dashboard
- [x] **4.2 Absence warning**
  - Per course: absences so far, the limit (default 20 % of sessions, configurable), and how many absences are left
  - Color states: 🟢 safe · 🟠 one or two absences left · 🔴 over the limit
  - Shows up by itself: a banner at the top of the dashboard, mentioned by the chat when relevant, and a Chrome notification when a course turns 🟠
- [ ] **4.3 Voice input**
  - Mic button in the chat (Web Speech API, `de-AT` and `en-US`). Speak, and it sends when you stop talking. No typing
  - Optional: read the answer aloud (`speechSynthesis`), with a toggle
  - Fallback if the mic is blocked: the button hides itself and typing still works
- [x] **4.4 New-grade notifications**
  - Background check every 15 min (`chrome.alarms`). Compare with the last saved grades
  - New grade → Chrome notification "📊 New grade in Logik: 2 (82 %)". Clicking it opens the side panel on that grade
  - Red dot on the toolbar icon until you've seen it
  - Demo trigger: a hidden "simulate new grade" button in mock mode, so it fires on cue

## Phase 5 — Nice to have (pick by time left, in this order)

- [ ] **5.1 Page-aware context** — the side panel knows which Moodle page you're on: "Summarize this assignment", "What does this task actually want?"
- [ ] **5.2 Study planner** — before an exam, Claude proposes study blocks and puts them in free slots in Google Calendar
- [ ] **5.3 Morning briefing** — one card: today's classes, what's due, new grades, new announcements
- [ ] **5.4 Course-material Q&A** — ask about a lecture PDF ("Explain slide 12 of week 5"); Claude reads the PDF as a document
- [ ] **5.5 Quiz me** — generate flashcards / practice questions from course material
- [ ] **5.6 Email the teacher** — draft a polite extension request or question in German, shown for review, never sent automatically
- [ ] **5.7 Workload heatmap** — calendar heatmap of how busy each week is

## Phase 6 — Demo polish

- [ ] **6.1 Branding**: name, icon, color theme, dark mode
- [ ] **6.2 Seed the mock data** for the demo story: a so-so logic test, a final still to come, Logik at 🟠 on absences, 3 deadlines this week, one grade queued for the "new grade" notification
- [ ] **6.3 Demo script** (below) rehearsed twice, with mock mode on *and* off
- [ ] **6.4 Backup**: screen recording of the full demo in case Wi-Fi or the API dies
- [ ] **6.5 Pitch slides**: problem → demo → how it works → what's next

---

## Demo script (≈3½ min)

1. **Problem (20 s)**: show the click maze — Moodle → course → grades → scroll. "Seven clicks to see one grade."
2. **Voice question (40 s)**: open the side panel next to Moodle, tap the mic and *say* "How did I do in the last logic test?" → answer with the grade, the class average and a link.
3. **Grade calculator (25 s)**: say *"What do I need on the final to get a 2?"* → "34/50 (68 %)". Drag the what-if slider on the course card.
4. **Dashboard + absence warning (40 s)**: everything due, color-coded. The 🟠 banner: "Logik: 1 absence left before you fail on attendance."
5. **Google (40 s)**: *"Put everything due this week in my calendar and make tasks for it"* → confirmation card → one tap → switch to Google Calendar/Tasks: it's already there. No file, no setup.
6. **New-grade notification (20 s)**: while talking, the cued "new grade" fires: "📊 New grade in Logik". Click it → the side panel opens on it. "You don't even have to check Moodle anymore."
7. **Close (20 s)**: what's next (page-aware help, study planner).

---

## Commit & safety rules

- Commit after **every** box that works, message `feat(1.3): mock data layer` (box number in the scope)
- Commit WIP before any risky change: `wip: …`
- Before demo day, tag the known-good state: `git tag demo-ready`
- Secrets (API keys, OAuth client secrets, `.pem` files) never go into git. `.gitignore` already covers them

## Spike notes (fill in during 1.4)

| Data | Works via | Notes |
|---|---|---|
| Courses | ? | |
| Deadlines | ? | |
| Grades | ? | |
| Attendance | ? | |
