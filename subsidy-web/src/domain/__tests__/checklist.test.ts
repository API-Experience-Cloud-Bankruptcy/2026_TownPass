import { describe, expect, it } from 'vitest';
import { buildChecklist } from '../checklist';
import { documentKey } from '../documents';
import { DISCLAIMER, type PlanInput } from '../export';
import { makeSubsidy } from './fixtures';

const input = (): PlanInput => ({
  meta: { catalogVersion: 'synthetic-v1', sourceLabel: '合成測試', generatedAt: new Date('2026-11-07T12:00:00+08:00') },
  target: 'other', items: [makeSubsidy()], results: new Map(), conditions: [], docChecks: {}, stepDone: {},
});

describe('紙本檢核結構', () => {
  it('保留全部資格、來源、期限與文件不同版本', () => {
    const base = input();
    base.items = [makeSubsidy({ eligibility: { age: [{ raw: '年滿六十五歲', min: 65, max: null, subject: '本人', unit: 'year' }], exclusions: ['不得重複領取', '排除條件末尾'] }, source_meta: { sources: [{ url: 'https://example.gov.tw/original', type: 'official', role: 'program', source_date: '2026-01-01', checked_date: '2026-11-01' }] } }), makeSubsidy({ id: 'T-2', application: { required_documents: [{ name: '身分證', condition: '另需影本', notes: '攜帶正本', required: false }] } })];
    const result = buildChecklist(base);
    const all = JSON.stringify(result);
    for (const expected of ['年滿六十五歲', '不得重複領取', '排除條件末尾', '每月 1,000 元', '常年受理', '2026-01-01', '2026-11-01', 'https://example.gov.tw/original', '合成測試', 'synthetic-v1', DISCLAIMER, '另需影本', '同名文件有不同要求', '求助時可以照著說']) expect(all).toContain(expected);
    expect(result.sections[0]!.blocks.filter(b => b.kind === 'check')).toHaveLength(2);
    expect(result.sections[1]!.blocks.some(b => b.kind === 'notes')).toBe(true);
  });
  it('預設不洩漏結果填答，僅同意欄位保留數值', () => {
    const base = input();
    base.results.set('T-0001', { id: 'T-0001', fit: 'possible', reasons: ['年齡 42 歲', '所在地桃園'], warnings: ['收入 123456 元'], blocked_by: [], pending: ['待確認資格'], personal: [
      { list: 'reasons', text: '年齡 42 歲', field: 'age', neutral: '年齡待確認' },
      { list: 'reasons', text: '所在地桃園', field: 'region', neutral: null },
      { list: 'warnings', text: '收入 123456 元', field: 'income', neutral: '所得待確認' },
    ] });
    const built = buildChecklist(base);
    expect(built.sections[1]!.blocks.find(b => b.text === '待確認：待確認資格')?.kind).toBe('check');
    const before = JSON.stringify(built);
    expect(before).not.toContain('42'); expect(before).not.toContain('桃園'); expect(before).not.toContain('123456');
    expect(before).toContain('不含個人填答'); expect(before).toContain('所得待確認');
    base.conditions = [{ field: 'age', line: '年齡：42 歲' }];
    const after = JSON.stringify(buildChecklist(base));
    expect(after).toContain('42 歲'); expect(after).not.toContain('桃園'); expect(after).not.toContain('123456');
  });
  it('勾選只記錄準備，文件與步驟各自獨立，不改寫輸入', () => {
    const base = input();
    const key = documentKey('身分證', '', '', true);
    base.docChecks[key] = true; base.stepDone['T-0001'] = [1, 999];
    const before = JSON.stringify(base);
    const checklist = buildChecklist(base);
    expect(checklist.sections[0]!.blocks.find(b => b.key === key)?.checked).toBe(true);
    const steps = checklist.sections[1]!.blocks.filter(b => b.kind === 'check');
    expect(steps.map(s => s.checked)).toEqual([false, true, false]);
    expect(JSON.stringify(base)).toBe(before);
    expect(checklist.subtitle).toBe(DISCLAIMER);
  });
  it('補充原文保留全文，沒有技術 JSON 或未知內部鍵', () => {
    const base = input();
    base.items = [makeSubsidy({ eligibility: { age: [{ min: 65, max: null, raw: null, subject: '本人', unit: 'year' }], custom_internal: { raw: '不得重複領取其他津貼', notes: '例外依公告' } } as any, benefit: { amounts: [{ raw: '最高每月 1000 元', condition: '依核定' }] } })];
    const output = buildChecklist(base).sections.flatMap(s => s.blocks.map(b => b.text)).join('\n');
    expect(output).toContain('不得重複領取其他津貼；例外依公告');
    expect(output).toContain('最高每月 1000 元；依核定');
    expect(output).toContain('下限 65 歲');
    expect(output).not.toContain('custom_internal');
    expect(output).not.toContain('{');
  });
  it('表單結構：總覽與文件列數、項目編號、文件編號穩定', () => {
    const base = input();
    base.items = [makeSubsidy(), makeSubsidy({ id: 'T-2', name: '第二項', application: { required_documents: [{ name: '身分證', condition: null, notes: '', required: true }, { name: '戶口名簿', condition: null, notes: '', required: false }] } }), makeSubsidy({ id: 'T-3', name: '無文件', application: { required_documents: [] } })];
    const { form } = buildChecklist(base);
    expect(form.overview.map(r => r.no)).toEqual([1, 2, 3]);
    expect(form.documents.map(d => [d.name, d.requirement, d.usedBy])).toEqual([['身分證', '必備', '1、2'], ['戶口名簿', '依個案', '2']]);
    expect(form.incomplete).toEqual([{ no: 3, name: '無文件', remarks: expect.stringContaining('文件清單未補齊') }]);
    expect(form.code).toMatch(/^FT-20261107-[0-9A-Z]{6}$/);
    expect(buildChecklist({ ...base, items: [...base.items].reverse() }).form.code).toBe(form.code);
    expect(buildChecklist({ ...base, items: base.items.slice(1) }).form.code).not.toBe(form.code);
    expect(form.target).toBe('家人或他人');
  });
  it('表單結構涵蓋預覽中每項資源的全部資料', () => {
    const base = input();
    base.items = [makeSubsidy({ eligibility: { age: [{ raw: '年滿六十五歲', min: 65, max: null, subject: '本人', unit: 'year' }], exclusions: ['不得重複領取'] }, extensions: [{ namespace: 'eligibility', key: 'k', label: '居住日數', raw: '居住超過183日' }, { namespace: 'benefit', key: 'b', label: '給付方式', raw: '按月撥入' }], source_meta: { notes: '資料備註甲', verification_note: '查核說明乙', missing_fields: ['電話'], sources: [{ url: 'https://example.gov.tw/original', type: 'official', role: 'program', source_date: '2026-01-01', checked_date: '2026-11-01' }] } })];
    base.results.set('T-0001', { id: 'T-0001', fit: 'possible', reasons: [], warnings: ['資料時效提醒'], blocked_by: [], pending: ['待確認資格'] });
    base.stepDone['T-0001'] = [2];
    const checklist = buildChecklist(base);
    const form = JSON.stringify(checklist.form);
    for (const section of checklist.sections.slice(1)) {
      for (const block of section.blocks) {
        if (block.kind === 'heading' || block.kind === 'notes') continue;
        if (block.kind === 'link') { expect(form).toContain(block.url); continue; }
        if (block.text.startsWith('來源紀錄')) continue;
        const value = block.kind === 'check'
          ? block.text.replace(/^待確認：/, '').replace(/^\d+\. /, '').replace(/（流程原文，未自行拆步）$/, '')
          : block.text.slice(block.text.indexOf('：') + 1);
        expect(form, block.text).toContain(JSON.stringify(value).slice(1, -1));
      }
    }
    expect(checklist.form.resources[0]!.steps.map(s => s.done)).toEqual([false, false, true]);
    expect(checklist.form.resources[0]!.eligibility).toContainEqual({ category: '補充：居住日數', text: '居住超過183日' });
  });
  it('表單不含未同意的填答', () => {
    const base = input();
    base.results.set('T-0001', { id: 'T-0001', fit: 'possible', reasons: ['年齡 42 歲'], warnings: [], blocked_by: [], personal: [{ list: 'reasons', text: '年齡 42 歲', field: 'age', neutral: '年齡待確認' }] });
    const before = JSON.stringify(buildChecklist(base).form);
    expect(before).not.toContain('42'); expect(before).toContain('年齡待確認');
    expect(buildChecklist(base).form.conditions).toEqual([]);
    base.conditions = [{ field: 'age', line: '年齡：42 歲' }];
    expect(buildChecklist(base).form.conditions).toEqual(['年齡：42 歲']);
  });
  it('沒有來源或文件時明示缺漏，不臆造電話地址或委託權', () => {
    const base = input();
    base.items = [makeSubsidy({ application: { required_documents: [], methods: [], process_text: null, channel_text: null, urls: { program: 'javascript:alert(1)' } }, source_meta: { sources: [], missing_fields: ['申請方式.form_fields'] } })];
    const checklist = buildChecklist(base);
    expect(JSON.stringify(checklist)).toContain('不代表免附文件');
    expect(JSON.stringify(checklist)).toContain('本表不代表已取得委託權');
    expect(JSON.stringify(checklist)).not.toContain('javascript:');
    expect(JSON.stringify(checklist)).toContain('申請方式的表單填寫欄位');
    expect(JSON.stringify(checklist)).not.toContain('form_fields');
    expect(checklist.sections[1]!.blocks.filter(b => b.kind === 'link')).toHaveLength(0);
  });
});
