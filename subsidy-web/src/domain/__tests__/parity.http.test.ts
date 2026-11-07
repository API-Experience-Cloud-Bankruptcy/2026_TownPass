// Explicit integration test: synthetic profiles only, never called by the UI.
import { describe, expect, it } from 'vitest';
import { evaluateAll } from '../match';
import { buildLocalQuestions } from '../questions';
import { REVIEW_VERSION, taipeiToday } from '../reviewed-rules';
import type { Answers } from '../types';
import { realItems } from './real-data';
const base=(globalThis as {process?:{env:Record<string,string|undefined>}}).process?.env.WELFARE_TEST_API;
describe.skipIf(!base)('實際HTTP前後端完整資料一致性',()=>{
  it('catalog完整原文、題庫支撐與217筆多情境fit完全一致',async()=>{
    const catalog=await fetch(`${base}/api/catalog`).then(r=>r.json());
    expect(catalog.items).toEqual(realItems);
    const bank=await fetch(`${base}/api/questions`).then(r=>r.json());
    expect(bank.version).toContain(REVIEW_VERSION);
    const support=(qs: {field:string;resource_ids:string[]}[])=>qs.map(q=>({field:q.field,ids:[...q.resource_ids].sort()})).sort((a,b)=>a.field.localeCompare(b.field));
    expect(support(bank.questions)).toEqual(support(buildLocalQuestions(realItems)));
    const profiles:Answers[]=[{},...[0,17,18,29,40,41,65,99].map(age=>({age})),
      {age:18,is_student:true},{age:18,is_student:false},{region:'其他縣市'},{region:'臺北市'},
      {household_type:'general'},{household_type:'low_income'},{household_type:'mid_low_income'},
      {age:99,region:'其他縣市',is_student:true,household_type:'general'}];
    const today=taipeiToday();
    for(const profile of profiles){
      const pages=[];
      for(const offset of [0,200]){
        const response=await fetch(`${base}/api/match`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...profile,include_ineligible:true,limit:200,offset,view:'full'})});
        expect(response.status).toBe(200);pages.push(await response.json());
      }
      expect(pages[0].total).toBe(217);
      const actual=new Map<string,string>(pages.flatMap(p=>p.items).map((i:{id:string;match:{fit:string}})=>[i.id,i.match.fit]));
      const expected=evaluateAll(realItems,profile,today);
      expect(actual.size).toBe(217);
      for(const [id,r] of expected)expect(actual.get(id),`${id} ${JSON.stringify(profile)}`).toBe(r.fit);
    }
    console.info(`HTTP parity: ${profiles.length} profiles × 217 records = ${profiles.length*217} fit comparisons, date ${today}`);
  },30000);
});
