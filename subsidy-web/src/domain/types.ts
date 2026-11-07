// 福利資料與介面型別。依 docs/welfare-implementation-contract.md 與
// backend/data/subsidies.json 實際欄位定義；未列出的欄位仍原樣保留在物件中（不裁切）。

export type VerificationStatus = 'verified' | 'partial' | 'unverified' | (string & {});

export interface AgeRule {
  min: number | null;
  max: number | null;
  raw: string | null;
  subject: string | null;
  unit: string | null;
  [key: string]: unknown;
}

export interface IncomeRule {
  subject?: string | null;
  metric?: string | null;
  operator?: string | null;
  value?: number | null;
  period?: string | null;
  year?: number | string | null;
  raw: string | null;
  [key: string]: unknown;
}

export interface HouseholdRule {
  types: string[];
  raw: string | null;
  [key: string]: unknown;
}

export interface ResidenceRule {
  region: string | null;
  registered_required: boolean | null;
  actual_residence_required: boolean | null;
  min_duration_months?: number | null;
  raw: string | null;
  [key: string]: unknown;
}

export interface RawRule {
  raw: string | null;
  [key: string]: unknown;
}

export interface Eligibility {
  age: AgeRule[];
  income: IncomeRule[];
  household: HouseholdRule[];
  residence: ResidenceRule[];
  student: RawRule[];
  disability: RawRule[];
  employment: RawRule[];
  nationality: RawRule[];
  property: RawRule[];
  exclusions: string[];
  raw_summary: string | null;
  taipei_applicability?: string;
  [key: string]: unknown;
}

export interface RequiredDocument {
  name: string;
  condition: string | null;
  notes: string | null;
  required: boolean | null;
  [key: string]: unknown;
}

export interface SourceRecord {
  url: string;
  role: string;
  type: string;
  checked_date?: string;
  source_date?: string;
  [key: string]: unknown;
}

export interface Extension {
  key: string;
  label: string | null;
  namespace: string;
  raw: string | null;
  [key: string]: unknown;
}

export interface Subsidy {
  id: string;
  name: string;
  api_version?: string;
  scope: { level: string; regions: string[]; [key: string]: unknown };
  provider: { name: string; type: string; [key: string]: unknown };
  classification: { category: string; benefit_type: string; [key: string]: unknown };
  eligibility: Eligibility;
  benefit: { kind: string | null; raw: string | null; amounts?: unknown[]; [key: string]: unknown };
  application: {
    agency: string | null;
    channel_text: string | null;
    process_text: string | null;
    methods: string[];
    deadline: { type: string; raw: string | null; start: string | null; end: string | null; [key: string]: unknown };
    required_documents: RequiredDocument[];
    urls: { program: string | null; apply: string | null; form: string | null; [key: string]: unknown };
    [key: string]: unknown;
  };
  extensions?: Extension[];
  search: {
    facets: { applicant_types: string[]; category: string; scope: string; regions: string[]; [key: string]: unknown };
    keywords: string[];
    text: string;
    [key: string]: unknown;
  };
  source_meta: {
    verification_status: VerificationStatus;
    checked_date: string | null;
    sources: SourceRecord[];
    notes?: string;
    missing_fields?: string[];
    application_status?: string;
    verification_note?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** GET /api/catalog 回傳；建置快照也包成同一結構。 */
export interface Catalog {
  version: string;
  items: Subsidy[];
}

export type CatalogOrigin = 'api' | 'snapshot';

export interface LoadedCatalog extends Catalog {
  origin: CatalogOrigin;
  /** 給使用者看的來源說明 */
  sourceLabel: string;
  /** API 失敗原因（使用快照時） */
  fallbackReason?: string;
}

export type QuestionKind = 'single' | 'boolean' | 'number';

export interface QuestionOption {
  label: string;
  value: string | boolean;
}

/** GET /api/questions 的 Question，固定模板產生，不由 AI 生成。 */
export interface Question {
  id: string;
  field: string;
  kind: QuestionKind;
  title: string;
  description?: string;
  options?: QuestionOption[];
  min?: number;
  max?: number;
  resource_ids: string[];
}

export interface QuestionBank {
  version: string;
  questions: Question[];
  origin: 'api' | 'local';
}

export type HouseholdType = 'low_income' | 'mid_low_income' | 'general';
/** 戶籍地：實際繁中縣市字串（例「臺北市」「其他縣市」「新北市」）；未知不存值。 */
export type RegionAnswer = string;

/** 本機答案。未回答或「不知道」一律不存值。 */
export interface Answers {
  age?: number;
  region?: RegionAnswer;
  is_student?: boolean;
  household_type?: HouseholdType;
  /** 後端新增、前端尚未用於判斷的欄位，只保存不評估 */
  extra?: Record<string, string | number | boolean>;
}

export type Fit = 'likely' | 'possible' | 'ineligible';

export interface MatchResult {
  id: string;
  fit: Fit;
  reasons: string[];
  warnings: string[];
  blocked_by: string[];
  /** 選填：仍需確認的條件原文（不含填答值） */
  pending?: string[];
  /** 選填：含填答值的訊息與其不含填答值的替代文字，供輸出時依使用者同意決定 */
  personal?: PersonalNote[];
}

export interface PersonalNote {
  list: 'reasons' | 'warnings' | 'blocked_by';
  text: string;
  /** 透露的答案欄位 */
  field: string;
  /** 不含填答值的版本；null 代表未同意時不輸出 */
  neutral: string | null;
}

export type Target = 'self' | 'other';
