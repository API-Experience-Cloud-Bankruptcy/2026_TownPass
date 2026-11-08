import { isClosed } from '../domain/browse';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptySession } from '../domain/session';
import { makeSubsidy } from '../domain/__tests__/fixtures';
import type { CandidateFact } from '../chat/interpretation';
import {
  answerAndAdvance, applyConfirmedFacts, back, confirmPending, go, pendingSwitch, questions,
  requestNewPerson, requestTarget, resetPerson, searchResources, selectNeed,
  startQuestions, state, tab,
  pendingResume, continueConversation, newConversation, conversationEpoch,
  openDetail, togglePlan, toggleStep, planResults, detailAnswers, clearAllData,
  openPlanItem, openStepHelp, removeFromPlan, resetSteps,
  requestConfirmedConversation, type ConfirmedConversationProposal,
} from '../store';

beforeEach(() => {
  resetPerson(null);
  state.personalPlan = emptySession('self');
  pendingSwitch.value = null;
  state.loading = false;
  state.catalog = {
    version: 'test', origin: 'api', sourceLabel: 'test',
    items: [
      makeSubsidy({ id: 'housing', name: '租屋補助', classification: { category: '住宅', benefit_type: '' } }),
      makeSubsidy({ id: 'study', name: '助學金', classification: { category: '教育', benefit_type: '' } }),
    ],
  };
  state.bank = { version: 'test', origin: 'local', questions: [
    { id: 'region', field: 'region', title: '戶籍？', kind: 'single', options: [{ label: '臺北市', value: '臺北市' }, { label: '臺北市以外', value: '其他縣市' }], resource_ids: ['housing', 'study'] },
    { id: 'age', field: 'age', title: '年齡？', kind: 'number', resource_ids: ['housing'] },
    { id: 'student', field: 'is_student', title: '在學？', kind: 'boolean', options: [{ label: '是', value: true }, { label: '否', value: false }], resource_ids: ['study'] },
  ] };
});

