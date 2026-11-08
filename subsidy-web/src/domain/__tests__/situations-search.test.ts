import { describe, expect, it } from 'vitest';
import { filterCatalog, searchScore } from '../situations';
import { makeSubsidy } from './fixtures';
import { realItems } from './real-data';

const ids = (query: string) => filterCatalog(realItems, null, query).map(item => item.id);

describe('217 筆真實目錄的窄詞組搜尋', () => {
  it.each(['租屋補助', '租屋補貼', '租金補助', '租金補貼', '房租補助', '房租補貼'])('%s 能找官方租補，不擴成購屋修繕', query => {
    expect(realItems).toHaveLength(217);
    const hits = ids(query);
    expect(hits).toEqual(expect.arrayContaining(['CT-0019', 'CT-0123', 'CT-0146', 'CT-0149', 'WEL-0038', 'WEL-0116']));
    expect(hits).not.toContain('CT-0147'); // 身障者購屋貸款利息補貼
    expect(hits).not.toContain('WEL-0037'); // 社宅承租；沒有租補字詞便不按住宅分類加入
    expect(hits.length).toBeLessThan(15);
  });

  it.each([
    ['學費補助', ['WEL-0003', 'WEL-0007', 'CT-0035', 'CT-0061', 'WEL-0127']],
    ['失業補助', ['WEL-0112']],
    ['職訓生活津貼', ['WEL-0114', 'WEL-0119']],
    ['身障生活補助', ['CT-0110']],
  ] as const)('%s 對應目錄可核對的具體用語', (query, expected) => {
    expect(ids(query)).toEqual(expect.arrayContaining([...expected]));
  });

  it('同義詞保留每個 token 必須命中的 AND 規則', () => {
    const rent = ids('租屋補助');
    const lowIncome = ids('租屋補助 低收入戶');
    expect(lowIncome).toContain('CT-0123');
    expect(lowIncome.every(id => rent.includes(id))).toBe(true);
    expect(ids('租屋補助 完全不存在的詞')).toEqual([]);
    expect(ids('租金 補貼 完全不存在的詞')).toEqual([]);
    expect(ids('青年 藝術')).toContain('WEL-0082');
    expect(ids('青年藝術')).toEqual(['WEL-0082']);
  });

  it('不對詞組內局部替換，亦不把不同育兒制度混為同義詞', () => {
    expect(searchScore(makeSubsidy({ name: '租金補貼' }), '低收入戶租屋補助')).toBe(0);
    expect(searchScore(makeSubsidy({ name: '托育補助' }), '育兒津貼')).toBe(0);
    expect(searchScore(makeSubsidy({ name: '購屋貸款利息補貼' }), '租屋補助')).toBe(0);
    expect(searchScore(makeSubsidy({ name: '住宅修繕補助' }), '房租補助')).toBe(0);
  });
  it('同義詞只改命中詞組，不重複加總分數', () => {
    expect(searchScore(makeSubsidy({ name: '租屋補助與租金補貼' }), '房租補助')).toBe(8);
    expect(searchScore(makeSubsidy({ name: '租金補貼' }), '租金 補貼')).toBe(16);
    expect(filterCatalog(realItems, null, '')).toHaveLength(217);
  });
});
