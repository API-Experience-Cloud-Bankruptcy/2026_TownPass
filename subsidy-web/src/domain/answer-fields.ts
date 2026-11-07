import templates from '../../../backend/rules/question-templates.json';
import type { Question } from './types';
const LEGACY_FIELDS = new Set(['age','region','is_student','household_type']);
/** Personal status that ranks and focuses resources; never an eligibility rule by itself. */
export const SPECIAL_IDENTITY_QUESTION: Question = {
  id: 'q-special-identity', field: 'special_identity', kind: 'single', title: '是否具有下列身分？', burden: 1, purpose: 'discovery', resource_ids: [],
  options: [
    { label: '曾參加農保（農民健康保險）', value: 'farmer' },
    { label: '退除役官兵（榮民）', value: 'veteran' },
    { label: '原住民', value: 'indigenous' },
    { label: '都不是', value: 'none' },
  ],
};
const TEMPLATES: { field: string; options?: { value: unknown }[] }[] = [...templates.questions, SPECIAL_IDENTITY_QUESTION];
export const EXTRA_QUALIFICATION_FIELDS = new Set(['education_level','is_unemployed','is_renting','owns_home','disability_certificate','special_identity']);
/** A bounded shared vocabulary prevents imported/session answers from storing arbitrary personal text. */
export function validExtraValue(field: string, value: unknown): value is string | boolean {
  if (LEGACY_FIELDS.has(field)) return false;
  const template=TEMPLATES.find(q=>q.field===field);
  return !!template?.options?.some(option=>option.value===value);
}
export function validExtraRuleValues(field:string,values:string[]): boolean {
  return EXTRA_QUALIFICATION_FIELDS.has(field)&&values.length>0&&values.every(value=>validExtraValue(field,value));
}
