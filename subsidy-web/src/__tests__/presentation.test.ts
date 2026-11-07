import { describe, expect, it } from 'vitest';
import { makeSubsidy } from '../domain/__tests__/fixtures';
import type { MatchResult } from '../domain/types';
import { applicationStatusAlert, benefitLabel, currentStepIndex, deadlineNote, fitNote, progressText, statusPlain } from '../presentation';

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