describe('逐頁找資源', () => {
  it('幫別人找時，總覽詳情仍是本人行動單，不使用對方條件或進度', () => {
    requestTarget('other');
    state.session.answers = { age: 72, region: '其他縣市' };
    state.personalPlan.answers = { age: 30, region: '臺北市' };
    tab('browse'); openDetail('housing');
    expect(state.detailTarget).toBe('self');
    expect(detailAnswers.value).toEqual({ age: 30, region: '臺北市' });
    togglePlan('housing'); toggleStep('housing', 0);
    expect(state.personalPlan.planIds).toEqual(['housing']);
    expect(state.personalPlan.stepDone).toEqual({ housing: [0] });
    back(); expect(state.view).toBe('browse');
    tab('results'); openDetail('housing');
    expect(state.detailTarget).toBe('other');
    expect(detailAnswers.value.age).toBe(72);
    togglePlan('housing'); toggleStep('housing', 1);
    expect(state.personalPlan.planIds).toEqual(['housing']);
    expect(state.personalPlan.stepDone).toEqual({ housing: [0] });
    expect(planResults.value.get('housing')).toBeDefined();
  });
  it('本人還沒加入行動單就打勾步驟：自動加入並記下進度', () => {
    tab('browse'); openDetail('housing');
    expect(state.detailTarget).toBe('self');
    toggleStep('housing', 0);
    expect(state.personalPlan.planIds).toEqual(['housing']);
    expect(state.personalPlan.stepDone).toEqual({ housing: [0] });
  });
  it('行動單列表進到單張行動單，詳情與行動單互相返回不疊層', () => {
    state.personalPlan.planIds = ['housing', 'study'];
    tab('plan'); openPlanItem('housing');
    expect(state.view).toBe('planItem'); expect(state.planItemId).toBe('housing');
    toggleStep('housing', 0); toggleStep('housing', 1);
    expect(state.personalPlan.stepDone).toEqual({ housing: [0, 1] });
    openDetail('housing'); expect(state.view).toBe('detail'); expect(state.detailTarget).toBe('self');
    openPlanItem('housing'); expect(state.view).toBe('planItem'); expect(state.history).toEqual(['plan']);
    back(); expect(state.view).toBe('plan');
  });
  it('步驟協助獨立換頁，返回原步驟且不修改進度，切分頁不殘留返回焦點', () => {
    state.personalPlan.planIds = ['housing'];
    tab('plan'); openPlanItem('housing');
    const before = JSON.stringify(state.personalPlan);
    openStepHelp('housing', '準備文件');
    expect(state.view).toBe('stepHelp');
    expect(state.history).toEqual(['plan', 'planItem']);
    expect(state.helpStep).toBe('準備文件');
    back();
    expect(state.view).toBe('planItem');
    expect(state.helpReturnId).toBe('step-help-housing-0');
    expect(JSON.stringify(state.personalPlan)).toBe(before);
    tab('browse');
    expect(state.helpReturnId).toBeNull();
    openStepHelp('study', '準備文件');
    expect(state.view).toBe('browse');
    openStepHelp('housing', '已失效的步驟');
    expect(state.view).toBe('browse');
  });
  it('沒有返回紀錄時從單張行動單返回列表；未加入的不能打開', () => {
    openPlanItem('housing'); expect(state.view).toBe('home');
    state.personalPlan.planIds = ['housing'];
    state.view = 'planItem'; state.planItemId = 'housing'; state.history = [];
    back(); expect(state.view).toBe('plan');
  });
  it('移除行動單清掉該張進度並回到列表；全部改回未完成只影響這張', () => {
    state.personalPlan.planIds = ['housing', 'study'];
    state.personalPlan.stepDone = { housing: [0], study: [0, 1] };
    tab('plan'); openPlanItem('study'); resetSteps('study');
    expect(state.personalPlan.stepDone).toEqual({ housing: [0] });
    openPlanItem('housing');
    removeFromPlan('housing');
    expect(state.view).toBe('plan'); expect(state.personalPlan.planIds).toEqual(['study']);
    expect(state.personalPlan.stepDone).toEqual({});
    togglePlan('housing'); expect(state.personalPlan.stepDone.housing).toBeUndefined();
  });
  it('行動單詳情以本人資料顯示；清除全部才移除本人行動單', () => {
    state.personalPlan = { ...emptySession('self'), planIds: ['housing'], answers: { age: 30 }, stepDone: { housing: [0] } };
    requestTarget('other'); state.session.answers = { age: 72 };
    tab('plan'); openDetail('housing');
    expect(state.detailTarget).toBe('self');
    expect(detailAnswers.value.age).toBe(30);
    resetPerson('other');
    expect(state.personalPlan.planIds).toEqual(['housing']);
    clearAllData();
    expect(state.personalPlan.planIds).toEqual([]);
    expect(state.personalPlan.answers).toEqual({});
    expect(state.personalPlan.stepDone).toEqual({});
  });
  it('從初始招呼頁離開再回來，不詢問續接', () => {
    tab('browse'); tab('home');
    expect(pendingResume.value).toBe(false); expect(state.view).toBe('home');
  });

  it('離開進行中的問答後返回，繼續會保留目前題目及答案', () => {
    requestTarget('self'); selectNeed('housing');
    state.session.answers = { age: 30 }; state.qIndex = 1;
    const route = [...state.questionRoute];
    tab('plan'); tab('home');
    expect(pendingResume.value).toBe(true); expect(state.view).toBe('questions');
    continueConversation();
    expect(state.view).toBe('questions'); expect(state.qIndex).toBe(1);
    expect(state.questionRoute).toEqual(route); expect(state.session.answers.age).toBe(30);
  });

  it('開新對話回到招呼頁，清除對話答案、保留行動單及勾選進度', () => {
    requestTarget('self'); selectNeed('housing'); state.session.answers = { age: 30 };
    state.personalPlan.planIds = ['housing']; state.personalPlan.docChecks = { document: true }; state.personalPlan.stepDone = { housing: [0] };
    const epoch = conversationEpoch.value;
    tab('plan'); tab('home'); newConversation();
    expect(state.view).toBe('home'); expect(pendingResume.value).toBe(false);
    expect(state.session.answers).toEqual({}); expect(state.session.situation).toBeNull();
    expect(state.personalPlan.planIds).toEqual(['housing']); expect(state.personalPlan.docChecks).toEqual({ document: true });
    expect(state.personalPlan.stepDone).toEqual({ housing: [0] }); expect(conversationEpoch.value).toBeGreaterThan(epoch);
    tab('browse'); tab('home'); expect(pendingResume.value).toBe(false);
  });
  it('對象選擇前進到需求，同一對象返回再選不清除答案', () => {
    requestTarget('self');
    expect(state.view).toBe('needs');
    state.session.answers = { age: 60 };
    tab('home');
    requestTarget('self');
    expect(state.view).toBe('needs');
    expect(state.session.answers.age).toBe(60);
    expect(pendingSwitch.value).toBeNull();
  });

  it('換對象只清除查詢答案，保留本人行動單與本人條件並前進到需求', () => {
    requestTarget('self');
    state.session.answers = { age: 60 };
    state.personalPlan.planIds = ['housing'];
    tab('home');
    requestTarget('other');
    expect(pendingSwitch.value).toBe('other');
    expect(state.view).toBe('home');
    expect(state.session.answers.age).toBe(60);
    confirmPending();
    expect(state.view).toBe('needs');
    expect(state.session.target).toBe('other');
    expect(state.session.answers).toEqual({});
    expect(state.personalPlan.planIds).toEqual(['housing']);
    expect(state.personalPlan.answers).toEqual({ age: 60 });
    back();
    expect(state.view).toBe('home');
  });

  it('換人按鈕確認後回對象頁，不沿用先前待確認目的頁', () => {
    requestTarget('self');
    state.session.answers = { age: 60 };
    requestTarget('other');
    pendingSwitch.value = null; // 取消對話框
    requestNewPerson();
    confirmPending();
    expect(state.view).toBe('home');
    expect(state.session.answers).toEqual({});
  });

  it('需求清除舊搜尋，搜尋清除舊分類，保留同一人的答案與行動單', () => {
    requestTarget('self');
    state.session.query = '助學金';
    state.session.answers = { age: 60 };
    state.personalPlan.planIds = ['housing'];
    selectNeed('housing');
    expect(state.session.query).toBe('');
    expect(state.view).toBe('questions');
    expect(questions.value.map(q => q.id).sort()).toEqual(['region']); // 主線沿用已確認年齡，不重問
    expect(state.session.answers.age).toBe(60);
    back();
    expect(state.view).toBe('needs');
    go('search');
    searchResources(' 助學金 ');
    expect(state.session.situation).toBeNull();
    expect(state.session.query).toBe('助學金');
    expect(questions.value.map(q => q.id)).toEqual(['region', 'student']);
    expect(state.session.answers.age).toBe(60);
    expect(state.personalPlan.planIds).toEqual(['housing']);
    back();
    expect(state.view).toBe('search');
  });

  it('逐題返回保留答案；舊題事件和連點不能跳過下一題', () => {
    requestTarget('self');
    selectNeed('housing');
    expect(answerAndAdvance('region', '臺北市', 1000)).toBe(true);
    expect(state.qIndex).toBe(1);
    expect(answerAndAdvance('age', 60, 1100)).toBe(false);
    expect(answerAndAdvance('region', '其他', 2000)).toBe(false);
    expect(state.qIndex).toBe(1);
    back();
    expect(state.qIndex).toBe(0);
    expect(state.session.answers.region).toBe('臺北市');
    expect(answerAndAdvance('region', '臺北市', 2200)).toBe(true);
    expect(answerAndAdvance('age', 60, 2700)).toBe(true);
    expect(state.view).toBe('results');
    startQuestions();
    expect(state.qIndex).toBe(0);
    expect(state.session.answers.age).toBe(60);
    back();
    expect(state.view).toBe('results');
  });

  it('搜尋無結果時直接到結果頁，載入中不開始問答', () => {
    requestTarget('self');
    state.loading = true;
    selectNeed('housing');
    expect(state.view).toBe('needs');
    state.loading = false;
    go('search');
    searchResources('找不到的資源');
    expect(state.view).toBe('results');
    expect(questions.value).toEqual([]);
  });
});

