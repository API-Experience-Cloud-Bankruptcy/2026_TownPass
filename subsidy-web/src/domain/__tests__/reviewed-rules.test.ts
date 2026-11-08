import { describe, expect, it } from 'vitest';
import { adaptiveReviewFor } from '../adaptive';
import { ageVerdict, evaluate, evaluateAll } from '../match';
import { buildLocalQuestions, loadQuestions, setAnswer, titleFor } from '../questions';
import { reviewedRecords, reviewFor, REVIEW_VERSION, taipeiToday, requirementVerdict } from '../reviewed-rules';
import { buildPlanText } from '../export';
import { filterCatalog } from '../situations';
import { realItem, realItems } from './real-data';
const today = '2026-11-07';
const excluded99 = ['WEL-0031','WEL-0058','WEL-0082','WEL-0099','WEL-0100','WEL-0101','WEL-0106','WEL-0110','WEL-0111','WEL-0122','WEL-0125','WEL-0126','WEL-0128','WEL-0137','CT-0027','CT-0069','CT-0076','CT-0129','CT-0130'];
const protectedIds = ['CT-0019','CT-0148','WEL-0032','WEL-0042','WEL-0077','CT-0150','CT-0151','CT-0099','CT-0113','WEL-0102','WEL-0093','WEL-0094','CT-0093'];

