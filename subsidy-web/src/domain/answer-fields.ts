import templates from '../../../backend/rules/question-templates.json';
const LEGACY_FIELDS = new Set(['age','region','is_student','household_type']);
export const EXTRA_QUALIFICATION_FIELDS = new Set(['education_level','is_unemployed','is_renting','owns_home','disability_certificate']);
/** A bounded shared vocabulary prevents imported/session answers from storing arbitrary personal text. */
export function validExtraValue(field: string, value: unknown): value is string | boolean {
  if (LEGACY_FIELDS.has(field)) return false;
  const template=templates.questions.find(q=>q.field===field);
  return !!template?.options?.some(option=>option.value===value);
}
export function validExtraRuleValues(field:string,values:string[]): boolean {
  return EXTRA_QUALIFICATION_FIELDS.has(field)&&values.length>0&&values.every(value=>validExtraValue(field,value));
}
