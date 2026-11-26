// "Working" steps shown while the assistant answers, picked to match the question.
// Pure function so it is easy to tweak and test.

export interface StepScript {
  kind: 'grade' | 'needed' | 'deadlines' | 'absence' | 'google' | 'general';
  steps: string[];
}

const STOP = new Set(['I', 'Am', 'What', 'How', 'Do', 'Did', 'Is', 'Are', 'When', 'Where', 'Which', 'Can', 'Put', 'Make', 'Show', 'Tell', 'Google', 'Calendar', 'Tasks', 'Moodle', 'Copilot']);

/** "How did I do in my last Logic test?" → "Logic". Picks capitalised words that look like a course name. */
export function courseFromQuestion(q: string): string | null {
  const words = q.match(/\b[A-Z][A-Za-z0-9-]+(?:\s+(?:for\s+)?[A-Z][A-Za-z0-9-]+)*/g) ?? [];
  const hit = words.map((w) => w.trim()).find((w) => !STOP.has(w.split(/\s+/)[0]!));
  return hit ?? null;
}

export function stepsFor(question: string): StepScript {
  const q = question.toLowerCase();
  const c = courseFromQuestion(question);
  const your = c ? `your ${c}` : 'your';

  if (/calendar|google|task|remind|sync|schedule/.test(q)) {
    return {
      kind: 'google',
      steps: ['Finding the matching deadlines', 'Converting them to Vienna time', 'Preparing Google Calendar events', 'Preparing Google Tasks', 'Checking for duplicates', 'Getting the confirmation card ready'],
    };
  }
  if (/need|to get a|to pass|final|for a [1-5]|what if|enough/.test(q)) {
    return {
      kind: 'needed',
      steps: [`Loading ${your} grades`, 'Collecting the weight of every item', "Working out what's still open", `Calculating what you need${c ? ` in ${c}` : ''}`, 'Double-checking the math', 'Writing it up'],
    };
  }
  if (/absen|attend|miss|skip|risk|fail/.test(q)) {
    return {
      kind: 'absence',
      steps: ['Opening your attendance records', 'Counting absences per course', "Comparing with each course's limit", 'Spotting courses at risk', 'Writing it up'],
    };
  }
  if (/due|deadline|week|today|tomorrow|upcoming|next|overdue|submit|homework|assignment/.test(q)) {
    return {
      kind: 'deadlines',
      steps: ['Checking your Moodle timeline', 'Collecting deadlines from all courses', 'Sorting them by due date', 'Flagging anything overdue', 'Writing your overview'],
    };
  }
  if (/grade|test|exam|score|point|mark|result|how did i|how am i|doing/.test(q)) {
    return {
      kind: 'grade',
      steps: [`Opening ${your} grade report`, 'Finding the latest graded item', 'Comparing with the class average', 'Working out your current standing', 'Writing it up'],
    };
  }
  return {
    kind: 'general',
    steps: ['Reading your question', 'Looking through your Moodle courses', 'Gathering the relevant details', 'Putting the answer together'],
  };
}
