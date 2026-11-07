import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { birthYearOf, call, getLocation, getUserInfo, inTownPass, openLink, profileFromAccount } from '../src/lib/townpass.ts';
import { dialNumber } from '../src/lib/phone.ts';

const ACCOUNT = {
  realName: '金大森',
  birthday: '1988/12/12',
  residentAddress: '臺北市中山區吉林路 69 號 4 樓',
  citizen: true,
  nativePeople: false,
};

/** Fake WebView bridge: records posts and answers with `replies[name]` (undefined = never replies). */
function mockFlutter(replies = {}) {
  const listeners = new Set();
  const sent = [];
  globalThis.flutterObject = {
    postMessage(raw) {
      const msg = JSON.parse(raw);
      sent.push(msg);
      if (msg.name in replies) {
        const data = JSON.stringify({ name: msg.name, data: replies[msg.name] });
        queueMicrotask(() => listeners.forEach((l) => l({ data })));
      }
    },
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
  };
  return { sent, listeners };
}

const saved = { open: globalThis.open, location: globalThis.location };
afterEach(() => {
  delete globalThis.flutterObject;
  globalThis.open = saved.open;
  globalThis.location = saved.location;
});

test('detects Town Pass only when flutterObject exists', () => {
  assert.equal(inTownPass(), false);
  mockFlutter();
  assert.equal(inTownPass(), true);
});

test('getUserInfo returns the account and removes its listener', async () => {
  const { sent, listeners } = mockFlutter({ userinfo: ACCOUNT });
  assert.deepEqual(await getUserInfo(), ACCOUNT);
  assert.deepEqual(sent, [{ name: 'userinfo', data: null }]);
  assert.equal(listeners.size, 0);
});

test('getUserInfo ignores replies for other handlers', async () => {
  const { listeners } = mockFlutter({ userinfo: ACCOUNT });
  const pending = getUserInfo();
  listeners.forEach((l) => l({ data: JSON.stringify({ name: 'location', data: { latitude: 1 } }) }));
  listeners.forEach((l) => l({ data: 'not json' }));
  assert.deepEqual(await pending, ACCOUNT);
});

test('getUserInfo is null when signed out, outside Town Pass, or on timeout', async (t) => {
  mockFlutter({ userinfo: [] });
  assert.equal(await getUserInfo(), null);
  delete globalThis.flutterObject;
  assert.equal(await getUserInfo(), null);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mockFlutter();
  const pending = getUserInfo();
  t.mock.timers.tick(3000);
  assert.equal(await pending, null);
});

test('call and openLink post to Town Pass', () => {
  const { sent } = mockFlutter();
  call(dialNumber('1999（外縣市 02-2720-8889）轉 1609'));
  openLink('https://example.gov.taipei/apply');
  assert.deepEqual(sent, [
    { name: 'phone_call', data: '1999,1609' },
    { name: 'open_link', data: 'https://example.gov.taipei/apply' },
  ]);
});

test('call and openLink fall back to tel: and window.open', () => {
  const opened = [];
  globalThis.open = (...args) => opened.push(args);
  globalThis.location = { href: '' };
  call('1999');
  openLink('https://example.gov.taipei/apply');
  assert.equal(globalThis.location.href, 'tel:1999');
  assert.deepEqual(opened, [['https://example.gov.taipei/apply', '_blank', 'noopener']]);
});

test('getLocation reads the Town Pass position or returns null', async () => {
  mockFlutter({ location: { latitude: 25.05, longitude: 121.53, accuracy: 5 } });
  assert.deepEqual(await getLocation(), { latitude: 25.05, longitude: 121.53 });
  mockFlutter({ location: [] });
  assert.equal(await getLocation(), null);
});

test('birth year accepts 西元 and 民國 dates', () => {
  assert.equal(birthYearOf('1988/12/12'), 1988);
  assert.equal(birthYearOf('1950-01-02'), 1950);
  assert.equal(birthYearOf('77/12/12'), 1988);
  assert.equal(birthYearOf(''), undefined);
});

test('profile from account fills only what the account proves', () => {
  assert.deepEqual(profileFromAccount(ACCOUNT), { identities: [], birthYear: 1988 });
  assert.deepEqual(
    profileFromAccount({ birthday: '1950/1/1', residentAddress: '新北市板橋區', nativePeople: true }),
    { identities: ['indigenous'], birthYear: 1950, residentMonths: 0 },
  );
  assert.deepEqual(profileFromAccount({}), { identities: [] });
});