// Full source records retain binding; these are not modified to fake review coverage.
import { realItem } from '../domain/__tests__/real-data';
import { buildLocalQuestions } from '../domain/questions';

describe('依已答必要條件跳題，保持題目identity與返回',()=>{
  function realRound() {
    resetPerson('self');state.loading=false;
    const items=[realItem('CT-0129')];
    state.catalog={version:'real',origin:'snapshot',sourceLabel:'real',items};
    state.bank={version:'reviewed',origin:'local',questions:buildLocalQuestions(items).filter(q=>['age','is_student','household_type'].includes(q.field)).map(q=>({...q,burden:q.field==='age'?0:q.field==='household_type'?2:1}))};
    startQuestions();
  }
  it('99歲排除全部候選即結束，不再問在學或身分；返回改18後恢復相關題',()=>{
    realRound();const id=questions.value[0].id;
    expect(questions.value[0].field).toBe('age');
    expect(answerAndAdvance(id,99,1000)).toBe(true);
    expect(state.view).toBe('results');expect(questions.value.map(q=>q.id)).toEqual([id]);
    back();expect(state.view).toBe('questions');expect(questions.value[state.qIndex].id).toBe(id);
    expect(answerAndAdvance(id,18,2000)).toBe(true);
    expect(questions.value[state.qIndex].field).toBe('is_student');
    const studentId=questions.value[state.qIndex].id;
    expect(answerAndAdvance(id,99,3000)).toBe(false); // stale age handler cannot answer student
    expect(answerAndAdvance(studentId,true,3500)).toBe(true);
    expect(questions.value[state.qIndex].field).toBe('household_type');
    back();expect(questions.value[state.qIndex].id).toBe(studentId);
    expect(state.session.answers.is_student).toBe(true);
  });
  it('舊回答不可隱藏自己的修改題；返回更改後重新計算未來路徑',()=>{
    realRound();state.session.answers={age:99,is_student:false,household_type:'general'};
    const ageId=questions.value[0].id;
    answerAndAdvance(ageId,18,1000);
    expect(questions.value[state.qIndex].field).toBe('is_student');
    answerAndAdvance(questions.value[state.qIndex].id,false,2000);
    expect(state.view).toBe('results'); // false is a proven student conflict
    back();back();expect(questions.value[state.qIndex].id).toBe(ageId);
    answerAndAdvance(ageId,18,3000);
    answerAndAdvance(questions.value[state.qIndex].id,true,4000);
    expect(questions.value[state.qIndex].field).toBe('household_type');
  });
});

