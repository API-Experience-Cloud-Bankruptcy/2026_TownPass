import type { Identity, Profile } from '../data/welfare-schema';

/** Town Pass bridge (docs/contracts/bridge.md). Outside Town Pass every call falls back to browser behaviour. */

interface FlutterObject {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/**
 * `userinfo` reply, as serialised by lib/bean/account.dart.
 * bridge.md does not document these fields yet, so every one is optional.
 */
export interface TownPassAccount {
  realName?: string;
  /** 「1988/12/12」 in the mock account. */
  birthday?: string;
  residentAddress?: string;
  citizen?: boolean;
  nativePeople?: boolean;
}

/** `location` reply (geolocator Position.toJson); not yet in bridge.md. */
export interface Position {
  latitude: number;
  longitude: number;
}

const REPLY_TIMEOUT_MS = 3000;
/** The first `location` request waits for the permission dialog and a fix (bridge.md). */
export const LOCATION_TIMEOUT_MS = 15000;

function bridge(): FlutterObject | null {
  const fo = (globalThis as { flutterObject?: FlutterObject }).flutterObject;
  return fo && typeof fo.postMessage === 'function' ? fo : null;
}

export function inTownPass(): boolean {
  return bridge() !== null;
}

function send(fo: FlutterObject, name: string, data?: unknown) {
  fo.postMessage(JSON.stringify({ name, data: data ?? null }));
}

/** Posts a message and resolves with the reply's `data`, or null on timeout. */
function request(fo: FlutterObject, name: string, data?: unknown, timeoutMs = REPLY_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve) => {
    const done = (value: unknown) => {
      clearTimeout(timer);
      fo.removeEventListener('message', onMessage);
      resolve(value);
    };
    const onMessage = (event: { data: unknown }) => {
      try {
        const reply = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (reply?.name === name) done(reply.data ?? null);
      } catch {
        // Not a bridge reply.
      }
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    fo.addEventListener('message', onMessage);
    send(fo, name, data);
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Account of the signed-in Town Pass user; null outside Town Pass or when nobody is signed in. */
export async function getUserInfo(): Promise<TownPassAccount | null> {
  const fo = bridge();
  if (!fo) return null;
  const data = await request(fo, 'userinfo');
  return isObject(data) ? (data as TownPassAccount) : null;
}

/** Dials `number` (digits, optional `,ext`), e.g. from `dialNumber()` in phone.ts. */
export function call(number: string): void {
  const fo = bridge();
  if (fo) send(fo, 'phone_call', number);
  else if (globalThis.location) globalThis.location.href = `tel:${number}`;
}

/** Town Pass opens `url` in its in-app WebView and sends no reply on success, so nothing waits for one. */
export function openLink(url: string): void {
  const fo = bridge();
  if (fo) send(fo, 'open_link', url);
  else globalThis.open?.(url, '_blank', 'noopener');
}

/** Opens a map URL: Town Pass `launch_map`, falling back to `openLink` when the App cannot launch it. */
export async function launchMap(url: string): Promise<void> {
  const fo = bridge();
  if (!fo) return openLink(url);
  if ((await request(fo, 'launch_map', url)) !== true) openLink(url);
}

export async function getLocation(): Promise<Position | null> {
  const fo = bridge();
  if (fo) {
    const data = await request(fo, 'location', undefined, LOCATION_TIMEOUT_MS);
    return isObject(data) && typeof data.latitude === 'number' && typeof data.longitude === 'number'
      ? { latitude: data.latitude, longitude: data.longitude }
      : null;
  }
  const geo = globalThis.navigator?.geolocation;
  if (!geo) return null;
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      { timeout: 10000 },
    );
  });
}

/** Birth year (西元) from 「1988/12/12」, 「1988-12-12」 or a 民國 year such as 「77/12/12」. */
export function birthYearOf(birthday: string): number | undefined {
  const y = Number(birthday.trim().match(/^(\d{2,4})[/\-.年]/)?.[1]);
  if (!y) return undefined;
  return y < 1000 ? y + 1911 : y;
}

/**
 * Profile fields the account answers for sure. A Taipei address does not say how long
 * the person has been registered, so residency is only filled when it is outside Taipei.
 */
export type KnownProfile = Pick<Profile, 'birthYear' | 'residentMonths'> & { identities: Identity[] };

export function profileFromAccount(a: TownPassAccount): KnownProfile {
  const out: KnownProfile = { identities: [] };
  const year = a.birthday ? birthYearOf(a.birthday) : undefined;
  if (year) out.birthYear = year;
  const addr = a.residentAddress?.trim();
  if (addr && !/^(臺北市|台北市)/.test(addr)) out.residentMonths = 0;
  if (a.nativePeople === true) out.identities.push('indigenous');
  return out;
}
