// Source-bound discovery is kept separate from necessary qualification gates.
import manifest from '../../../backend/rules/adaptive-reviewed.json';
import templates from '../../../backend/rules/question-templates.json';
import { requirementVerdict, reviewFor, sourceFingerprint, taipeiToday, type ReviewedRecord } from './reviewed-rules';
import { evaluateAll } from './match';
import { identityAnswer, identityGateFor, identityStatus, type IdentityField, type IdentityGate } from './identity';
import type { Answers, Question, Subsidy } from './types';

export interface Evidence { path: string; value: string }
export interface RankingPreference {
  field: 'household_type'; values: string[]; evidence: Evidence[]; reason: string;
}
export interface AdaptiveReview {
  id: string; name: string; source_fingerprint: string; review_note: string; situations: string[];
  facets: { field: string; values: string[]; evidence: Evidence[]; reason: string }[];
  manual_conditions: (Evidence & { reason: string })[];
  alternatives_note: string; source_urls: string[]; current_policy_verified: false;
  attachment_urls?: string[]; missing_fields?: string[];
  document_overrides?: {index:number;required:boolean|null;condition:string;notes:string;evidence:Evidence[]}[];
  ranking_preferences?: RankingPreference[];
}
export const adaptiveRecords = manifest.records as AdaptiveReview[];
export const ADAPTIVE_VERSION = `${manifest.version}-${sourceFingerprint(manifest)}`;
export const TEMPLATE_VERSION = `${templates.version}-${sourceFingerprint(templates)}`;
const duplicateIds=new Set(adaptiveRecords.filter((r,i,a)=>a.findIndex(x=>x.id===r.id)!==i).map(r=>r.id));
const rows = new Map(adaptiveRecords.map(r => [r.id, r]));
export const questionTemplates = templates.questions as unknown as Question[];
export function adaptiveReviewFor(item: Subsidy): AdaptiveReview | null {
  const row = rows.get(item.id);
  if (!row || !row.facets.length || duplicateIds.has(item.id) || row.name!==item.name || row.source_fingerprint !== sourceFingerprint(item)) return null;
  const pointer = (path: string): unknown => path.split('/').slice(1).reduce<unknown>((v,k) => v && typeof v === 'object' ? (v as Record<string,unknown>)[k.replace(/~1/g,'/').replace(/~0/g,'~')] : undefined,item);
  for(const facet of row.facets) {
    const template=questionTemplates.find(q=>q.field===facet.field);
    if(!template||!facet.reason?.trim()||!facet.values.length||!facet.evidence.length||facet.values.some(v=>!template.options?.some(o=>String(o.value)===v))) return null;
  }
  for (const preference of row.ranking_preferences ?? []) {
    const template = questionTemplates.find(q => q.field === preference.field);
    if (preference.field !== 'household_type' || !preference.reason?.trim() || !preference.evidence.length || !preference.values.length || preference.values.some(v => !template?.options?.some(o => o.value === v))) return null;
  }
  if ([...row.facets.flatMap(f => f.evidence), ...row.manual_conditions,...(row.document_overrides??[]).flatMap(d=>d.evidence), ...(row.ranking_preferences??[]).flatMap(p=>p.evidence)].some(e => pointer(e.path) !== e.value)) return null;
  if (row.source_urls.some(url => !item.source_meta.sources.some(s => s.type === 'official' && s.url === url))) return null;
  return row;
}
export function scalarAnswer(answers: Answers, field: string): string | number | boolean | undefined {
  return field in answers ? (answers as unknown as Record<string,string|number|boolean>)[field] : answers.extra?.[field];
}
export function branchArea(answers: Answers, situation: string | null): string | undefined {
  const explicit=typeof answers.extra?.need_area==='string'?answers.extra.need_area:undefined;
  const expense={rent:'housing',treatment:'health',daily:'living',tuition:'study',care:'elder',child:'family'}[String(answers.extra?.expense_priority)];
  const context={student:'study',working:'work',jobseeker:'work',retired:'elder',care_child:'family',care_adult:'elder'}[String(answers.extra?.explore_context)];
  return situation ?? explicit ?? expense ?? context ?? (answers.is_student===true?'study':undefined);
}
/** Preference mismatch never changes MatchResult.fit; the full non-ineligible pool stays accessible. */
const DETAIL_DISCOVERY_FIELDS=new Set(['education_support','work_support','housing_support','care_context','family_stage','health_support','living_support','disability_support','community_support','elder_support','work_applicant','benefit_style']);
/** Dominates preference matches so unanswered identity prerequisites never lead the focus list. */
const IDENTITY_WEIGHT=100;
function scoreReview(row: AdaptiveReview | null, answers: Answers, situation: string | null, item?: Subsidy): {score:number; conflicts:number; matches:number; unmapped:number} {
  let score=0,conflicts=0,matches=0,unmapped=0;
  for(const field of DETAIL_DISCOVERY_FIELDS) if(scalarAnswer(answers,field)!==undefined&&!row?.facets.some(f=>f.field===field)) {unmapped++;score-=1;}
  for(const facet of row?.facets??[]) {
    const value=facet.field==='need_area'?branchArea(answers,situation):scalarAnswer(answers,facet.field);
    if(value===undefined) continue;
    if(facet.values.includes(String(value))) {matches++;score+=facet.field==='need_area'?8:4;}
    else {conflicts++;score-=facet.field==='need_area'?8:4;}
  }
  const identity=item?identityStatus(item,answers):'none';
  if(identity==='met') {matches++;score+=IDENTITY_WEIGHT;}
  else if(identity==='unknown'||identity==='unmet') score-=IDENTITY_WEIGHT;
  else if(identity==='conflict') {conflicts++;score-=IDENTITY_WEIGHT;}
  return {score,conflicts,matches,unmapped};
}
export function discoveryScore(item: Subsidy, answers: Answers, situation: string | null): {score:number; conflicts:number; matches:number; unmapped:number} {
  return scoreReview(adaptiveReviewFor(item),answers,situation,item);
}
const IDENTITY_FIELDS = new Set(['household_type', 'disability_certificate', 'has_farmer_insurance', 'veteran_status']);
/** Sorting support is not an eligibility verdict or an approval probability. */
export function identityRanking(item: Subsidy, answers: Answers): {unconfirmed: number; preferred: number} {
  const unconfirmed = (reviewFor(item)?.requirements ?? []).filter(rule => IDENTITY_FIELDS.has(rule.field) && requirementVerdict(rule, answers, taipeiToday()) === null).length;
  const preferred = (adaptiveReviewFor(item)?.ranking_preferences ?? []).filter(preference => preference.values.includes(String(scalarAnswer(answers, preference.field)))).length;
  return {unconfirmed, preferred};
}
export function availability(item: Subsidy, today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})): 'closed'|'unknown'|'prepare' {
  const d = item.application.deadline;
  if (d.end && /^\d{4}-\d{2}-\d{2}/.test(d.end) && d.end.slice(0,10) < today) return 'closed';
  const status = item.source_meta.application_status;
  if (typeof status !== 'string' || !status.trim()) return 'unknown';
  if(/已截止|已結束|停止受理|額滿/.test(status)) return /^(已截止|已結束|停止受理|額滿)[。！!]?\s*$/.test(status.trim())?'closed':'unknown';
  if(/待確認|未確認|未公告|尚未|未開放|暫停|預計|待公告/.test(status)) return 'unknown';
  return 'prepare';
}
export function relevantCandidates(items: Subsidy[], answers: Answers, situation: string | null): Subsidy[] {
  const results = evaluateAll(items, answers);
  return items.filter(item => {const score=discoveryScore(item,answers,situation);return results.get(item.id)?.fit !== 'ineligible' && score.conflicts===0&&score.unmapped===0;});
}
export function questionApplies(q: Question, answers: Answers, situation: string | null): boolean {
  const area = branchArea(answers,situation);
  if (q.field === 'need_area') return !area && answers.extra?.expense_priority==='uncertain';
  if(q.field==='explore_context') return !situation&&!answers.extra?.need_area;
  if(q.field==='expense_priority') return !situation&&!area;
  if (q.purpose!=='qualification'&&q.situations?.length && (!area || !q.situations.includes(area))) return false;
  return Object.entries(q.depends_on ?? {}).every(([field,values]) => values.includes(scalarAnswer(answers,field) as string|boolean));
}
const ENTRY_FIELDS=new Set(['need_area','explore_context','expense_priority']);
const TOP_LEVEL_FIELDS=new Set(['age','region','is_student','household_type']);
function withAnswer(answers: Answers, field: string, value: string|boolean): Answers {
  return TOP_LEVEL_FIELDS.has(field) ? {...answers,[field]:value} : {...answers,extra:{...answers.extra,[field]:value}};
}
/** Whether answering `value` would move, demote or promote any surviving resource. */
function optionChanges(field: string, value: string|boolean, items: Subsidy[], reviews: Map<string,AdaptiveReview|null>, gates: Map<string,ReviewedRecord|null>, identities: Map<string,IdentityGate|null>, answers: Answers, today: string): boolean {
  const next=withAnswer(answers,field,value);
  return items.some(i=>{
    const facet=reviews.get(i.id)?.facets.find(f=>f.field===field);
    if(facet&&!facet.values.includes(String(value))) return true;
    if(gates.get(i.id)?.requirements.some(r=>r.field===field&&requirementVerdict(r,next,today)===false)) return true;
    return identities.get(i.id)?.field===field&&identityStatus(i,next)!==identityStatus(i,answers);
  });
}
/** Re-rank after each answer using current supported partitions and gate coverage. */
export function rankQuestions(bank: Question[], items: Subsidy[], answers: Answers, situation: string | null, visited: Set<string>): Question[] {
  // These indexes live for this recomputation only; mutated original data cannot reuse an old binding.
  const reviews=new Map(items.map(i=>[i.id,adaptiveReviewFor(i)]));
  const gates=new Map(items.map(i=>[i.id,reviewFor(i)]));
  const identities=new Map(items.map(i=>[i.id,identityGateFor(i)]));
  const results=evaluateAll(items,answers);
  const nonIneligible=items.filter(i=>results.get(i.id)?.fit!=='ineligible');
  const remaining=nonIneligible.filter(i=>(()=>{const score=scoreReview(reviews.get(i.id)??null,answers,situation,i);return score.conflicts===0&&score.unmapped===0;})());
  const supported=remaining;
  const supportedSet=new Set(supported.map(i=>i.id));
  const area = branchArea(answers,situation);
  const today=taipeiToday();
  // Resources whose identity prerequisite this question would settle.
  const openIdentity=(field:string)=>supported.filter(i=>{const row=identities.get(i.id);return row?.field===field&&identityAnswer(answers,row.field as IdentityField)===undefined;});
  return bank.filter(q => !visited.has(q.id) && questionApplies(q,answers,situation) && (q.resource_ids.some(id => supportedSet.has(id))||openIdentity(q.field).length>0))
    .map((q,index) => {
      const supportedIds = new Set(q.resource_ids);
      const coverage = supported.filter(i=>supportedIds.has(i.id)).length;
      const counts = (q.options ?? []).map(o => supported.filter(i => {
        const facet = reviews.get(i.id)?.facets.find(f=>f.field===q.field);
        return !facet || facet.values.includes(String(o.value));
      }).length);
      const distinct = new Set(counts).size;
      const split = counts.length ? Math.max(0,...counts)-Math.min(...counts) : coverage * .5;
      const gateCount = supported.filter(i=>gates.get(i.id)?.requirements.some(r=>r.field===q.field)).length;
      const identityCoverage = supported.filter(i => gates.get(i.id)?.requirements.some(r => r.field === q.field && IDENTITY_FIELDS.has(q.field)) || reviews.get(i.id)?.ranking_preferences?.some(p => p.field === q.field)).length;
      const priority = !situation&&!answers.extra?.need_area&&q.field==='explore_context'?10000 : !situation&&!area&&q.field==='expense_priority'?9000 : q.field==='is_student'&&area==='study'?8000 : identityCoverage > 0 ? 1000 : 0;
      const detailUtility=DETAIL_DISCOVERY_FIELDS.has(q.field)&&q.field!=='benefit_style'?Math.min(15,coverage):0;
      // Only a split between identity-bound and open resources counts; weighted by share so
      // identity is asked once needs have narrowed the surviving resources.
      const gated=openIdentity(q.field);
      const identityUtility=gated.length&&gated.length<supported.length?10*gated.length/supported.length:0;
      const score = priority + detailUtility + identityUtility + gateCount*3 + coverage*.2 + split + distinct - (q.burden??1)*2;
      let options=q.options;
      // Keep all options for qualification gates. Discovery options reflect supported surviving directions.
      if (q.field==='special_identity' && options) {
        const values=new Set(gated.flatMap(i=>identities.get(i.id)?.values??[]));
        options=options.filter(o=>o.value==='none'||values.has(String(o.value)));
      } else if (gateCount === 0 && options) {
        const values=new Set(supported.flatMap(i=>reviews.get(i.id)?.facets.filter(f=>f.field===q.field).flatMap(f=>f.values)??[]));
        if (values.size > 0) options=options.filter(o=>values.has(String(o.value)));
        const choices = options.map(option => {
          const next: Answers = q.field === 'household_type'
            ? {...answers, household_type: option.value as Answers['household_type']}
            : {...answers, extra: {...answers.extra, [q.field]: option.value}};
          const retained = supported.filter(item => {
            const result = scoreReview(reviews.get(item.id) ?? null, next, situation);
            return result.conflicts === 0 && result.unmapped === 0;
          });
          // A ranking preference can distinguish options without excluding anyone.
          const signature = retained.map(item => `${item.id}:${(reviews.get(item.id)?.ranking_preferences ?? []).filter(p => p.values.includes(String(scalarAnswer(next, p.field)))).length}`).join('|');
          return {option, retained, signature};
        }).filter(choice => choice.retained.length > 0);
        if (choices.length < 2 || new Set(choices.map(choice => choice.signature)).size < 2) return null;
        options = choices.map(choice => choice.option);
      }
      if (q.field === 'special_identity' && !options?.some(o => optionChanges(q.field,o.value,supported,reviews,gates,identities,answers,today))) return null;
      if (q.kind !== 'number' && !ENTRY_FIELDS.has(q.field) && (options?.length ?? 0) < 2) return null;
      return {q:{...q,options},score,index};
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.q);
}
