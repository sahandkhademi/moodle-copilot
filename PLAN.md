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
| Google | `chrome.identity.getAuthToken` + Google Calendar API + Google Tasks API | Native OAuth inside extensions |
| Google fallback | "Add to Google Calendar" template links + `.ics` download | Zero setup, still works if OAuth fights back |
| Demo safety | `MOCK_MODE` toggle with realistic seed data (courses, grades, attendance, deadlines) | The demo can't break |

```
┌──────────── Chrome ────────────┐
│ Moodle tab   │  Side panel      │
│ (logged in)  │  ├─ Chat         │──► Claude API (tool use)
│              │  ├─ Dashboard    │
│              │  └─ Settings     │──► Google Calendar / Tasks
│  content     │                  │
│  script ◄────┤ background SW    │──► Moodle AJAX / HTML (session cookie)
└──────────────┴──────────────────┘
```

---

## Phase 1 — Foundation (must have)

- [ ] **1.1 Scaffold**: WXT + React + TS + Tailwind; side panel opens from the toolbar icon; loads unpacked in `chrome://extensions`
- [ ] **1.2 Settings page**: Moodle base URL, Claude API key, mock-mode toggle, language (DE/EN)
- [ ] **1.3 Mock data layer**: `src/data/mock.ts` with ~5 courses (incl. *Logik*), grades, attendance, 10+ deadlines spread over the next 3 weeks. Same TypeScript interface as the real layer
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
- [ ] **2.2 Deadline dashboard**
  - Timeline grouped into *Overdue / Today / This week / Later*, color-coded by urgency
  - Course filter, "mark done" (local), countdown badges
  - Toolbar icon badge = number of deadlines in the next 48 h

## Phase 3 — Google integration

- [ ] **3.1 Fallback first**: "Add to Calendar" button per deadline (template URL) + "Export all as .ics"
- [ ] **3.2 Google OAuth**: Cloud project, OAuth client of type *Chrome extension*, pinned extension ID (`key` in manifest), our own account as test user
- [ ] **3.3 Sync to Google Calendar**: one-click "Sync all deadlines", no duplicates (store the Moodle-event-ID → Google-event-ID mapping)
- [ ] **3.4 Google Tasks**: create a task list *"Moodle"*, one task per assignment with its due date and link
- [ ] **3.5 Ask the chat to do it**: "Put my logic exam in my calendar", "Make tasks for everything due this week" (Google actions as Claude tools, with a confirmation card before writing)

## Phase 4 — Wow features (pick by time left, in this order)

- [ ] **4.1 Grade calculator** — "What do I need on the final to get a 2?" Uses the Austrian 1–5 scale and the course weighting
- [ ] **4.2 Attendance guard** — warns when you're close to the absence limit ("2 more absences in Logik and you fail it")
- [ ] **4.3 Page-aware context** — the side panel knows which Moodle page you're on: "Summarize this assignment", "What does this task actually want?"
- [ ] **4.4 Study planner** — before an exam, Claude proposes study blocks and puts them in free slots in Google Calendar
- [ ] **4.5 Morning briefing** — one card: today's classes, what's due, new grades, new announcements
- [ ] **4.6 Course-material Q&A** — ask about a lecture PDF ("Explain slide 12 of week 5"); Claude reads the PDF as a document
- [ ] **4.7 Quiz me** — generate flashcards / practice questions from course material
- [ ] **4.8 Voice input** — mic button using the Web Speech API (great on stage)
- [ ] **4.9 New-stuff alerts** — background check every 30 min, notification on a new grade or announcement
- [ ] **4.10 Email the teacher** — draft a polite extension request or question in German, shown for review, never sent automatically
- [ ] **4.11 Workload heatmap** — calendar heatmap of how busy each week is

## Phase 5 — Demo polish

- [ ] **5.1 Branding**: name, icon, color theme, dark mode
- [ ] **5.2 Seed the mock data** for the demo story (a failed-ish logic test, an attendance warning, 3 deadlines this week)
- [ ] **5.3 Demo script** (below) rehearsed twice, with mock mode on *and* off
- [ ] **5.4 Backup**: screen recording of the full demo in case Wi-Fi or the API dies
- [ ] **5.5 Pitch slides**: problem → demo → how it works → what's next

---

## Demo script (≈3 min)

1. **Problem (20 s)**: show the click maze — Moodle → course → grades → scroll. "Seven clicks to see one grade."
2. **Side panel (40 s)**: open it next to Moodle. Ask *"How did I do in the last logic test?"* → answer with the grade, the class average and a link.
3. **Follow-up (20 s)**: *"What do I need on the final to pass?"* (grade calculator)
4. **Dashboard (40 s)**: everything due, color-coded; the attendance warning pops out.
5. **Google (40 s)**: *"Put everything due this week in my calendar and make tasks for it"* → confirmation card → switch to Google Calendar/Tasks and show it there.
6. **Close (20 s)**: voice question or morning briefing, then what's next.

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
