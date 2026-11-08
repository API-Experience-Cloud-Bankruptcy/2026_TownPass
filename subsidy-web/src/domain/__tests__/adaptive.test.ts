import { describe, expect, it } from 'vitest';
import { adaptiveRecords, adaptiveReviewFor, availability, discoveryScore, rankQuestions, relevantCandidates } from '../adaptive';
import { buildLocalQuestions, setAnswer } from '../questions';
import { evaluate, evaluateAll } from '../match';
import { buildRoute } from '../route';
import { buildPlanText } from '../export';
import { effectiveDocuments, mergeDocuments } from '../documents';
import { buildEvidencePack } from '../evidence-pack';
import { filterCatalog } from '../situations';
import { validExtraValue } from '../answer-fields';
import { ENGINE_VERSION, migrateSession } from '../bootstrap';
import { emptySession, loadSession, SESSION_KEY } from '../session';
import type { Answers } from '../types';
import { realItem, realItems } from './real-data';

describe('217筆完整逐筆審閱與保守新條件',()=>{
  it('全部來源綁定、逐筆說明、條件及官方來源保留；資料變更停用',()=>{
    expect(adaptiveRecords).toHaveLength(217);expect(new Set(adaptiveRecords.map(r=>r.id)).size).toBe(217);
    for(const item of realItems) {
      const row=adaptiveReviewFor(item);expect(row,item.id).not.toBeNull();
      expect(row!.review_note.length).toBeGreaterThan(10);expect(row!.alternatives_note.length).toBeGreaterThan(5);
      expect(row!.current_policy_verified).toBe(false);expect(row!.manual_conditions.length).toBeGreaterThan(0);
      expect(row!.missing_fields).toEqual(item.source_meta.missing_fields??[]);
      const changed=structuredClone(item);changed.source_meta.checked_date='2099-01-01';expect(adaptiveReviewFor(changed)).toBeNull();
    }
  });
  it('新增學段OR、證明與指定住宅關係；未知不排除、探索狀態不當資格',()=>{
    const today='2026-11-07';
    expect(evaluate(realItem('WEL-0003'),{extra:{education_level:'graduate'}},today).fit).toBe('ineligible');
    for(const level of ['secondary','college','graduate'])expect(evaluate(realItem('WEL-0028'),{household_type:'general',extra:{education_level:level}},today).fit).toBe('possible');
    expect(evaluate(realItem('WEL-0032'),{extra:{education_level:'college'}},today).fit).toBe('possible');
    expect(evaluate(realItem('WEL-0038'),{extra:{is_renting:false}},today).fit).toBe('ineligible');
    expect(evaluate(realItem('WEL-0068'),{extra:{owns_home:false}},today).fit).toBe('ineligible');
    expect(evaluate(realItem('WEL-0107'),{extra:{is_unemployed:false}},today).fit).toBe('ineligible');
    expect(evaluate(realItem('CT-0146'),{extra:{disability_certificate:false}},today).fit).toBe('ineligible');
    for(const id of ['CT-0113','CT-0099','WEL-0117','CT-0068'])expect(evaluate(realItem(id),{extra:{disability_certificate:false,employment_status:'retired',housing_status:'owning'}},today).fit).toBe('possible');
    expect(evaluate(realItem('WEL-0038'),{},today).fit).toBe('possible');
  });
  it('混合學校期限、空白及暫停不是整案已截止或目前受理',()=>{
    expect(availability(realItem('WEL-0008'),'2026-11-07')).toBe('unknown');
    const item=structuredClone(realItem('WEL-0002'));item.application.deadline.end=null;
    for(const status of ['', '尚未開放', '暫停受理','部分梯次已截止，其餘依學校期限']) {item.source_meta.application_status=status;expect(availability(item,'2026-11-07')).toBe('unknown');}
    item.application.deadline.end='2026-10-01';expect(availability(item,'2026-11-07')).toBe('closed');
  });
  it('文件overlay傳入畫面路線及輸出，保留原始資料',()=>{
    const item=realItem('WEL-0002');expect(item.application.required_documents[1].required).toBe(true);
    const docs=effectiveDocuments(item);expect(buildRoute(item).documents.every(d=>d.required===false)).toBe(true);expect(docs.every(d=>d.required===false)).toBe(true);
    expect(docs[1].condition).toContain('加碼');expect(mergeDocuments([item]).documents.every(d=>d.condition.includes('加碼'))).toBe(true);
    expect(effectiveDocuments(realItem('WEL-0100'))[1].condition).toContain('疑混入');
    expect(effectiveDocuments(realItem('CT-0113'))[0].condition).toContain('永久居留外國人');
    const output=buildPlanText({meta:{catalogVersion:'test',sourceLabel:'test',generatedAt:new Date('2026-11-07T00:00:00Z')},target:'self',items:[item],results:evaluateAll([item],{}),conditions:[],docChecks:{},stepDone:{}});expect(output).toContain('非必備');expect(output).toContain('僅申請對應身分的加碼');
    const pack=buildEvidencePack(item,1000);expect(pack.current_policy_verified).toBe(false);expect(pack.document_overrides).toHaveLength(3);expect(pack.omitted_manual_count).toBeGreaterThan(0);
  });
});

