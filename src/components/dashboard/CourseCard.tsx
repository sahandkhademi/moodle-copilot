import { useState } from 'react';
import type { AttendanceRecord, Course, GradeItem } from '@/lib/types';
import type { Settings } from '@/lib/settings';
import { courseStanding, GRADE_LABELS, neededForGrade, projectedGrade, type AustrianGrade } from '@/lib/grading';
import { ABSENCE_EMOJI, absenceStatus } from '@/lib/attendance';
import { KEYS, setItem } from '@/lib/storage';
import type { Lang, T } from './i18n';
import { courseColor, GRADE_STYLE, num } from './util';

interface Props {
  course: Course;
  items: GradeItem[];
  attendance?: AttendanceRecord;
  settings: Settings;
  lang: Lang;
  t: T;
  open: boolean;
  onToggle(): void;
  highlightGradeId: string | null;
  cardRef(el: HTMLElement | null): void;
}

const ABS_BAR = { safe: 'bg-emerald-500', warning: 'bg-orange-500', over: 'bg-red-500' } as const;
const ABS_RING = {
  safe: '',
  warning: 'ring-1 ring-orange-300/70 dark:ring-orange-500/40',
  over: 'ring-1 ring-red-300/70 dark:ring-red-500/40',
} as const;

function GradeBadge({ grade, size = 'md' }: { grade: AustrianGrade | null; size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-11 w-11 text-xl' : 'h-9 w-9 text-lg';
  if (grade == null) return <div className={`grid ${dim} place-items-center rounded-xl bg-slate-100 font-bold text-slate-400 dark:bg-slate-800`}>–</div>;
  return <div className={`grid ${dim} place-items-center rounded-xl font-bold shadow-sm ${GRADE_STYLE[grade].badge}`}>{grade}</div>;
}

export default function CourseCard({ course, items, attendance, settings, lang, t, open, onToggle, highlightGradeId, cardRef }: Props) {
  const cutoffs = settings.gradeCutoffs;
  const standing = courseStanding(items, cutoffs);
  const col = courseColor(course.id);
  const graded = items.filter((i) => i.score != null);
  const abs = attendance ? absenceStatus(attendance, settings.absenceLimit) : null;

  const [whatIf, setWhatIf] = useState<number | null>(null);
  const wi = whatIf ?? Math.round(standing.currentPercent ?? 70);
  const proj = projectedGrade(items, wi, cutoffs);
  const pct = (n: number) => num(lang, n, 1);

  // "What do I need?" line: next better grade than the current one.
  let need: { tone: 'good' | 'info' | 'bad'; text: string } | null = null;
  if (standing.remaining.length === 0) {
    if (standing.currentGrade) need = { tone: 'info', text: t('final', { g: standing.currentGrade }) };
  } else {
    const target = (standing.currentGrade && standing.currentGrade > 1 ? standing.currentGrade - 1 : 1) as AustrianGrade;
    const r = neededForGrade(items, target, cutoffs);
    if (r.status === 'secured') need = { tone: 'good', text: t('secured', { g: target }) };
    else if (r.status === 'possible') {
      need =
        r.perItem.length === 1
          ? { tone: 'info', text: t('needOne', { g: target, p: pct(r.neededPercent), pts: pct(r.perItem[0]!.neededPoints), max: r.perItem[0]!.item.maxScore, name: r.perItem[0]!.item.name }) }
          : { tone: 'info', text: t('needMany', { g: target, p: pct(r.neededPercent) }) };
    } else need = { tone: 'bad', text: t('impossible', { g: target, b: projectedGrade(items, 100, cutoffs).grade }) };
  }
  const needTone = {
    good: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300',
    info: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100',
    bad: 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300',
  };

  const ask = () =>
    setItem(KEYS.focus, { tab: 'chat', chatPrompt: t('askPrompt', { course: course.fullname }), at: Date.now() });

  return (
    <article
      ref={cardRef}
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow dark:border-slate-800 dark:bg-slate-900 ${abs ? ABS_RING[abs.state] : ''}`}
    >
      <div className={`h-1 bg-gradient-to-r ${col.grad}`} />
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={open}>
        <GradeBadge grade={standing.currentGrade} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-px text-[10px] font-semibold tracking-wide ${col.pill}`}>{course.shortname}</span>
            {abs && abs.state !== 'safe' && <span title={t('attendance', { a: abs.absences, b: abs.allowed })}>{ABSENCE_EMOJI[abs.state]}</span>}
          </div>
          <div className="truncate font-semibold tracking-tight">{course.fullname}</div>
          <div className="text-xs text-slate-500">
            {standing.currentGrade ? `${GRADE_LABELS[standing.currentGrade][lang]} · ${pct(standing.currentPercent ?? 0)} %` : t('noGrade')}
          </div>
        </div>
        <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 p-3 dark:border-slate-800">
          {need && <p className={`rounded-lg px-3 py-2 text-[13px] leading-snug ${needTone[need.tone]}`}>{need.text}</p>}

          {/* Graded items */}
          <ul className="space-y-1">
            {graded.map((it) => {
              const p = (it.score! / it.maxScore) * 100;
              const avg = it.classAverage != null ? (it.classAverage / it.maxScore) * 100 : null;
              const hl = highlightGradeId === it.id;
              return (
                <li
                  key={it.id}
                  id={`grade-${it.id}`}
                  className={`rounded-lg px-2 py-1.5 transition-all duration-500 ${hl ? 'bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-500/10' : ''}`}
                >
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate">{it.name}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="font-semibold">{num(lang, it.score!)}</span>
                      <span className="text-slate-400">/{num(lang, it.maxScore)}</span>
                      <span className="ml-1.5 text-xs text-slate-500">{pct(p)} %</span>
                    </span>
                  </div>
                  <div className="relative mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-full rounded-full ${GRADE_STYLE[gradeColorIdx(p, cutoffs)].bar}`} style={{ width: `${Math.min(100, p)}%` }} />
                    {avg != null && <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-slate-600 dark:bg-slate-300" style={{ left: `${Math.min(100, avg)}%` }} />}
                  </div>
                  {avg != null && <div className="mt-0.5 text-[10px] text-slate-400">{t('classAvg', { p: pct(avg) })}</div>}
                </li>
              );
            })}
            {standing.remaining.map((it) => (
              <li key={it.id} className="flex items-baseline justify-between px-2 py-1 text-[13px] text-slate-400">
                <span className="truncate">{it.name}</span>
                <span className="shrink-0 text-xs">{t('open')} · {num(lang, Math.round(it.weight * 100), 0)} %</span>
              </li>
            ))}
          </ul>

          {/* What-if */}
          {standing.remaining.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('whatIf')}</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{t('projected')}</span>
                  <GradeBadge grade={proj.grade} />
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={wi}
                onChange={(e) => setWhatIf(Number(e.target.value))}
                className="mt-2 w-full accent-brand-500"
                aria-label={t('whatIf')}
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>{t('whatIfHint', { p: wi })}</span>
                <span className="tabular-nums">
                  {GRADE_LABELS[proj.grade][lang]} · {pct(proj.finalPercent)} %
                </span>
              </div>
            </div>
          )}

          {/* Attendance */}
          {abs && (
            <div>
              <div className="flex items-center gap-1.5 text-[13px]">
                <span>{ABSENCE_EMOJI[abs.state]}</span>
                <span>{abs.state === 'over' ? t('attendanceOver', { a: abs.absences, b: abs.allowed }) : t('attendance', { a: abs.absences, b: abs.allowed })}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <div className={`h-full rounded-full ${ABS_BAR[abs.state]}`} style={{ width: `${abs.allowed > 0 ? Math.min(100, (abs.absences / abs.allowed) * 100) : 100}%` }} />
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={ask} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-600">
              💬 {t('ask')}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function gradeColorIdx(percent: number, cutoffs: Settings['gradeCutoffs']): AustrianGrade {
  if (percent >= cutoffs[1]) return 1;
  if (percent >= cutoffs[2]) return 2;
  if (percent >= cutoffs[3]) return 3;
  if (percent >= cutoffs[4]) return 4;
  return 5;
}
