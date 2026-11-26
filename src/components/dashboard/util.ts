import type { AustrianGrade } from '@/lib/grading';
import type { DeadlineType } from '@/lib/types';
import type { Lang, T } from './i18n';

export const TYPE_ICON: Record<DeadlineType, string> = { assignment: '📝', quiz: '❓', exam: '🎓', event: '📌' };

export const localeOf = (lang: Lang) => (lang === 'de' ? 'de-AT' : 'en-US');
export const num = (lang: Lang, n: number, digits = 1) => n.toLocaleString(localeOf(lang), { maximumFractionDigits: digits });

// Static class strings so Tailwind picks them up.
const PALETTE = [
  { pill: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300', grad: 'from-violet-500 to-fuchsia-500' },
  { pill: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', grad: 'from-sky-500 to-cyan-500' },
  { pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', grad: 'from-emerald-500 to-teal-500' },
  { pill: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', grad: 'from-rose-500 to-pink-500' },
  { pill: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', grad: 'from-amber-500 to-orange-500' },
  { pill: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300', grad: 'from-indigo-500 to-blue-500' },
];
export const courseColor = (courseId: number) => PALETTE[Math.abs(courseId) % PALETTE.length]!;

export const GRADE_STYLE: Record<AustrianGrade, { badge: string; bar: string; text: string }> = {
  1: { badge: 'bg-emerald-500 text-white', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  2: { badge: 'bg-lime-500 text-white', bar: 'bg-lime-500', text: 'text-lime-600 dark:text-lime-400' },
  3: { badge: 'bg-amber-400 text-amber-950', bar: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400' },
  4: { badge: 'bg-orange-500 text-white', bar: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400' },
  5: { badge: 'bg-red-500 text-white', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
};

export type Bucket = 'overdue' | 'today' | 'week' | 'later';
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const dayDiff = (due: Date, now: Date) => Math.round((startOfDay(due) - startOfDay(now)) / 86400000);

export function bucketOf(dueIso: string, now: Date): Bucket {
  const due = new Date(dueIso);
  if (due.getTime() < now.getTime()) return 'overdue';
  const d = dayDiff(due, now);
  return d === 0 ? 'today' : d <= 7 ? 'week' : 'later';
}

export const STRIPE = {
  overdue: 'bg-red-500',
  soon: 'bg-orange-500',
  week: 'bg-yellow-400',
  later: 'bg-slate-300 dark:bg-slate-600',
} as const;
export function urgency(dueIso: string, now: Date): keyof typeof STRIPE {
  const ms = new Date(dueIso).getTime() - now.getTime();
  if (ms < 0) return 'overdue';
  if (ms < 48 * 3600000) return 'soon';
  return dayDiff(new Date(dueIso), now) <= 7 ? 'week' : 'later';
}

export function countdown(dueIso: string, now: Date, t: T, lang: Lang): string {
  const due = new Date(dueIso);
  const time = due.toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit', hour12: lang === 'en' });
  const d = dayDiff(due, now);
  if (due.getTime() < now.getTime()) {
    if (d === 0) return t('agoH', { n: Math.max(1, Math.round((now.getTime() - due.getTime()) / 3600000)) });
    return d === -1 ? t('yesterday') : t('sinceDays', { n: -d });
  }
  if (d === 0) return t('todayAt', { t: time });
  if (d === 1) return t('tomorrow', { t: time });
  return t('inDays', { n: d });
}
