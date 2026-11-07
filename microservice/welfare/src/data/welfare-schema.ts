export type Category =
  | 'hardship' // 生活困難
  | 'work' // 工作相關
  | 'senior' // 銀髮福利
  | 'care' // 醫療與照護
  | 'parenting' // 育兒相關
  | 'learning' // 社會教育
  | 'housing' // 居住或交通
  | 'education' // 教育扶助
  | 'digital' // 上網與設備

export type Identity =
  | 'low_income' // 低收入戶
  | 'mid_low_income' // 中低收入戶
  | 'disability' // 身心障礙
  | 'indigenous' // 原住民
  | 'new_resident' // 新住民
  | 'single_parent' // 特殊境遇家庭／單親
  | 'veteran' // 榮民
  | 'caregiver' // 家庭照顧者

export interface Profile {
  birthYear?: number // 西元
  residentMonths?: number // 設籍臺北市月數
  identities: Identity[]
  livesAlone?: boolean
  childrenUnder?: number[] // 子女年齡
  employed?: boolean
  student?: 'elementary' | 'junior' | 'senior' | 'college' | null
  renter?: boolean
}

export interface Eligibility {
  ageMin?: number
  ageMax?: number
  residentMonthsMin?: number
  identitiesAny?: Identity[] // 符合任一
  livesAlone?: boolean
  childAgeMax?: number // 有子女年齡在此以下
  employed?: boolean
  student?: NonNullable<Profile['student']>[]
  renter?: boolean
  notes: string[] // 無法用欄位判斷的條件，原文白話
}

export interface WelfareItem {
  id: string
  name: string // 官方名稱
  plain: string // 一句白話：能拿到什麼
  categories: Category[]
  agency: string // 主辦機關
  amount?: string // 金額或內容
  eligibility: Eligibility
  documents: string[] // 申請要帶
  apply: {
    online?: string // 線上申辦網址
    counter?: string // 臨櫃地點
    phone?: string
  }
  source: string // 官方頁面網址
  checkedAt: string // 查核日期 YYYY-MM-DD
}
