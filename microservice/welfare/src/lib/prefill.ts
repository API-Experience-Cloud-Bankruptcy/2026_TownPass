import type { Identity, Profile } from '../data/welfare-schema';
import type { Answers } from './app-state';
import type { Question } from './questions-types';
import type { KnownProfile } from './townpass';

export function markAnswered(a: Answers, questionId: string): Answers {
  const answered = a.answered ?? [];
  return answered.includes(questionId) ? a : { ...a, answered: [...answered, questionId] };
}

/** Index of the first question that has no answer yet (skipped or never reached), or -1. */
export function firstUnanswered(questions: Question[], a: Answers): number {
  const p = a.profile;
  const reached = (q: Question) => (a.answered ?? []).includes(q.id);
  return questions.findIndex((q) => {
    switch (q.kind) {
      case 'birthYear':
        return p.birthYear === undefined;
      case 'single':
        return p[q.field] === undefined;
      case 'children':
        return p.childrenUnder === undefined;
      case 'identities':
        return !reached(q) || q.options.some((o) => a.unknownIdentities.includes(o.identity));
      case 'identityYesNo':
        return !reached(q) || a.unknownIdentities.includes(q.identity);
    }
  });
}

/** Profile fields and identities that the given questions decide. */
function decidedBy(questions: Question[], ids: string[]) {
  const fields = new Set<keyof Profile>();
  const identities = new Set<Identity>();
  for (const q of questions) {
    if (!ids.includes(q.id)) continue;
    switch (q.kind) {
      case 'birthYear':
        fields.add('birthYear');
        break;
      case 'single':
        fields.add(q.field);
        q.options.forEach((o) => Object.keys(o.patch).forEach((f) => fields.add(f as keyof Profile)));
        break;
      case 'children':
        fields.add('childrenUnder');
        break;
      case 'identities':
        q.options.forEach((o) => identities.add(o.identity));
        break;
      case 'identityYesNo':
        identities.add(q.identity);
        break;
    }
  }
  return { fields, identities };
}

/**
 * Fills Town Pass data only into questions the person has not answered, so an explicit
 * answer (including 「以上都沒有」) wins. `locked` holds questions the person is working on.
 */
export function prefill(a: Answers, k: KnownProfile, questions: Question[], locked: string[] = []): Answers {
  const { fields, identities } = decidedBy(questions, [...(a.answered ?? []), ...locked]);
  const profile: Profile = { ...a.profile };
  if (k.birthYear !== undefined && profile.birthYear === undefined && !fields.has('birthYear')) {
    profile.birthYear = k.birthYear;
  }
  if (k.residentMonths !== undefined && profile.residentMonths === undefined && !fields.has('residentMonths')) {
    profile.residentMonths = k.residentMonths;
  }
  const add = k.identities.filter((i) => !identities.has(i) && !a.unknownIdentities.includes(i));
  if (add.length) profile.identities = [...new Set([...profile.identities, ...add])];
  return { ...a, profile };
}
