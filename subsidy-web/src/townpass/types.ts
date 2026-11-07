// App 回傳資料的型別。來源：
// - userinfo：lib/bean/account.dart（假資料在 assets/mock_data/account.json）
// - location：geolocator 的 Position.toJson()

export interface Address {
  zip3: number;
  city: string;
  town: string;
  village: string;
  street: string;
  usageType: string;
  seq: number;
  priority: boolean;
}

export interface Account {
  id: string;
  account: string;
  username: string;
  realName: string;
  idNo: string;
  email: string;
  phoneNo: string;
  /** 格式 yyyy/MM/dd */
  birthday: string;
  memberType: string;
  verifyLevel: string;
  addresses: Address[];
  residentAddress: string;
  /** 是否為臺北市民 */
  citizen: boolean;
  /** 是否為原住民 */
  nativePeople: boolean;
  cityInternetUid: string;
}

export interface Position {
  latitude: number;
  longitude: number;
  /** epoch 毫秒 */
  timestamp: number;
  accuracy: number;
  altitude: number;
  heading: number;
  speed: number;
  is_mocked: boolean;
  [key: string]: unknown;
}

export type DeviceInfo = Record<string, unknown>;
