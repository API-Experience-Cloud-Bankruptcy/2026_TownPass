// 申請人「本人」資料：只供填申請表，不參與任何資格判斷。
// 來源是城市通 userinfo（使用者按下「一鍵填好申請表」才讀取），格式通過的項目直接填入。
// 只存在記憶體；不寫入 sessionStorage／localStorage，不送後端。

import type { Account } from '../townpass';

export type ProfileKey = 'name' | 'nationalId' | 'gender' | 'mobile' | 'homePhone' | 'registeredAddress' | 'contactAddress';
export type ProfileValues = Partial<Record<ProfileKey, string>>;
/** 只含格式通過、已正規化的值。填寫引擎只接受這個型別。 */
export type ConfirmedProfile = Readonly<ProfileValues>;

export interface ProfileFieldSpec { key: ProfileKey; label: string; hint: string; inputmode?: 'text' | 'tel'; options?: { value: string; label: string }[] }

export const PROFILE_FIELDS: readonly ProfileFieldSpec[] = [
  { key: 'name', label: '姓名', hint: '與身分證相同' },
  { key: 'nationalId', label: '身分證字號', hint: '例如 A123456789；居留證號也可' },
  { key: 'gender', label: '性別', hint: '表單要填「男」或「女」時使用', options: [{ value: 'male', label: '男' }, { value: 'female', label: '女' }] },
  { key: 'mobile', label: '手機', hint: '例如 0912345678', inputmode: 'tel' },
  { key: 'homePhone', label: '住家電話', hint: '選填，表單有「住宅／市話」欄時使用', inputmode: 'tel' },
  { key: 'registeredAddress', label: '戶籍地址', hint: '表單寫「戶籍地址」時使用' },
  { key: 'contactAddress', label: '通訊／居住地址', hint: '表單寫「通訊、聯絡、居住地址」時使用' },
];

const ID_PATTERN = /^[A-Z][1289A-D]\d{8}$/;

export function normalizeMobile(value: string): string {
  const digits = value.replace(/[\s\-()]/g, '');
  return /^\+?886/.test(digits) ? `0${digits.replace(/^\+?886/, '')}` : digits;
}

/** 回傳錯誤說明；空字串代表格式可接受。空值不是錯誤（只是不會被確認）。 */
export function validateProfileValue(key: ProfileKey, raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  switch (key) {
    case 'name': return value.length > 40 ? '姓名過長' : '';
    case 'nationalId': return ID_PATTERN.test(value.toUpperCase()) ? '' : '格式不符（英文字母加 9 碼數字）';
    case 'gender': return value === 'male' || value === 'female' ? '' : '請選擇男或女';
    case 'mobile': return /^09\d{8}$/.test(normalizeMobile(value)) ? '' : '手機應為 10 碼，09 開頭';
    case 'homePhone': return /^[\d\-()\s#]{6,20}$/.test(value) ? '' : '電話格式不符';
    case 'registeredAddress':
    case 'contactAddress': return value.length < 6 ? '地址太短，請寫完整' : value.length > 120 ? '地址過長' : '';
  }
}

function formatAddress(a: Account['addresses'][number] | undefined): string {
  return a ? [a.city, a.town, a.village, a.street].filter((p) => typeof p === 'string' && p).join('') : '';
}

/** 把城市通帳號資料轉成「待確認」草稿。這些值尚未被確認，不可直接拿去填表。 */
export function draftFromAccount(account: Account | null | undefined): ProfileValues {
  if (!account) return {};
  const primary = account.addresses?.find((a) => a.priority) ?? account.addresses?.[0];
  const draft: ProfileValues = {
    name: account.realName || undefined,
    nationalId: account.idNo || undefined,
    mobile: account.phoneNo ? normalizeMobile(account.phoneNo) : undefined,
    registeredAddress: account.residentAddress || undefined,
    contactAddress: formatAddress(primary) || undefined,
  };
  // 城市通沒有性別欄位：不從身分證字號推測，讓使用者自己選。
  return Object.fromEntries(Object.entries(draft).filter(([, v]) => typeof v === 'string' && v.trim())) as ProfileValues;
}

/** 只留下「已勾選確認、非空、格式通過」的值，並正規化。 */
export function confirmProfile(values: ProfileValues, confirmed: Partial<Record<ProfileKey, boolean>>): ConfirmedProfile {
  const out: ProfileValues = {};
  for (const spec of PROFILE_FIELDS) {
    const raw = values[spec.key]?.trim();
    if (!raw || !confirmed[spec.key] || validateProfileValue(spec.key, raw)) continue;
    out[spec.key] = spec.key === 'nationalId' ? raw.toUpperCase() : spec.key === 'mobile' ? normalizeMobile(raw) : raw;
  }
  return Object.freeze(out);
}

/** 一鍵填寫：城市通帳號資料中格式通過的項目全部採用。 */
export function profileFromAccount(account: Account | null | undefined): ConfirmedProfile {
  const draft = draftFromAccount(account);
  return confirmProfile(draft, Object.fromEntries(Object.keys(draft).map((k) => [k, true])));
}
