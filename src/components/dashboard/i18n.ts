// Tiny local de/en dictionary for the dashboard.
export type Lang = 'de' | 'en';

type Vars = Record<string, string | number>;
const S = {
  overdue: { de: 'Überfällig', en: 'Overdue' },
  today: { de: 'Heute', en: 'Today' },
  week: { de: 'Diese Woche', en: 'This week' },
  later: { de: 'Später', en: 'Later' },
  dueWeek: { de: '{n} fällig diese Woche', en: '{n} due this week' },
  overdueN: { de: '{n} überfällig', en: '{n} overdue' },
  allClear: { de: 'Alles erledigt 🎉', en: 'All clear 🎉' },
  all: { de: 'Alle', en: 'All' },
  doneN: { de: '{n} erledigt', en: '{n} done' },
  hideDone: { de: 'Erledigte ausblenden', en: 'Hide done' },
  markDone: { de: 'Als erledigt markieren', en: 'Mark as done' },
  courses: { de: 'Kurse & Noten', en: 'Courses & grades' },
  deadlines: { de: 'Deadlines', en: 'Deadlines' },
  noGrade: { de: 'Noch keine Note', en: 'No grade yet' },
  graded: { de: 'Bewertet', en: 'Graded' },
  ask: { de: 'Fragen', en: 'Ask' },
  askPrompt: { de: 'Wie stehe ich in {course}?', en: 'How am I doing in {course}?' },
  absLeft1: { de: '{c}: noch 1 Fehlstunde erlaubt', en: '{c}: 1 absence left' },
  absLeftN: { de: '{c}: noch {n} Fehlstunden erlaubt', en: '{c}: {n} absences left' },
  absZero: { de: '{c}: keine Fehlstunde mehr erlaubt', en: '{c}: no absences left' },
  absOver: { de: '{c}: Limit überschritten', en: '{c}: limit exceeded' },
  attendance: { de: '{a} von {b} erlaubten Fehlstunden', en: '{a} of {b} allowed absences' },
  attendanceOver: { de: '{a} Fehlstunden, nur {b} erlaubt', en: '{a} absences, only {b} allowed' },
  whatIf: { de: 'Was wäre wenn', en: 'What if' },
  whatIfHint: { de: 'Ich schaffe {p} % bei den restlichen Leistungen', en: 'I score {p}% on everything left' },
  projected: { de: 'Endnote', en: 'Final grade' },
  secured: { de: 'Eine {g} ist dir sicher.', en: 'A {g} is secured.' },
  needOne: { de: 'Für einen {g}er brauchst du {p} % ({pts}/{max}) bei: {name}', en: 'For a {g} you need {p}% ({pts}/{max}) on: {name}' },
  needMany: { de: 'Für einen {g}er brauchst du {p} % im Schnitt bei den restlichen Leistungen', en: 'For a {g} you need {p}% on average on the remaining items' },
  impossible: { de: 'Eine {g} ist nicht mehr möglich. Beste erreichbare Note: {b}', en: 'A {g} is out of reach. Best possible: {b}' },
  final: { de: 'Alle Leistungen bewertet. Endnote: {g}', en: 'Everything graded. Final grade: {g}' },
  open: { de: 'Offen', en: 'Open' },
  classAvg: { de: 'Ø Klasse {p} %', en: 'Class avg {p}%' },
  noCourses: { de: 'Keine Daten gefunden', en: 'No data found' },
  noCoursesHint: { de: 'Aktiviere den Demo-Modus oder prüfe die Moodle-URL in den Einstellungen.', en: 'Enable demo mode or check the Moodle URL in settings.' },
  empty: { de: 'Keine Deadlines. Genieß es!', en: 'No deadlines. Enjoy!' },
  inDays: { de: 'in {n} Tagen', en: 'in {n} days' },
  tomorrow: { de: 'morgen {t}', en: 'tomorrow {t}' },
  todayAt: { de: 'heute {t}', en: 'today {t}' },
  agoH: { de: 'vor {n} Std.', en: '{n}h ago' },
  yesterday: { de: 'seit gestern', en: 'since yesterday' },
  sinceDays: { de: 'seit {n} Tagen', en: 'for {n} days' },
} as const;

export type Key = keyof typeof S;
export function makeT(lang: Lang) {
  return (key: Key, vars: Vars = {}) => S[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
export type T = ReturnType<typeof makeT>;
