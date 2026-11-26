// Austrian 1–5 grading math (feature 4.1). Pure functions: the numbers come from code, never from the LLM.
import type { GradeItem } from './types';
import type { GradeCutoffs } from './settings';

export type AustrianGrade = 1 | 2 | 3 | 4 | 5;

export const GRADE_LABELS: Record<AustrianGrade, { de: string; en: string }> = {
  1: { de: 'Sehr gut', en: 'Excellent' },
  2: { de: 'Gut', en: 'Good' },
  3: { de: 'Befriedigend', en: 'Satisfactory' },
  4: { de: 'Genügend', en: 'Sufficient' },
  5: { de: 'Nicht genügend', en: 'Fail' },
};

/** percent: 0..100 */
export function percentToGrade(percent: number, cutoffs: GradeCutoffs): AustrianGrade {
  if (percent >= cutoffs[1]) return 1;
  if (percent >= cutoffs[2]) return 2;
  if (percent >= cutoffs[3]) return 3;
  if (percent >= cutoffs[4]) return 4;
  return 5;
}

export interface CourseStanding {
  /** Weighted percent earned so far, out of the whole course (0..100). */
  earnedPercent: number;
  /** Share of the course already graded (0..1). */
  gradedWeight: number;
  /** Average over graded items only (0..100), i.e. "how am I doing so far". */
  currentPercent: number | null;
  currentGrade: AustrianGrade | null;
  remaining: GradeItem[];
}

export function courseStanding(items: GradeItem[], cutoffs: GradeCutoffs): CourseStanding {
  let earned = 0;
  let gradedWeight = 0;
  const remaining: GradeItem[] = [];
  for (const it of items) {
    if (it.score == null) {
      remaining.push(it);
      continue;
    }
    earned += it.weight * (it.score / it.maxScore);
    gradedWeight += it.weight;
  }
  const currentPercent = gradedWeight > 0 ? (earned / gradedWeight) * 100 : null;
  return {
    earnedPercent: earned * 100,
    gradedWeight,
    currentPercent,
    currentGrade: currentPercent == null ? null : percentToGrade(currentPercent, cutoffs),
    remaining,
  };
}

export interface NeededResult {
  target: AustrianGrade;
  targetPercent: number;
  /** Average percent needed across all remaining items (0..100+). */
  neededPercent: number;
  status: 'secured' | 'possible' | 'impossible';
  /** Points needed per remaining item, at that average. */
  perItem: { item: GradeItem; neededPoints: number }[];
}

/** What average do I need on everything still ungraded to reach `target`? */
export function neededForGrade(items: GradeItem[], target: AustrianGrade, cutoffs: GradeCutoffs): NeededResult {
  const targetPercent = target === 5 ? 0 : cutoffs[target as 1 | 2 | 3 | 4];
  const s = courseStanding(items, cutoffs);
  const remainingWeight = s.remaining.reduce((a, it) => a + it.weight, 0);
  const gap = targetPercent - s.earnedPercent;
  let neededPercent: number;
  let status: NeededResult['status'];
  if (gap <= 0) {
    neededPercent = 0;
    status = 'secured';
  } else if (remainingWeight <= 0) {
    neededPercent = Infinity;
    status = 'impossible';
  } else {
    neededPercent = gap / remainingWeight;
    status = neededPercent > 100 ? 'impossible' : 'possible';
  }
  return {
    target,
    targetPercent,
    neededPercent,
    status,
    perItem: s.remaining.map((item) => ({
      item,
      neededPoints: Number.isFinite(neededPercent) ? Math.ceil((item.maxScore * Math.max(0, neededPercent)) / 100 * 2) / 2 : Infinity,
    })),
  };
}

/** Final grade if you score `hypotheticalPercent` on every remaining item (what-if slider). */
export function projectedGrade(items: GradeItem[], hypotheticalPercent: number, cutoffs: GradeCutoffs) {
  const s = courseStanding(items, cutoffs);
  const remainingWeight = s.remaining.reduce((a, it) => a + it.weight, 0);
  const finalPercent = s.earnedPercent + remainingWeight * hypotheticalPercent;
  return { finalPercent, grade: percentToGrade(finalPercent, cutoffs) };
}