import { continueQuestions, focusedCandidates, otherCandidates, recommendedCandidates, startExplore } from '../store';
import { realItems } from '../domain/__tests__/real-data';
function fullRound(area:string|null='study') {
  resetPerson('self');state.loading=false;
  state.catalog={version:'full',origin:'snapshot',sourceLabel:'full',items:realItems};
  state.bank={version:'full',origin:'local',questions:buildLocalQuestions(realItems)};
  if(area)selectNeed(area);else startExplore();
}
it('先true再false再true會恢復下游題，清除失效的runVisited',()=>{
  fullRound();let time=1000;
  expect(questions.value[0].field).toBe('is_student');
  answerAndAdvance(questions.value[state.qIndex].id,true,time+=1000);
  for(let n=0;n<3&&state.view==='questions';n++) {
    const q=questions.value[state.qIndex];answerAndAdvance(q.id,q.field==='education_level'?'college':q.field==='age'?20:undefined,time+=1000);
  }
  while(state.qIndex>0)back();
  const student=questions.value[0];answerAndAdvance(student.id,false,time+=1000);
  if(state.view==='results')back();while(state.qIndex>0)back();
  answerAndAdvance(student.id,true,time+=1000);
  expect(state.view).toBe('questions');
  expect(questions.value.slice(state.qIndex).some(q=>q.field==='education_level')).toBe(true);
  expect(state.session.answers.extra?.education_level).toBeUndefined();
},15000);
it('切需求清除不相關探索偏好；保留同人的安全必要事實',()=>{
  fullRound();state.session.answers={age:30,extra:{education_support:'loan',explore_context:'student',is_renting:true,education_level:'college'}};
  selectNeed('housing');
  expect(state.session.answers.extra?.education_support).toBeUndefined();expect(state.session.answers.extra?.explore_context).toBeUndefined();
  expect(state.session.answers.age).toBe(30);expect(state.session.answers.extra?.is_renting).toBe(true);
  expect(questions.value.some(q=>q.field==='education_support')).toBe(false);
});
it('探索要求對象，略過生活分類後仍可從具體支出進住宅分支',()=>{
  resetPerson(null);state.loading=false;startExplore();expect(state.session.target).toBeNull();
  fullRound(null);expect(questions.value[0].field).toBe('explore_context');
  answerAndAdvance(questions.value[0].id,undefined,1000);
  expect(questions.value[state.qIndex].field).toBe('expense_priority');
  answerAndAdvance(questions.value[state.qIndex].id,'rent',2000);
  expect(questions.value.slice(state.qIndex).some(q=>q.field==='housing_support'||q.field==='is_renting')).toBe(true);
  const seen=questions.value.slice(0,state.qIndex).map(q=>q.id);go('results');continueQuestions();
  expect(questions.value.every(q=>!seen.includes(q.id))).toBe(true);
  const nonIneligible=state.catalog!.items.filter(i=>state.session.situation===null&&!isClosed(i)).length;
  expect(new Set([...recommendedCandidates.value,...otherCandidates.value].map(i=>i.id)).size).toBe(nonIneligible);
  expect(focusedCandidates.value.length).toBeLessThan(217);
},15000);


