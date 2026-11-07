import assert from 'node:assert/strict';
import { test } from 'node:test';

import { markAnswered, prefill } from '../src/lib/prefill.ts';

const QUESTIONS = [
  { id: 'age', kind: 'birthYear', title: '出生年' },
  {
    id: 'ids',
    kind: 'identities',
    title: '身分',
    options: [
      { label: '原住民', identity: 'indigenous' },
      { label: '身心障礙', identity: 'disabled' },
    ],
  },
];
const KNOWN = { identities: ['indigenous'], birthYear: 1950 };
const EMPTY = { profile: { identities: [] }, unknownIdentities: [] };

test('「以上都沒有」 survives Town Pass prefill when editing answers', () => {
  // Finished the quiz with 「以上都沒有」, then came back from 修改答案.
  const answered = markAnswered(markAnswered(EMPTY, 'age'), 'ids');
  const back = { ...answered, profile: { identities: [], birthYear: 1980 } };
  assert.deepEqual(prefill(back, KNOWN, QUESTIONS).profile, { identities: [], birthYear: 1980 });
});

test('unanswered questions still get Town Pass data', () => {
  assert.deepEqual(prefill(EMPTY, KNOWN, QUESTIONS).profile, { identities: ['indigenous'], birthYear: 1950 });
  const ageOnly = markAnswered({ ...EMPTY, profile: { identities: [], birthYear: 1980 } }, 'age');
  assert.deepEqual(prefill(ageOnly, KNOWN, QUESTIONS).profile, { identities: ['indigenous'], birthYear: 1980 });
});

test('late Town Pass reply fills the shown question only while untouched', () => {
  // Untouched: the shown question receives the data, so its remounted state shows it.
  assert.deepEqual(prefill(EMPTY, KNOWN, QUESTIONS).profile.identities, ['indigenous']);
  // Touched (person already ticked 身心障礙 locally): the shown question is left alone.
  assert.deepEqual(prefill(EMPTY, KNOWN, QUESTIONS, ['ids']).profile, { identities: [], birthYear: 1950 });
  assert.deepEqual(prefill(EMPTY, KNOWN, QUESTIONS, ['age']).profile, { identities: ['indigenous'] });
});

test('markAnswered records each question once', () => {
  const a = markAnswered(markAnswered(EMPTY, 'ids'), 'ids');
  assert.deepEqual(a.answered, ['ids']);
});
