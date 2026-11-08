import { describe, expect, it } from 'vitest';
import { segmentText } from '../channel-text';

const links = (t: string) => segmentText(t).filter((s) => s.kind !== 'text');

describe('原文中的網址與電話可點', () => {
  it('原文完整保留，只標出網址與電話', () => {
    const t = '臺北市信義區市府路1號；電話1999（外縣市02-2720-8889）轉分機6969；https://service.taipei/case-detail/AI063（頁面為動態載入）';
    expect(segmentText(t).map((s) => s.text).join('')).toBe(t);
    expect(links(t)).toEqual([
      { kind: 'phone', text: '1999（外縣市02-2720-8889）轉分機6969', dial: '1999,6969' },
      { kind: 'url', text: 'https://service.taipei/case-detail/AI063', url: 'https://service.taipei/case-detail/AI063' },
    ]);
  });
  it('各種電話寫法', () => {
    expect(links('洽02-29365522分機359').map((s) => s.kind === 'phone' && s.dial)).toEqual(['0229365522,359']);
    expect(links('電話(02)2351-4078').map((s) => s.kind === 'phone' && s.dial)).toEqual(['0223514078']);
    expect(links('市話0800-055-850／手機55850').map((s) => s.kind === 'phone' && s.dial)).toEqual(['0800055850']);
    expect(links('1999轉1609-1613').map((s) => s.kind === 'phone' && s.dial)).toEqual(['1999,1609']);
  });
  it('沒有 https 的政府網域補上協定；年份與郵遞區號不當成電話', () => {
    expect(links('線上申辦（cfedaweb.mohw.gov.tw）')).toEqual([{ kind: 'url', text: 'cfedaweb.mohw.gov.tw', url: 'https://cfedaweb.mohw.gov.tw' }]);
    expect(links('110204臺北市信義區市府路1號，2019年起')).toEqual([]);
  });
});
