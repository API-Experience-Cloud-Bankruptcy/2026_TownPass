// 城市通內建能力的型別化封裝。name 對應 App 端
// lib/util/web_message_handler/tp_web_message_handler.dart 的各個 Handler。

import { request, send } from './bridge';
import type { Account, DeviceInfo, Position } from './types';

export { isInTownPass, TownPassError } from './bridge';
export type { Account, Address, DeviceInfo, Position } from './types';

// App 沒有資料時（未登入、沒有定位權限）會回傳空陣列 []。
const emptyToNull = <T>(value: T | unknown[]): T | null =>
  Array.isArray(value) && value.length === 0 ? null : (value as T);

/** 使用者帳號資料；未登入時為 null。 */
export async function getUserInfo(): Promise<Account | null> {
  return emptyToNull<Account>(await request<Account | []>('userinfo'));
}

/** 目前位置；沒有權限或定位失敗時為 null。 */
export async function getLocation(): Promise<Position | null> {
  return emptyToNull<Position>(await request<Position | []>('location', null, { timeoutMs: 20_000 }));
}

/** 裝置資訊；欄位依平台不同。 */
export async function getDeviceInfo(): Promise<DeviceInfo | null> {
  return emptyToNull<DeviceInfo>(await request<DeviceInfo | []>('deviceinfo'));
}

/** 開啟 App 的掃碼頁，回傳掃到的文字；使用者返回時為 null。 */
export async function scanQRCode(): Promise<string | null> {
  const result = await request<string | null>('qr_code_scan', null, { timeoutMs: 0 });
  return typeof result === 'string' ? result : null;
}

/** 撥打電話；回傳裝置能否撥號。 */
export function phoneCall(phoneNumber: string): Promise<boolean> {
  return request<boolean>('phone_call', phoneNumber);
}

/** 以外部地圖 App 開啟網址；回傳能否開啟。 */
export function launchMap(url: string): Promise<boolean> {
  return request<boolean>('launch_map', url);
}

/** 撥打 1999；App 會先確認使用者同意條款。成功時 App 不回覆。 */
export function call1999(): void {
  send('1999agree', true);
}

/** 發送手機通知。成功時 App 不回覆。 */
export function notify(title: string, content: string): void {
  send('notify', { title, content });
}

/** 在 App 內開啟網址。成功時 App 不回覆。 */
export function openLink(url: string): void {
  send('open_link', url);
}
