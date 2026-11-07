import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { directionsUrl, distanceLabel, distanceMeters, nearestPlaces, TAIPEI_DISTRICTS } from '../src/lib/nearby.ts';
import { launchMap } from '../src/lib/townpass.ts';

const place = (id, latitude, longitude) => ({ id, name: id, kind: 'district_office', address: '', latitude, longitude });

test('distance: one degree of latitude is about 111 km', () => {
  const m = distanceMeters({ latitude: 25, longitude: 121.5 }, { latitude: 26, longitude: 121.5 });
  assert.ok(Math.abs(m - 111195) < 100, String(m));
  assert.equal(distanceMeters({ latitude: 25, longitude: 121 }, { latitude: 25, longitude: 121 }), 0);
});

test('nearest: sorted by distance and capped at three', () => {
  const origin = { latitude: 25.03, longitude: 121.56 };
  const places = [place('far', 25.13, 121.5), place('near', 25.031, 121.56), place('mid', 25.05, 121.57), place('mid2', 25.06, 121.58)];
  const got = nearestPlaces(places, origin);
  assert.deepEqual(got.map((p) => p.id), ['near', 'mid', 'mid2']);
  assert.ok(got[0].meters < got[1].meters);
});

test('distance label: metres below 1 km, kilometres above', () => {
  assert.equal(distanceLabel(3), '10 公尺');
  assert.equal(distanceLabel(847), '850 公尺');
  assert.equal(distanceLabel(1234), '1.2 公里');
});

test('every Taipei district has a coordinate inside the city', () => {
  assert.equal(TAIPEI_DISTRICTS.length, 12);
  for (const d of TAIPEI_DISTRICTS) {
    assert.ok(d.latitude > 24.95 && d.latitude < 25.22 && d.longitude > 121.45 && d.longitude < 121.67, d.label);
  }
});

test('directions URL targets the coordinate', () => {
  assert.equal(directionsUrl({ latitude: 25.03, longitude: 121.56 }), 'https://www.google.com/maps/dir/?api=1&destination=25.03,121.56');
});

const savedOpen = globalThis.open;
afterEach(() => {
  delete globalThis.flutterObject;
  globalThis.open = savedOpen;
});

function mockFlutter(reply) {
  const listeners = new Set();
  const sent = [];
  globalThis.flutterObject = {
    postMessage(raw) {
      const msg = JSON.parse(raw);
      sent.push(msg);
      const data = JSON.stringify({ name: msg.name, data: reply });
      queueMicrotask(() => listeners.forEach((l) => l({ data })));
    },
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
  };
  return sent;
}

test('launchMap: Town Pass launch_map, browser window when the App cannot launch it', async () => {
  const opened = [];
  globalThis.open = (url) => opened.push(url);
  const url = 'https://www.google.com/maps/dir/?api=1&destination=25,121';

  const sent = mockFlutter(true);
  await launchMap(url);
  assert.deepEqual(sent, [{ name: 'launch_map', data: url }]);
  assert.deepEqual(opened, []);

  const refused = mockFlutter(false);
  await launchMap(url);
  assert.deepEqual(refused, [
    { name: 'launch_map', data: url },
    { name: 'open_link', data: url },
  ]);

  delete globalThis.flutterObject;
  await launchMap(url);
  assert.deepEqual(opened, [url]);
});