it('只保存支援的本機選項；模板或探索變版會清除舊探索與看題紀錄',()=>{
  expect(validExtraValue('education_level','college')).toBe(true);expect(validExtraValue('address','某人地址')).toBe(false);
  const state={...emptySession('self'),catalogVersion:'same',rulesVersion:'same',engineVersion:'old-template',answers:{age:20,extra:{education_level:'college',address:'個資',is_renting:true}},seenQuestions:['q-age'],stepDone:{A:[0]}};
  const storage={getItem:()=>JSON.stringify(state),setItem:()=>{},removeItem:()=>{}};
  const loaded=loadSession(storage);expect(loaded.answers.extra).toEqual({education_level:'college',is_renting:true});
  const patch=migrateSession(state,{version:'same',items:realItems});expect(patch.engineVersion).toBe(ENGINE_VERSION);expect(patch.seenQuestions).toEqual([]);expect(patch.answers.age).toBe(20);expect(patch.answers.extra).toBeUndefined();expect(Object.keys(patch.answers)).not.toContain('extra');
  expect(SESSION_KEY).toBeTruthy();
});

it('多情境隨答案選不同題目並實質縮小；每次略過不重問，探索不改資格',()=>{
  const scenarios:[string|null, Record<string,string|number|boolean>][]=[
    ['study',{is_student:true,education_level:'college',education_support:'tuition',age:20,household_type:'general',region:'臺北市',benefit_style:'fee_reduction'}],
    ['housing',{is_renting:true,owns_home:false,disability_certificate:false,housing_status:'renting',housing_support:'rent',benefit_style:'payment',household_type:'general',region:'臺北市',age:30}],
    ['work',{is_unemployed:true,employment_status:'unemployed',work_support:'job_search',work_applicant:'person',age:28,is_student:false,region:'臺北市'}],
    ['elder',{age:72,elder_support:'family_home_care',care_context:'home_care',employment_status:'retired',household_type:'general',region:'臺北市'}],
    [null,{explore_context:'uncertain',expense_priority:'rent',is_renting:true,owns_home:false,disability_certificate:false,housing_status:'renting',housing_support:'rent',benefit_style:'payment',household_type:'general',age:30}],
  ];
  const sequences:string[][]=[];
  for(const [area,profile] of scenarios) {
    const items=filterCatalog(realItems,area,'');const bank=buildLocalQuestions(items);let answers:Answers={};const visited=new Set<string>();const fields:string[]=[];
    for(let n=0;n<8;n++) {
      const q=rankQuestions(bank,items,answers,area,visited)[0];if(!q)break;
      expect(visited.has(q.id)).toBe(false);visited.add(q.id);fields.push(q.field);answers=setAnswer(answers,q,profile[q.field]);
    }
    const final=relevantCandidates(items,answers,area);
    expect(final.length,`${area}: ${fields}`).toBeLessThan(items.length);
    if(area==='elder')expect(fields).not.toContain('is_student');
    if(area===null){expect(fields[0]).toBe('explore_context');expect(fields).toContain('expense_priority');expect(fields.some(f=>f==='housing_support'||f==='is_renting')).toBe(true);}
    sequences.push(fields);
    const eligibleCount=[...evaluateAll(items,answers).values()].filter(r=>r.fit!=='ineligible').length;
    console.info(JSON.stringify({scenario:area??'unsure',initial:items.length,focused:final.length,nonIneligible:eligibleCount,questions:fields,ids:final.map(i=>i.id)}));
  }
  expect(new Set(sequences.map(s=>s.join(','))).size).toBe(5);
  const unrelated=realItem('WEL-0046');expect(discoveryScore(unrelated,{extra:{housing_support:'rent'}},'housing').unmapped).toBeGreaterThan(0);expect(evaluate(unrelated,{extra:{housing_support:'rent'}}).fit).toBe('possible');
  const item=realItem('WEL-0002');expect(discoveryScore(item,{extra:{education_support:'loan'}},'study').conflicts).toBeGreaterThan(0);expect(evaluate(item,{extra:{education_support:'loan'}}).fit).toBe('possible');
},30000);
