import { describe, expect, it } from 'vitest';
import { makeSubsidy } from '../domain/__tests__/fixtures';
import type { MatchResult } from '../domain/types';
import {
  applicationStatusAlert,
  benefitLabel,
  currentStepIndex,
  deadlineNote,
  distinctGroups,
  fitNote,
  insightLine,
  itemFlags,
  narrowingNote,
  numberUnit,
  optionalText,
  progressText,
  rangeLine,
  statusPlain,
} from '../presentation';

const result = (over: Partial<MatchResult>): MatchResult => ({ id: 'x', fit: 'possible', reasons: [], warnings: [], blocked_by: [], ...over });

describe('白話標示', () => {
  it('只有明確不符才標示', () => {
    expect(fitNote(result({ fit: 'ineligible' }))).toBe('填寫的條件不符');
    expect(fitNote(result({}))).toBeNull();
    expect(fitNote(undefined)).toBeNull();
  });
  it('期限提示來自既有 warnings', () => {
    expect(deadlineNote(result({ warnings: ['原文期限 2026-01-31 可能已過，請查官方最新公告。'] }))).toContain('期限可能已過');
    expect(deadlineNote(result({ warnings: ['資料原有狀態為「部分查核」'] }))).toBeNull();
  });
  it('補助短標使用資料短欄位，不截斷長原文', () => {
    const long = '很長的補助說明'.repeat(30);
    const item = makeSubsidy({ benefit: { kind: '現金補助', raw: long } } as any);
    expect(benefitLabel(item)).toBe('現金補助');
    const noKind = makeSubsidy({ benefit: { kind: null, raw: long }, classification: { category: '生活', benefit_type: '租金補貼' } } as any);
    expect(benefitLabel(noKind)).toBe('租金補貼');
    expect(benefitLabel(noKind)).not.toContain('…');
  });
  it('資料狀態白話並附日期', () => {
    expect(statusPlain('partial', '2026-11-07')).toBe('資料部分查核（2026-11-07）');
    expect(statusPlain('weird', '')).toBe('資料狀態未註明');
  });
  it('步驟進度與目前步驟', () => {
    expect(progressText(2, 5)).toBe('已準備 2／5 步');
    expect(progressText(5, 5)).toBe('5 步都準備好了');
    expect(progressText(0, 0)).toBe('沒有列出步驟');
    expect(currentStepIndex(3, [0, 2])).toBe(1);
    expect(currentStepIndex(2, [0, 1])).toBe(-1);
  });
});

describe('動態問答回饋', () => {
  const insight = (over: Partial<{ initialCount: number; remainingCount: number; answeredCount: number }>) => ({
    initialCount: 40, remainingCount: 40, answeredCount: 0, reason: '', ...over,
  });
  it('進度說目前聚焦，不說符合或排除', () => {
    expect(insightLine(insight({ answeredCount: 2, remainingCount: 14 }))).toBe('已回答 2 題・目前聚焦 14 項');
    expect(insightLine(insight({}))).toBe('目前聚焦 40 項');
    for (const line of [insightLine(insight({ answeredCount: 2, remainingCount: 14 })), rangeLine(insight({ remainingCount: 6 })), narrowingNote(20, 8, false) ?? '']) {
      expect(line).not.toMatch(/符合|排除|資格/);
    }
    expect(insightLine(null)).toBe('');
  });
  it('數字異常時不顯示', () => {
    expect(insightLine(insight({ remainingCount: Number.NaN }))).toBe('');
    expect(rangeLine(insight({ initialCount: -1 }))).toBe('');
  });
  it('只有真的變少才說先從這幾項了解', () => {
    expect(rangeLine(insight({ remainingCount: 6 }))).toBe('依填寫的答案，先從 40 項中的 6 項了解');
    expect(rangeLine(insight({}))).toBe('目前聚焦 40 項');
    expect(narrowingNote(20, 8, false)).toBe('目前聚焦：20 項 → 8 項');
    expect(narrowingNote(20, 20, false)).toContain('項目數沒有變');
    expect(narrowingNote(20, 25, false)).toBeNull();
    expect(narrowingNote(undefined, 8, false)).toBeNull();
  });
  it('跳過不當成否', () => {
    expect(narrowingNote(20, 20, true)).toBe('已跳過，不會當成「否」。');
  });
  it('選填說明與單位', () => {
    expect(optionalText({ description: ' 說明 ' }, 'description')).toBe('說明');
    expect(optionalText({ description: 3 }, 'description')).toBe('');
    expect(optionalText(null, 'x')).toBe('');
    expect(numberUnit({ field: 'age' })).toBe('歲');
    expect(numberUnit({ field: 'children', unit: '人' } as { field: string })).toBe('人');
    expect(numberUnit({ field: 'other' })).toBe('數字');
  });
});

describe('結果分組不重複', () => {
  it('同一項只留在第一組，其餘組保留各自實際內容', () => {
    const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' };
    const [rec, closed, uncertain, general] = distinctGroups([[a], [b, a], [b, c], [a, b, c, d]]);
    expect(rec.map((x) => x.id)).toEqual(['a']);
    expect(closed.map((x) => x.id)).toEqual(['b']);
    expect(uncertain.map((x) => x.id)).toEqual(['c']);
    expect(general.map((x) => x.id)).toEqual(['d']);
  });
  it('只出現在子集、不在總表的項目不會消失', () => {
    const [, closed, general] = distinctGroups([[], [{ id: 'x' }], [{ id: 'y' }]]);
    expect(closed.map((x) => x.id)).toEqual(['x']);
    expect(general.map((x) => x.id)).toEqual(['y']);
  });
});

describe('清單提醒', () => {
  it('合併不符、期限與受理情形', () => {
    const item = makeSubsidy({ source_meta: { application_status: '本年度已截止' } } as any);
    const flags = itemFlags(item, result({ fit: 'ineligible', warnings: ['期限 2026-01-01 可能已過'] }));
    expect(flags).toEqual(['填寫的條件不符', '期限可能已過，請先確認', '受理情形：本年度已截止', '受理時間需向窗口確認']);
    expect(itemFlags(makeSubsidy(), result({}))).toEqual(['受理時間需向窗口確認']);
    expect(itemFlags(makeSubsidy({ source_meta: { application_status: '常態受理' } } as any), result({}))).toEqual([]);
  });
});

describe('受理情形提示', () => {
  it('提到截止或尚未開放時照原文提示', () => {
    expect(applicationStatusAlert('115年度已截止；後續年度待公告')).toBe('受理情形：115年度已截止；後續年度待公告');
    expect(applicationStatusAlert('116常態第一期尚未開放')).toContain('尚未開放');
  });
  it('常態受理不提示', () => {
    expect(applicationStatusAlert('常態性；依各校或承辦公告受理')).toBeNull();
    expect(applicationStatusAlert('')).toBeNull();
  });
});
