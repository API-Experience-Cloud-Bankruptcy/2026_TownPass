import { expect, it } from 'vitest';
import { explicitlyChangesPerson, latestCorrectionInput } from '../conversation-input';
it.each(['改幫爸爸找，他73歲', '換幫媽媽找長照', '我想改幫家人找', '這次換個人，爸爸76歲'])('明確換人：%s', text => expect(explicitlyChangesPerson(text)).toBe(true));
it.each(['我沒有要換個人，只是更正媽媽73歲', '不要改幫爸爸', '換幫爸爸可以嗎？', '我想知道是否能換個人', '媽媽不是學生', '先前說法：改幫爸爸找\n這次補充或修正：更正為73歲'])('不由否定、問句或舊歷史換人：%s', text => expect(explicitlyChangesPerson(text)).toBe(false));
it('多次修正只看最後這次', () => {
  const text = '先前說法：換幫媽媽\n這次補充或修正：更正72歲\n這次補充或修正：改幫爸爸找';
  expect(latestCorrectionInput(text)).toBe('改幫爸爸找');
  expect(explicitlyChangesPerson(text)).toBe(true);
});
