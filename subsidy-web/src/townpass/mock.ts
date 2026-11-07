// 在一般瀏覽器開發時使用的假資料，內容取自 App 的
// assets/mock_data/account.json。只在沒有 flutterObject 時使用。

import type { Account, DeviceInfo, Position } from './types';

const account: Account = {
  id: '7f3562f4-bb3f-4ec7-89b9-da3b4b5ff250',
  account: 'wz7786',
  username: 'Wesley',
  realName: '金大森',
  idNo: 'A123456789',
  email: 'ist83903@bcaoo.com',
  phoneNo: '0932166777',
  birthday: '1988/12/12',
  memberType: 'personal',
  verifyLevel: '3',
  addresses: [
    {
      zip3: 104,
      city: '臺北市',
      town: '中山區',
      village: '正得里',
      street: '吉林路',
      usageType: '0',
      seq: 1,
      priority: true,
    },
  ],
  residentAddress: '臺北市中山區吉林路 69 號 4 樓',
  citizen: true,
  nativePeople: false,
  cityInternetUid: '',
};

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
