import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchAll, matchItem } from '../src/lib/match.ts';
import { interpretByKeywords } from '../src/lib/intake.ts';
import { phoneLabel, telHref } from '../src/lib/phone.ts';
import { demoAnswers, isDemo } from '../src/lib/demo.ts';
import { WELFARE_ITEMS } from '../src/data/welfare-items.ts';

const now = new Date('2026-11-07T00:00:00+08:00');

function item(eligibility, id = 'x') {
  return {
    id,
    name: id,
    plain: '',
    categories: ['senior'],
    agency: '',
    eligibility: { notes: [], ...eligibility },
    documents: [],
    apply: {},
    source: '',
    checkedAt: '2026-11-07',
  };
}

const base = { identities: [] };

test('age range: inside, outside, unknown', () => {
  const senior = item({ ageMin: 65 });
  assert.equal(matchItem(senior, { ...base, birthYear: 1950 }, { now }).status, 'match');
  assert.equal(matchItem(senior, { ...base, birthYear: 1990 }, { now }).status, 'no');
  assert.equal(matchItem(senior, base, { now }).status, 'maybe');
  const child = item({ ageMax: 6 });
  assert.equal(matchItem(child, { ...base, birthYear: 2022 }, { now }).status, 'match');
  assert.equal(matchItem(child, { ...base, birthYear: 2010 }, { now }).status, 'no');
});

test('residency minimum months', () => {
  const it = item({ residentMonthsMin: 12 });
  assert.equal(matchItem(it, { ...base, residentMonths: 12 }).status, 'match');
  assert.equal(matchItem(it, { ...base, residentMonths: 6 }).status, 'no');
  assert.equal(matchItem(it, { ...base, residentMonths: 0 }).status, 'no');
  assert.equal(matchItem(it, base).status, 'maybe');
  const registered = item({ residentMonthsMin: 0 });
  assert.equal(matchItem(registered, { ...base, residentMonths: 1 }).status, 'match');
  assert.equal(matchItem(registered, { ...base, residentMonths: 0 }).status, 'no');
});

test('identities: any-of, none held, skipped', () => {
  const it = item({ identitiesAny: ['low_income', 'mid_low_income'] });
  const held = matchItem(it, { identities: ['mid_low_income'] });
  assert.equal(held.status, 'match');
  assert.match(held.reasons[0], /中低收入戶/);
  assert.equal(matchItem(it, { identities: ['veteran'] }).status, 'no');
  assert.equal(matchItem(it, { identities: [] }, { unknownIdentities: ['low_income'] }).status, 'maybe');
  assert.equal(matchItem(it, { identities: [] }, { unknownIdentities: ['disability'] }).status, 'no');
});

test('boolean, child and student conditions', () => {
  const it = item({ livesAlone: true, renter: true, employed: false });
  assert.equal(matchItem(it, { ...base, livesAlone: true, renter: true, employed: false }).status, 'match');
  assert.equal(matchItem(it, { ...base, livesAlone: false, renter: true, employed: false }).status, 'no');
  const kid = item({ childAgeMax: 2 });
  assert.equal(matchItem(kid, { ...base, childrenUnder: [1, 8] }).status, 'match');
  assert.equal(matchItem(kid, { ...base, childrenUnder: [] }).status, 'no');
  assert.equal(matchItem(kid, base).status, 'maybe');
  const stu = item({ student: ['junior', 'senior'] });
  assert.equal(matchItem(stu, { ...base, student: 'senior' }).status, 'match');
  assert.equal(matchItem(stu, { ...base, student: null }).status, 'no');
  assert.equal(matchItem(stu, base).status, 'maybe');
});

test('a failure outweighs unknowns; notes never decide status', () => {
  const it = item({ ageMin: 65, residentMonthsMin: 6, notes: ['家庭總收入未超過標準'] });
  const r = matchItem(it, { ...base, birthYear: 1990 }, { now });
  assert.equal(r.status, 'no');
  const ok = matchItem(it, { ...base, birthYear: 1950, residentMonths: 24 }, { now });
  assert.equal(ok.status, 'match');
  assert.deepEqual(ok.toConfirm, ['家庭總收入未超過標準']);
});

test('matchAll groups and sorts by strength', () => {
  const strong = item({ ageMin: 65, residentMonthsMin: 6 }, 'strong');
  const weak = item({ ageMin: 65 }, 'weak');
  const almost = item({ ageMin: 65, livesAlone: true }, 'almost');
  const out = item({ ageMax: 18 }, 'out');
  const g = matchAll([weak, out, almost, strong], { ...base, birthYear: 1950, residentMonths: 24 }, { now });
  assert.deepEqual(g.match.map((r) => r.item.id), ['strong', 'weak']);
  assert.deepEqual(g.maybe.map((r) => r.item.id), ['almost']);
  assert.deepEqual(g.no.map((r) => r.item.id), ['out']);
});

test('keyword intake maps free text to categories and profile', () => {
  const r = interpretByKeywords('我今年 78 歲，一個人住，是中低收入戶，想學用手機上網', now);
  assert.ok(r.categories.includes('senior'));
  assert.ok(r.categories.includes('digital'));
  assert.equal(r.profile.livesAlone, true);
  assert.equal(r.profile.birthYear, 1948);
  assert.deepEqual(r.profile.identities, ['mid_low_income']);
  const r2 = interpretByKeywords('民國50年生，失業，租房子', now);
  assert.equal(r2.profile.birthYear, 1961);
  assert.equal(r2.profile.employed, false);
  assert.equal(r2.profile.renter, true);
});

test('demo profile: 陳阿嬤 has likely and to-confirm results', () => {
  const a = demoAnswers(now);
  assert.equal(a.profile.birthYear, 1948);
  const g = matchAll(WELFARE_ITEMS, a.profile, { unknownIdentities: a.unknownIdentities, now });
  assert.ok(g.match.length > 0);
  assert.ok(g.maybe.length > 0);
  assert.equal(isDemo('1'), true);
  assert.equal(isDemo(['1']), true);
  assert.equal(isDemo(undefined), false);
  assert.equal(isDemo('0'), false);
});

test('phone strings become dialable links', () => {
  assert.equal(telHref('1999（外縣市 02-2720-8889）轉 1609'), 'tel:1999,1609');
  assert.equal(phoneLabel('1999（外縣市 02-2720-8889）轉 1609'), '1999 轉 1609');
  assert.equal(telHref('02-2308-5231'), 'tel:0223085231');
  assert.equal(telHref('1966（週一至週五 08:30–12:00、13:30–17:30）'), 'tel:1966');
});