describe('217筆來源綁定的必要條件', () => {
  it('全筆指紋及引用原文一致；27筆年齡已編碼，43筆有逐筆保留原因', () => {
    expect(realItems).toHaveLength(217);
    expect(reviewedRecords).toHaveLength(217);
    for (const item of realItems) {
      const row=reviewFor(item); expect(row,item.id).not.toBeNull();
      expect(row!.review_note.length).toBeGreaterThan(5);
      if (row!.requirements.length) expect(row!.source_urls.length).toBeGreaterThan(0);
    }
    expect(reviewedRecords.filter(r=>r.age_review==='required')).toHaveLength(27);
    expect(reviewedRecords.filter(r=>r.age_review==='deferred')).toHaveLength(43);
  });
  it('每個指定年齡都遍歷217筆；99歲只排除有證據的共同必要上限', () => {
    for (const age of [0,17,18,29,40,41,65,99]) {
      const results=evaluateAll(realItems,{age},today);expect(results.size).toBe(217);
      for (const r of results.values()) expect(r.fit).not.toBe('likely');
      for (const id of protectedIds) expect(results.get(id)!.fit,`${id} age=${age}`).toBe('possible');
    }
    const results=evaluateAll(realItems,{age:99},today);
    expect([...results.values()].filter(r=>r.fit==='ineligible').map(r=>r.id).sort()).toEqual([...excluded99].sort());
    for(const id of excluded99) expect(results.get(id)!.personal?.some(p=>p.field==='age'&&p.list==='blocked_by'),id).toBe(true);
  });
  it('CT0129為AND上下限；未知所得不抵消WEL0106必要年齡', () => {
    for(const [age,fit] of [[17,'ineligible'],[18,'possible'],[24,'possible'],[25,'ineligible']] as const)
      expect(evaluate(realItem('CT-0129'),{age},today).fit).toBe(fit);
    expect(evaluate(realItem('WEL-0106'),{age:99},today).fit).toBe('ineligible');
  });
  it('每筆可比較年齡規則的上下界、邊界內外均回歸', () => {
    for(const row of reviewedRecords) for(const rule of row.requirements.filter(r=>r.field==='age'&&r.basis==='current_age')) {
      if(rule.min!=null) {
        expect(ageVerdict(realItem(row.id),rule.min-1,today),row.id).toBe(false);
        expect(ageVerdict(realItem(row.id),rule.min,today),row.id).toBe(true);
      }
      if(rule.max!=null) {
        expect(ageVerdict(realItem(row.id),rule.max+1,today),row.id).toBe(false);
        expect(ageVerdict(realItem(row.id),rule.max,today),row.id).toBe(rule.max_inclusive!==false);
      }
    }
  });
  it('出生年集合按注入台北日期，並非普通當下18至40；未知日期不排除', () => {
    const item=realItem('WEL-0082');
    for(const [age,result] of [[15,false],[16,null],[17,true],[18,true],[38,true],[39,null],[40,false],[99,false]] as const)
      expect(ageVerdict(item,age,today),`age=${age}`).toBe(result);
    expect(ageVerdict(item,40,'2027-11-07')).toBeNull();
    expect(ageVerdict(item,99,'unknown')).toBeNull();
    expect(ageVerdict(item,99,'2026-02-30')).toBeNull();
    expect(ageVerdict(realItem('WEL-0058'),12,today)).toBeNull();
    expect(ageVerdict(realItem('WEL-0058'),13,today)).toBe(true);
    expect(ageVerdict(realItem('WEL-0058'),22,today)).toBeNull();
    expect(ageVerdict(realItem('WEL-0058'),23,today)).toBe(false);
    expect(ageVerdict(realItem('WEL-0089'),49,today)).toBeNull();
    expect(ageVerdict(realItem('WEL-0089'),50,today)).toBe(true);
    expect(taipeiToday(new Date('2026-11-06T16:00:00Z'))).toBe(today);
    expect(taipeiToday(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });
  it('徵件截止日期與開訓日未知不誤判下限；99歲不留作一般推薦',()=>{
    expect(ageVerdict(realItem('WEL-0128'),15,today)).toBeNull();
    expect(ageVerdict(realItem('WEL-0128'),16,today)).toBe(true);
    expect(ageVerdict(realItem('WEL-0128'),31,today)).toBeNull();
    expect(ageVerdict(realItem('WEL-0128'),32,today)).toBe(false);
    expect(ageVerdict(realItem('CT-0076'),0,today)).toBeNull();
    expect(ageVerdict(realItem('CT-0076'),29,today)).toBeNull();
    expect(ageVerdict(realItem('CT-0076'),30,today)).toBe(false);
  });
  it('原文、來源或未知條件新增變動即停用整筆規則，不能保留舊排除', () => {
    const base=realItem('WEL-0082');
    const mutations=[(x:typeof base)=>x.eligibility.age[0].raw+='例外', (x:typeof base)=>x.source_meta.checked_date='2030-01-01', (x:typeof base)=>x.eligibility.new_path='專案例外', (x:typeof base)=>x.source_meta.sources[0].url='https://example.org/changed'];
    for(const mutate of mutations) {const item=structuredClone(base);mutate(item);expect(reviewFor(item)).toBeNull();expect(evaluate(item,{age:99},today).fit).toBe('possible');expect(buildLocalQuestions([item])).toEqual([]);}
  });
});

describe('問答有用途且不混同主體或否定',()=>{
  it('未就學規則不因在學給正向理由；false與unknown不同',()=>{
    for(const id of ['WEL-0110','WEL-0111']) {
      const yes=evaluate(realItem(id),{age:18,is_student:true},today);
      expect(yes.fit).toBe('ineligible');expect(yes.reasons.some(x=>x.includes('在學'))).toBe(false);
      expect(evaluate(realItem(id),{age:18,is_student:false},today).fit).toBe('possible');
      expect(evaluate(realItem(id),{age:18},today).fit).toBe('possible');
    }
    // Daytime exclusion is narrower than any student; a parent's child is not the parent.
    for(const id of ['CT-0076','WEL-0063','WEL-0077','WEL-0117'])
      expect(evaluate(realItem(id),{is_student:true},today).reasons.some(x=>x.includes('在學')),id).toBe(false);
  });
  it('臺北市以外選項能排除已審閱必要設籍，跨地就學及外國居留路徑保留',()=>{
    const regionQ=buildLocalQuestions(realItems).find(q=>q.field==='region')!;
    expect(regionQ.options).toContainEqual({label:'臺北市以外',value:'其他縣市'});
    const answer=setAnswer({},regionQ,'其他縣市');
    for(const id of ['CT-0104','CT-0123','CT-0126','CT-0144','CT-0145','WEL-0089']) {
      expect(evaluate(realItem(id),answer,today).fit,id).toBe('ineligible');
      expect(evaluate(realItem(id),{},today).fit,id).toBe('possible');
    }
    for(const id of ['WEL-0098','CT-0113','WEL-0037']) expect(evaluate(realItem(id),answer,today).fit,id).toBe('possible');
    expect(requirementVerdict({field:'region',label:'multiple',evidence:[],values:['臺北市','新北市']},answer,today)).toBeNull();
  });
  it('必要家戶與其他替代途徑區分，不拿類型tag當完整資格',()=>{
    expect(evaluate(realItem('CT-0129'),{household_type:'general'},today).fit).toBe('ineligible');
    expect(evaluate(realItem('CT-0129'),{},today).fit).toBe('possible');
    expect(evaluate(realItem('CT-0126'),{household_type:'low_income'},today).fit).toBe('ineligible');
    for(const id of ['CT-0132','CT-0144','CT-0145']) expect(evaluate(realItem(id),{household_type:'general'},today).fit,id).toBe('possible');
  });
  it('題庫只包含有效review必要條件、年齡先問；排除舊後端無用途題庫',async()=>{
    const bank=buildLocalQuestions(realItems);expect(bank.length).toBeGreaterThan(15);
    for(const q of bank) for(const id of q.resource_ids) expect(['need_area','explore_context','expense_priority'].includes(q.field)||reviewFor(realItem(id))!.requirements.some(r=>r.field===q.field)||adaptiveReviewFor(realItem(id))!.facets.some(f=>f.field===q.field)||adaptiveReviewFor(realItem(id))!.ranking_preferences?.some(p=>p.field===q.field)).toBe(true);
    const age=bank.find(q=>q.field==='age')!;expect(titleFor(age,'self')).toContain('目前');expect(titleFor(age,'self')).not.toContain('今年');
    const result=await loadQuestions(realItems,{fetchImpl:async()=>new Response(JSON.stringify({version:'questions-v1/old',questions:bank}))});
    expect(result.origin).toBe('local');expect(result.version).toContain(REVIEW_VERSION);
  });
});

it('新規則的個資理由預設匯出不洩漏年齡、在學或家戶自述，選擇加入才輸出',()=>{
  const items=[realItem('WEL-0082'),realItem('WEL-0110'),realItem('CT-0129')];
  const results=evaluateAll(items,{age:99,is_student:true,household_type:'general'},today);
  const input={meta:{catalogVersion:'test',sourceLabel:'test',generatedAt:new Date('2026-11-07T00:00:00Z')},target:'self' as const,items,results,docChecks:{},stepDone:{}};
  const hidden=buildPlanText({...input,conditions:[]});
  for(const forbidden of ['填答年齡 99 歲','填答目前在學','填答：一般（未核定）']) expect(hidden).not.toContain(forbidden);
  const disclosed=buildPlanText({...input,conditions:[{field:'age',line:'年齡99歲'},{field:'is_student',line:'在學'},{field:'household_type',line:'一般'}]});
  for(const value of ['填答年齡 99 歲','填答目前在學','填答：一般（未核定）']) expect(disclosed).toContain(value);
});

it('工作需求不以青年泛詞納入文化藝術；全庫搜尋仍能取得',()=>{
  const work=filterCatalog(realItems,'work','');
  expect(work.some(i=>i.id==='WEL-0082')).toBe(false);
  for(const id of ['WEL-0110','WEL-0126']) expect(work.some(i=>i.id===id),id).toBe(true);
  expect(filterCatalog(realItems,null,'')).toHaveLength(217);
  expect(filterCatalog(realItems,null,'青年藝術').some(i=>i.id==='WEL-0082')).toBe(true);
});

it('來源URL必須非空且仍屬該筆官方來源（兩端相同gate）',()=>{
  const item=realItem('WEL-0082');const row=reviewedRecords.find(r=>r.id===item.id)!;const original=row.source_urls;
  try {
    row.source_urls=[];expect(reviewFor(item)).toBeNull();
    row.source_urls=['https://example.org/unreviewed'];expect(reviewFor(item)).toBeNull();
  } finally {row.source_urls=original;}
  expect(reviewFor(item)).not.toBeNull();
});
it('完整217筆evaluateAll耗時記錄（桌面Node，非手機驗收）',()=>{
  const samples:number[]=[];
  for(let i=0;i<4;i++){const start=performance.now();const result=evaluateAll(realItems,{age:99},today);samples.push(performance.now()-start);expect(result.size).toBe(217);}
  console.info(`217-record evaluateAll milliseconds: ${samples.map(n=>n.toFixed(1)).join(', ')}`);
});

it('全文審閱包含age陣列以外：WEL0031必要20至未滿46歲且題庫支援',()=>{
  const item=realItem('WEL-0031');expect(item.eligibility.age).toEqual([]);
  for(const [age,expected] of [[19,'ineligible'],[20,'possible'],[45,'possible'],[46,'ineligible'],[99,'ineligible']] as const)
    expect(evaluate(item,{age},today).fit,`age ${age}`).toBe(expected);
  const question=buildLocalQuestions([item]).find(q=>q.field==='age');expect(question?.resource_ids).toEqual(['WEL-0031']);
  // enrollment_required=false means a graduation prerequisite here, not "must not be studying".
  expect(evaluate(item,{is_student:true},today).fit).toBe('possible');
  expect(buildLocalQuestions([item]).some(q=>q.field==='is_student')).toBe(false);
  const changed=structuredClone(item);changed.eligibility.taipei_applicability='改為依新公告';
  expect(reviewFor(changed)).toBeNull();expect(evaluate(changed,{age:99},today).fit).toBe('possible');
  // Full-text age mentions with different subjects or bonus amounts are not global gates.
  for(const id of ['WEL-0038','WEL-0041','WEL-0043','WEL-0060','WEL-0068','WEL-0112','WEL-0115','WEL-0120','WEL-0124','WEL-0138','CT-0103','CT-0122','CT-0140','CT-0149'])
    expect(evaluate(realItem(id),{age:99},today).fit,id).toBe('possible');
});
it('青年藝術搜尋只命中實際含完整詞者，短詞仍可查全庫',()=>{
  expect(filterCatalog(realItems,null,'青年藝術').map(i=>i.id)).toEqual(['WEL-0082']);
  expect(filterCatalog(realItems,null,'青年 藝術').some(i=>i.id==='WEL-0082')).toBe(true);
  expect(filterCatalog(realItems,null,'留學').some(i=>i.id==='WEL-0031')).toBe(true);
  expect(filterCatalog(realItems,null,'青年').some(i=>i.id==='WEL-0031')).toBe(true);
  expect(filterCatalog(realItems,null,'')).toHaveLength(217);
});
it('已由reviewed戶籍排除後不再輸出不據此排除的矛盾提醒',()=>{
  const r=evaluate(realItem('CT-0104'),{region:'其他縣市'},today);
  expect(r.fit).toBe('ineligible');expect(r.warnings.some(w=>w.includes('不據此排除'))).toBe(false);
  expect(evaluate(realItem('CT-0113'),{region:'其他縣市'},today).warnings.some(w=>w.includes('不據此排除'))).toBe(true);
});
