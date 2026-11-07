// 合成測試資料：結構與 backend/data/subsidies.json 相同，內容為測試用，不代表真實福利規定。
import type { Subsidy } from '../types';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function makeSubsidy(over: DeepPartial<Subsidy> & { id?: string } = {}): Subsidy {
  const base: Subsidy = {
    id: 'T-0001',
    name: '測試補助',
    scope: { level: 'central', regions: ['全國'] },
    provider: { name: '測試機關', type: 'government' },
    classification: { category: '生活', benefit_type: '現金' },
    eligibility: {
      age: [],
      income: [],
      household: [],
      residence: [],
      student: [],
      disability: [],
      employment: [],
      nationality: [],
      property: [],
      exclusions: [],
      raw_summary: null,
      taipei_applicability: undefined,
    },
    benefit: { kind: '現金', raw: '每月 1,000 元' },
    application: {
      agency: '測試機關',
      channel_text: '測試窗口',
      process_text: '準備文件→臨櫃申請→等待通知',
      methods: ['in_person'],
      deadline: { type: 'ongoing', raw: '常年受理', start: null, end: null },
      required_documents: [{ name: '身分證', condition: null, notes: '', required: true }],
      urls: { program: 'https://example.gov.tw/p', apply: null, form: null },
    },
    extensions: [],
    search: { facets: { applicant_types: ['一般民眾'], category: '生活', scope: 'central', regions: ['全國'] }, keywords: [], text: '' },
    source_meta: {
      verification_status: 'verified',
      checked_date: '2026-11-07',
      sources: [{ url: 'https://example.gov.tw/p', role: 'program', type: 'official', checked_date: '2026-11-07' }],
      notes: '',
      verification_note: '',
    },
  };
  const merge = (a: any, b: any): any => {
    if (b === undefined) return a;
    if (Array.isArray(b) || b === null || typeof b !== 'object') return b;
    const out: any = { ...a };
    for (const k of Object.keys(b)) out[k] = merge(a?.[k], b[k]);
    return out;
  };
  const result = merge(base, over) as Subsidy;
  // taipei_applicability undefined 時不出現在物件上，與「無此欄位」相同
  if (result.eligibility.taipei_applicability === undefined) delete result.eligibility.taipei_applicability;
  return result;
}

export function ageRule(raw: string | null, min: number | null, max: number | null, subject = '申請人', unit = 'year') {
  return { raw, min, max, subject, unit };
}