describe('使用者確認的語意候選條件', () => {
  const fact = (value: number, subject: 'self' | 'other' | 'applicant' = 'self') => ({ field: 'age' as const, value, subject, subjectLabel: subject === 'other' ? '媽媽' : '我', evidence: `年齡${value}` });
  it('整批驗證後套用，保留其他穩定答案與行動單，不再追問確認過的年齡', () => {
    requestTarget('self'); selectNeed('housing');
    state.session.answers = { region: '臺北市', age: 40 };
    state.personalPlan.planIds = ['housing'];
    expect(applyConfirmedFacts([fact(65)])).toBe(true);
    expect(state.session.answers).toMatchObject({ age: 65, region: '臺北市' });
    expect(state.personalPlan.planIds).toEqual(['housing']);
    expect(questions.value.map(q => q.field)).not.toContain('age');
  });
  it('不明主體、跨人、多個同欄位、未支援值或超界，全部不變更', () => {
    requestTarget('self'); selectNeed('housing');
    state.session.answers = { age: 40 };
    for (const facts of [[fact(72, 'other')], [fact(72), fact(40)], [fact(999)], [{ ...fact(65), field: 'region' as const, value: '任意地址' }]]) {
      expect(applyConfirmedFacts(facts)).toBe(false);
      expect(state.session.answers).toEqual({ age: 40 });
    }
    resetPerson(null);
    expect(applyConfirmedFacts([fact(72, 'applicant')])).toBe(false);
  });
  it('改基本條件後清掉隱藏的舊分支，但保留同人的無關基本條件', () => {
    requestTarget('self'); selectNeed('housing');
    state.bank!.questions.push({ id: 'branch', depends_on: { age: ['40'] }, field: 'education_level', kind: 'single', title: '學制', options: [{ label: '大學', value: 'college' }], resource_ids: ['housing'], situations: ['study'] });
    state.session.answers = { age: 40, region: '臺北市', extra: { education_level: 'college' } };
    state.session.seenQuestions = ['age', 'branch'];
    expect(applyConfirmedFacts([fact(65)])).toBe(true);
    expect(state.session.answers.region).toBe('臺北市');
    expect(state.session.answers.extra?.education_level).toBeUndefined();
    expect(state.session.seenQuestions).not.toContain('branch');
  });
});

