// SPDX-License-Identifier: AGPL-3.0-only
// Source-bound identity prerequisites used only for ranking and focus, never for fit.
// Each entry lists a resource whose every application path needs the identity; a resource
// with alternative paths (e.g. low income OR disability) is deliberately absent.
import type { Answers, Subsidy } from './types';

export type IdentityField = 'household_type' | 'special_identity';
export interface IdentityGate {
  id: string;
  name: string;
  field: IdentityField;
  values: string[];
  evidence: { path: string; value: string };
}
/** met: answered with a listed identity; unknown: unanswered; unmet: another identity; conflict: answered none of them. */
export type IdentityStatus = 'none' | 'met' | 'unknown' | 'unmet' | 'conflict';

const LOW = ['low_income'];
const MID = ['mid_low_income'];
const BOTH = ['low_income', 'mid_low_income'];
const gate = (id: string, name: string, field: IdentityField, values: string[], path: string, value: string): IdentityGate =>
  ({ id, name, field, values, evidence: { path, value } });

export const IDENTITY_GATES: IdentityGate[] = [
  gate('WEL-0004', '教育部學產基金低收入戶學生助學金', 'household_type', LOW, '/eligibility/household/0/raw', '低收入戶在學學生'),
  gate('WEL-0013', '瑞穗銀行慈善事業愛心基金會獎學金', 'household_type', LOW, '/eligibility/household/0/raw', '低收入戶學生'),
  gate('WEL-0050', '臺北市住宅社區節能補助－D低收入戶汰換冰箱與冷氣', 'household_type', LOW, '/eligibility/raw_summary', '臺北市社會局列冊低收入戶'),
  gate('WEL-0075', '臺北市松山區民俗委員會獎助學金', 'household_type', LOW, '/eligibility/raw_summary', '設籍松山區滿6個月之低收入戶在學子女'),
  gate('WEL-0077', '臺北市低收入戶及中低收入戶購置電腦設備補助', 'household_type', BOTH, '/eligibility/household/0/raw', '列冊低收入戶或中低收入戶且有在學子女之家戶'),
  gate('WEL-0089', '臺北市50歲以上低收入及中低收入市民帶狀疱疹疫苗補助', 'household_type', BOTH, '/eligibility/raw_summary', '50歲以上低收入戶或中低收入戶市民'),
  gate('CT-0035', '低收入戶及中低收入戶學生學雜費減免', 'household_type', BOTH, '/eligibility/household/0/raw', '低收入戶及中低收入戶學生'),
  gate('CT-0038', '兒童及少年未來教育與發展帳戶', 'household_type', BOTH, '/eligibility/household/0/raw', '列冊之低收入戶或中低收入戶內兒童及少年'),
  gate('CT-0103', '臺北市中低收入戶健保費補助', 'household_type', MID, '/eligibility/household/0/raw', '臺北市中低收入戶'),
  gate('CT-0104', '臺北市中低收入老人生活津貼', 'household_type', MID, '/eligibility/raw_summary', '設籍臺北市、65歲以上的中低收入長者'),
  gate('CT-0123', '臺北市低收入戶租金補貼', 'household_type', LOW, '/eligibility/household/0/raw', '設籍本市低收入戶列冊人口；申請人須為低收入戶輔導人口'),
  gate('CT-0126', '臺北市中低收入戶醫療補助', 'household_type', MID, '/eligibility/household/0/raw', '本市列冊中低收入戶'),
  gate('CT-0129', '臺北市低收入戶就學生活補助', 'household_type', LOW, '/eligibility/household/0/raw', '本市列冊低收入戶'),
  gate('CT-0130', '臺北市低收入戶交通費補助', 'household_type', LOW, '/eligibility/household/0/raw', '本市低收入戶家庭成員'),
  gate('CT-0034', '老年農民福利津貼（老農津貼）', 'special_identity', ['farmer'], '/eligibility/employment/0/statuses/0', '農保被保險人'),
  gate('CT-0099', '榮民就養給付', 'special_identity', ['veteran'], '/extensions/0/raw', '應具有「國軍退除役官兵輔導條例」第2條規定之退除役官兵身分'),
  gate('CT-0069', '國民年金原住民給付', 'special_identity', ['indigenous'], '/extensions/0/key', 'indigenous_status'),
  gate('CT-0149', '臺北市都市原住民家庭租屋補貼', 'special_identity', ['indigenous'], '/extensions/1/key', 'indigenous_status'),
];
const byId = new Map(IDENTITY_GATES.map(g => [g.id, g]));

function pointer(item: Subsidy, path: string): unknown {
  return path.split('/').slice(1).reduce<unknown>((v, k) => v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined, item);
}
/** Changed source text disables the entry, so stale reviews never demote a resource. */
export function identityGateFor(item: Subsidy): IdentityGate | null {
  const row = byId.get(item.id);
  return row && row.name === item.name && pointer(item, row.evidence.path) === row.evidence.value ? row : null;
}
export function identityAnswer(answers: Answers, field: IdentityField): string | undefined {
  const value = field === 'household_type' ? answers.household_type : answers.extra?.special_identity;
  return typeof value === 'string' ? value : undefined;
}
export function identityStatus(item: Subsidy, answers: Answers): IdentityStatus {
  const row = identityGateFor(item);
  if (!row) return 'none';
  const value = identityAnswer(answers, row.field);
  if (value === undefined) return 'unknown';
  if (row.values.includes(value)) return 'met';
  return row.field === 'special_identity' && value === 'none' ? 'conflict' : 'unmet';
}
