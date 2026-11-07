// 在一般瀏覽器開發時使用的假資料，內容取自 App 的
// assets/mock_data/account.json。只在沒有 flutterObject 時使用。

import type { Account, DeviceInfo, Position } from './types';

import accountResponse from '../../../assets/mock_data/account.json';

const account: Account = accountResponse.data;

// 臺北市政府
const position: Position = {
  latitude: 25.0375,
  longitude: 121.5637,
  timestamp: 0,
  accuracy: 10,
  altitude: 0,
  heading: 0,
  speed: 0,
  is_mocked: true,
};

const deviceInfo: DeviceInfo = { name: '瀏覽器', model: 'browser' };

/** 回傳模擬回覆；沒有對應的模擬資料時回傳 undefined。 */
export function mockReply(name: string, _data: unknown): unknown {
  switch (name) {
    case 'userinfo':
      return account;
    case 'location':
      return { ...position, timestamp: Date.now() };
    case 'deviceinfo':
      return deviceInfo;
    case 'qr_code_scan':
      return 'https://www.gov.taipei/';
    case 'phone_call':
    case 'launch_map':
      return true;
    default:
      return undefined;
  }
}