describe('已確認對話的換人交易', () => {
  const age = (value = 72, subject: CandidateFact['subject'] = 'other'): CandidateFact => ({ field: 'age', value, subject, subjectLabel: subject === 'self' ? '我' : '媽媽', evidence: `年齡${value}` });
  const proposal = (overrides: Partial<ConfirmedConversationProposal> = {}): ConfirmedConversationProposal => ({ target: 'other', facts: [age()], situation: 'housing', ...overrides });
  const previousAnswers = { age: 40, region: '臺北市' as const, household_type: 'low_income' as const };
  const snapshot = () => JSON.stringify({ session: state.session, plan: state.personalPlan, view: state.view, route: state.questionRoute, index: state.qIndex, pending: pendingSwitch.value });

  it('本人改媽媽先確認；清除舊條件後套年齡與需求，保留本人行動單', () => {
    requestTarget('self'); state.session.answers = { ...previousAnswers };
    state.personalPlan.planIds = ['housing']; state.personalPlan.docChecks = { document: true }; state.personalPlan.stepDone = { housing: [0] };
    const before = JSON.stringify(state.session);
    expect(requestConfirmedConversation(proposal())).toBe('pending');
    expect(pendingSwitch.value).toBe('other');
    expect(JSON.stringify(state.session)).toBe(before);
    confirmPending();
    expect(pendingSwitch.value).toBeNull();
    expect(state.session.target).toBe('other');
    expect(state.session.answers.age).toBe(72);
    expect(state.session.answers.region).toBeUndefined();
    expect(state.session.answers.household_type).toBeUndefined();
    expect(state.session.situation).toBe('housing');
    expect(state.view).toBe('questions');
    expect(questions.value.map(q => q.field)).toEqual(['region']);
    expect(state.personalPlan.answers).toEqual(previousAnswers);
    expect(state.personalPlan.planIds).toEqual(['housing']);
    expect(state.personalPlan.docChecks).toEqual({ document: true });
    expect(state.personalPlan.stepDone).toEqual({ housing: [0] });
  });

  it('媽媽改爸爸雖同為 other，也先清掉前人的戶籍與家戶身分', () => {
    requestTarget('other'); state.session.answers = { ...previousAnswers };
    state.personalPlan.planIds = ['study']; state.personalPlan.answers = { age: 20 };
    expect(requestConfirmedConversation(proposal({ facts: [{ ...age(76), subjectLabel: '爸爸', evidence: '爸爸76歲' }], newPerson: true }))).toBe('pending');
    expect(state.session.answers).toEqual(previousAnswers);
    confirmPending();
    expect(state.session.target).toBe('other');
    expect(state.session.answers.age).toBe(76);
    expect(state.session.answers.region).toBeUndefined(); expect(state.session.answers.household_type).toBeUndefined();
    expect(state.session.situation).toBe('housing');
    expect(state.personalPlan.planIds).toEqual(['study']); expect(state.personalPlan.answers).toEqual({ age: 20 });
  });

  it('取消對話框後，不得把舊提案套到下一次普通換人', () => {
    requestTarget('self'); state.session.answers = { ...previousAnswers };
    expect(requestConfirmedConversation(proposal())).toBe('pending');
    pendingSwitch.value = null;
    confirmPending();
    expect(state.session.answers).toEqual(previousAnswers);
    requestTarget('other'); confirmPending();
    expect(state.session.answers).toEqual({}); expect(state.session.situation).toBeNull();
    expect(state.view).toBe('needs');
  });

  it('無效內容整批拒絕，連合法前綴、對象、需求、待確認與畫面都不變', () => {
    requestTarget('self'); state.session.answers = { ...previousAnswers };
    const cases: ConfirmedConversationProposal[] = [
      proposal({ situation: 'invented' }),
      proposal({ facts: [age(), age(73)] }),
      proposal({ facts: [age(), { ...age(), field: 'region', value: '任意地址' }] }),
      proposal({ facts: [age(999)] }),
      proposal({ facts: [age(72, 'self')] }),
      proposal({ facts: [age(72, 'unclear')] }),
      proposal({ facts: [{ ...age(), evidence: '' }] }),
      proposal({ facts: [{ ...age(), subjectLabel: '' }] }),
      proposal({ facts: [{ ...age(), field: 'household_type', value: 'low_income' }] }), // 題庫未提供此欄位
      { ...proposal(), newPerson: 'yes' } as unknown as ConfirmedConversationProposal,
      { ...proposal(), facts: null } as unknown as ConfirmedConversationProposal,
      { ...proposal(), target: 'someone' } as unknown as ConfirmedConversationProposal,
    ];
    const before = snapshot();
    for (const invalid of cases) {
      expect(requestConfirmedConversation(invalid)).toBe('invalid');
      expect(snapshot()).toBe(before);
    }
    state.loading = true;
    const loading = snapshot();
    expect(requestConfirmedConversation(proposal())).toBe('invalid'); expect(snapshot()).toBe(loading);
  });

  it('保留提案的值副本，確認前再驗證當時題庫', () => {
    requestTarget('self'); state.session.answers = { ...previousAnswers };
    const confirmed = proposal();
    expect(requestConfirmedConversation(confirmed)).toBe('pending');
    confirmed.facts[0]!.value = 99; confirmed.situation = 'study';
    confirmPending();
    expect(state.session.answers.age).toBe(72); expect(state.session.situation).toBe('housing');
    requestTarget('self'); confirmPending(); state.session.answers = { ...previousAnswers };
    expect(requestConfirmedConversation(proposal())).toBe('pending');
    state.bank!.questions.find(q => q.field === 'age')!.max = 60;
    const before = JSON.stringify(state.session);
    confirmPending();
    expect(JSON.stringify(state.session)).toBe(before); expect(pendingSwitch.value).toBeNull();
  });

  it.each(['navigate', 'answer', 'version', 'reset', 'clear', 'new-target', 'new-person'] as const)('等待中有 %s 新操作，提案不殘留', operation => {
    requestTarget('self'); state.session.answers = { ...previousAnswers };
    expect(requestConfirmedConversation(proposal())).toBe('pending');
    if (operation === 'navigate') tab('browse');
    else if (operation === 'answer') state.session.answers.age = 41;
    else if (operation === 'version') state.session.catalogVersion = 'new';
    else if (operation === 'reset') resetPerson('self');
    else if (operation === 'clear') clearAllData();
    else if (operation === 'new-target') requestTarget('self');
    else requestNewPerson();
    confirmPending();
    expect(state.session.answers.age).not.toBe(72);
    expect(state.session.situation).toBeNull();
    expect(pendingSwitch.value).toBeNull();
  });

  it('同人交易只沿用該人的穩定答案，套完條件才建立新需求題路', () => {
    requestTarget('self'); state.session.answers = { age: 40, region: '臺北市' };
    expect(requestConfirmedConversation(proposal({ target: 'self', facts: [age(20, 'self')], situation: 'study' }))).toBe('applied');
    expect(state.session.answers).toMatchObject({ age: 20, region: '臺北市' });
    expect(state.session.situation).toBe('study'); expect(state.session.query).toBe('');
    expect(questions.value.map(q => q.field)).toEqual(['is_student']);
    expect(pendingSwitch.value).toBeNull();
  });

  it('只有已確認背景時不猜需求；沒有條件的明確方向仍可接續', () => {
    expect(requestConfirmedConversation(proposal({ target: 'self', facts: [age(20, 'self')], situation: null }))).toBe('applied');
    expect(state.session.answers.age).toBe(20); expect(state.session.situation).toBeNull();
    expect(questions.value.some(q => q.field === 'age')).toBe(false);
    expect(requestConfirmedConversation(proposal({ target: 'self', facts: [], situation: 'housing' }))).toBe('applied');
    expect(state.session.situation).toBe('housing'); expect(state.session.answers.age).toBe(20);
  });

  it('新合法提案取代舊提案；無效提案不破壞已在確認的交易', () => {
    requestTarget('self'); state.session.answers = { ...previousAnswers };
    expect(requestConfirmedConversation(proposal())).toBe('pending');
    expect(requestConfirmedConversation(proposal({ facts: [age(76)], situation: 'study' }))).toBe('pending');
    expect(requestConfirmedConversation(proposal({ facts: [age(999)] }))).toBe('invalid');
    confirmPending();
    expect(state.session.answers.age).toBe(76); expect(state.session.situation).toBe('study');
  });
});

// 切換搜尋與需求分類使用同一套穩定條件；改答案仍由 startQuestions 明確進入。
it.each(['self', 'other'] as const)('搜尋切換保留 %s 的已確認條件且不重問', target => {
  requestTarget(target);
  state.session.answers = { age: 20, region: '臺北市', is_student: true };
  searchResources('助學金');
  expect(state.session.answers).toEqual({ age: 20, region: '臺北市', is_student: true });
  expect(questions.value.some(q => ['age', 'region', 'is_student'].includes(q.field))).toBe(false);
  expect(state.view).toBe('results');
});

it('明確名稱搜尋後不重問通用需求方向，仍保留具體條件題', () => {
  state.bank!.questions.push(...['need_area', 'explore_context', 'expense_priority', 'benefit_style'].map(field => ({ id: field, field, title: field, kind: 'single' as const, options: [{ label: '選項', value: 'known' }], resource_ids: ['housing'] })));
  requestTarget('self');
  searchResources('租屋補助');
  expect(questions.value.some(q => ['need_area', 'explore_context', 'expense_priority', 'benefit_style'].includes(q.field))).toBe(false);
  expect(questions.value.some(q => q.field === 'region' || q.field === 'age')).toBe(true);
});
