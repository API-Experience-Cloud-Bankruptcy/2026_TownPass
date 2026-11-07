import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resultsSpeech, resultsTitle } from '../src/lib/results-text.ts';
import { matchAll } from '../src/lib/match.ts';
import { demoAnswers } from '../src/lib/demo.ts';
import { WELFARE_ITEMS } from '../src/data/welfare-items.ts';

const r = (name) => ({ item: { name, plain: '' } });
const likely = [r('甲'), r('乙')];
const unsure = [r('丙'), r('丁'), r('戊')];

test('only likely matches: title counts them', () => {
  assert.equal(resultsTitle(likely, []), '有 2 項你很可能符合');
  assert.match(resultsSpeech(likely, []), /^有 2 項你很可能符合。第 1 項/);
});

test('only unconfirmed items: title asks for more answers', () => {
  assert.equal(resultsTitle([], unsure), '再回答幾題，就能確認 3 項');
  assert.match(resultsSpeech([], unsure), /^再回答幾題，就能確認 3 項。第 1 項/);
});

test('both: title uses the likely count, speech adds the rest', () => {
  assert.equal(resultsTitle(likely, unsure), '有 2 項你很可能符合');
  assert.match(resultsSpeech(likely, unsure), /^有 2 項你很可能符合。還有 3 項需要再確認。第 1 項/);
});

test('nothing found', () => {
  assert.equal(resultsTitle([], []), '目前沒有找到符合的福利');
});

test('skipping every question counts only unconditional items as likely', () => {
  const all = ['low_income', 'mid_low_income', 'disability', 'indigenous', 'new_resident', 'single_parent', 'veteran', 'caregiver'];
  const { match, maybe } = matchAll(WELFARE_ITEMS, { identities: [] }, { unknownIdentities: all });
  assert.ok(match.every((m) => m.reasons.length === 0));
  assert.ok(maybe.length > 0);
  assert.equal(resultsTitle(match, maybe), `有 ${match.length} 項你很可能符合`);
});

test('demo scenario shows likely matches', () => {
  const now = new Date('2026-11-07T00:00:00+08:00');
  const a = demoAnswers(now);
  const { match, maybe } = matchAll(WELFARE_ITEMS, a.profile, { unknownIdentities: a.unknownIdentities, now });
  assert.ok(match.length > 0);
  assert.equal(resultsTitle(match, maybe), `有 ${match.length} 項你很可能符合`);
});
