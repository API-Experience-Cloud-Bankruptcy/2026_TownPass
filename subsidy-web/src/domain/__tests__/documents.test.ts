import { describe, expect, it } from 'vitest';
import { mergeDocuments } from '../documents';
import { makeSubsidy } from './fixtures';

describe('文件合併', () => {
  it('完全相同才合併並保留用途；同名不同條件分列', () => {
    const a = makeSubsidy({ id: 'A', name: '甲', application: { required_documents: [
      { name: '戶口名簿', condition: null, notes: '', required: true },
      { name: '診斷證明', condition: '三個月內', notes: '', required: true },
    ] } } as any);
    const b = makeSubsidy({ id: 'B', name: '乙', application: { required_documents: [
      { name: '戶口名簿', condition: null, notes: '', required: true },
      { name: '診斷證明', condition: '一年內', notes: '', required: true },
    ] } } as any);
    const { documents } = mergeDocuments([a, b]);
    const household = documents.filter((d) => d.name === '戶口名簿');
    expect(household).toHaveLength(1);
    expect(household[0].usedBy.map((u) => u.name)).toEqual(['甲', '乙']);
    const diag = documents.filter((d) => d.name === '診斷證明');
    expect(diag).toHaveLength(2);
    expect(diag.every((d) => d.hasVariant)).toBe(true);
  });
  it('空文件清單標示未補齊', () => {
    const a = makeSubsidy({ id: 'A', name: '甲', application: { required_documents: [] } } as any);
    expect(mergeDocuments([a]).incomplete).toEqual([{ id: 'A', name: '甲' }]);
  });
});
