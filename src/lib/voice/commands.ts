/** Spoken commands understood during navigation, plus fuzzy matching of room names. */

export type Command =
  | { type: 'where' }
  | { type: 'repeat' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end' }
  | { type: 'help' }
  | { type: 'place'; id: string }
  | { type: 'unknown'; heard: string };

export interface Place {
  id: string;
  label: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an|my|please|room)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length]![b.length]!;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Best place for what was said. Handles extra words ("take me to the kitchen"), partial names
 * ("bath" → Bathroom) and recognition slips ("closed" → Closet). Null when nothing is close.
 */
export function matchPlace(heard: string, places: Place[]): Place | null {
  const h = norm(heard);
  if (!h) return null;
  let best: { p: Place; score: number } | null = null;
  for (const p of places) {
    const l = norm(p.label) || p.label.toLowerCase();
    let score = 0;
    if (h === l) score = 1;
    else if (` ${h} `.includes(` ${l} `)) score = 0.95;
    else if (l.startsWith(h) && h.length >= 3) score = 0.85;
    else {
      // Compare against each window of the same number of words.
      const hw = h.split(' ');
      const n = l.split(' ').length;
      for (let i = 0; i + n <= hw.length; i++)
        score = Math.max(score, similarity(hw.slice(i, i + n).join(' '), l));
    }
    if (!best || score > best.score) best = { p, score };
  }
  return best && best.score >= 0.7 ? best.p : null;
}

export function parseCommand(transcript: string, places: Place[]): Command {
  const t = transcript.toLowerCase().trim();
  if (!t) return { type: 'unknown', heard: '' };
  if (/\bwhere am i\b|\bwhere are we\b|\bwhere is this\b/.test(t)) return { type: 'where' };
  if (/\b(repeat|again|say that|what did you say|pardon)\b/.test(t)) return { type: 'repeat' };
  if (/\b(help|what can i say|commands)\b/.test(t)) return { type: 'help' };
  if (/^(stop|end|cancel|quit|finish)\b|\b(stop|end) (navigation|navigating|guidance)\b/.test(t))
    return { type: 'end' };
  if (/\b(pause|wait|hold on)\b/.test(t)) return { type: 'pause' };
  if (/\b(resume|continue|keep going|go on|unpause)\b/.test(t)) return { type: 'resume' };
  const place = matchPlace(
    t.replace(/^(take me to|go to|navigate to|i want to go to|i'?m (in|at)|i am (in|at))\s+/, ''),
    places,
  );
  if (place) return { type: 'place', id: place.id };
  return { type: 'unknown', heard: transcript.trim() };
}

export const VOICE_HELP =
  'You can say: where am I, repeat, pause, resume, stop, or the name of a room to go there instead.';
