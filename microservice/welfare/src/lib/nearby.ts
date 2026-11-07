import type { Position } from './townpass';

export type PlaceKind = 'district_office' | 'social_welfare_center' | 'free_wifi';

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  address: string;
  phone?: string;
  latitude: number;
  longitude: number;
}

export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  district_office: '區公所',
  social_welfare_center: '社會福利服務中心',
  free_wifi: '免費上網',
};

/** Point distances are measured from: the device position or a chosen district. */
export interface Origin extends Position {
  label: string;
}

/** Approximate location of each district office, used when location access is refused. */
export const TAIPEI_DISTRICTS: Origin[] = [
  { label: '中正區', latitude: 25.0324, longitude: 121.5199 },
  { label: '大同區', latitude: 25.0634, longitude: 121.513 },
  { label: '中山區', latitude: 25.0642, longitude: 121.533 },
  { label: '松山區', latitude: 25.05, longitude: 121.5776 },
  { label: '大安區', latitude: 25.0265, longitude: 121.5434 },
  { label: '萬華區', latitude: 25.035, longitude: 121.4998 },
  { label: '信義區', latitude: 25.033, longitude: 121.5654 },
  { label: '士林區', latitude: 25.093, longitude: 121.525 },
  { label: '北投區', latitude: 25.132, longitude: 121.501 },
  { label: '內湖區', latitude: 25.069, longitude: 121.589 },
  { label: '南港區', latitude: 25.055, longitude: 121.607 },
  { label: '文山區', latitude: 24.989, longitude: 121.57 },
];

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle (haversine) distance in metres. */
export function distanceMeters(a: Position, b: Position): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestPlaces(places: Place[], origin: Position, count = 3): (Place & { meters: number })[] {
  return places
    .map((p) => ({ ...p, meters: distanceMeters(origin, p) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count);
}

/** 「850 公尺」 below 1 km, otherwise 「1.2 公里」. */
export function distanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} 公尺`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

export function directionsUrl(p: Pick<Place, 'latitude' | 'longitude'>): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`;
}
