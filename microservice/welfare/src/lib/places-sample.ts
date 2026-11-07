import type { Place } from './nearby';

/** Placeholder points until the Data role's `src/data/places.ts` is merged; names and addresses are not real. */
export const SAMPLE_PLACES: Place[] = [
  {
    id: 'sample-office',
    name: '範例區公所',
    kind: 'district_office',
    address: '臺北市信義區（範例地址）',
    phone: '1999',
    latitude: 25.033,
    longitude: 121.5654,
  },
  {
    id: 'sample-welfare-center',
    name: '範例社會福利服務中心',
    kind: 'social_welfare_center',
    address: '臺北市大安區（範例地址）',
    phone: '1999',
    latitude: 25.0265,
    longitude: 121.5434,
  },
  {
    id: 'sample-wifi',
    name: '範例免費上網點',
    kind: 'free_wifi',
    address: '臺北市中山區（範例地址）',
    latitude: 25.0642,
    longitude: 121.533,
  },
];
