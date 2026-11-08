// 受理窗口等原文切段：網址與電話變成可點的項目，其餘原文照列（不改寫原文）。

export type TextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'url'; text: string; url: string }
  | { kind: 'phone'; text: string; dial: string };

const URL = '(?:https?:\\/\\/[^\\s，、；;（）()「」『』]+|(?<![\\w.@/-])(?:[a-z0-9-]+\\.)+gov\\.tw(?:\\/[^\\s，、；;（）()「」『』]*)?)';
// 市話／免付費（含括號區碼）或 1999、1966、1957 短碼；可帶「轉（分機）NNNN」或「分機NNN」。
const PHONE = '(?:\\(0\\d{1,2}\\)\\s?\\d{3,4}-?\\d{3,4}|(?<!\\d)0\\d{1,3}-\\d{3,4}-?\\d{3,4}(?!\\d)|(?<!\\d)0\\d{8,9}(?!\\d)|(?<![\\d分機轉])(?:1999|1966|1957)(?!\\d))(?:\\s?(?:（外縣市[^）]*）)?\\s?(?:轉\\s?(?:分機)?|分機)\\s?\\d{2,5})?';
const PATTERN = new RegExp(`(${URL})|(${PHONE})`, 'giu');

/** 撥號字串：主號只留數字，分機用逗號（撥通後暫停再撥）。 */
export function dialOf(text: string): string {
  const ext = text.match(/(?:轉\s?(?:分機)?|分機)\s?(\d{2,5})/);
  const main = text.replace(/（外縣市[^）]*）/, '').replace(/(?:轉|分機).*$/, '').replace(/\D/g, '');
  return ext ? `${main},${ext[1]}` : main;
}

export function segmentText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    const raw = m[0];
    if (m[1]) {
      const trimmed = raw.replace(/[。.]+$/, '');
      out.push({ kind: 'url', text: trimmed, url: /^https?:/i.test(trimmed) ? trimmed : `https://${trimmed}` });
      if (trimmed.length < raw.length) out.push({ kind: 'text', text: raw.slice(trimmed.length) });
    } else {
      out.push({ kind: 'phone', text: raw, dial: dialOf(raw) });
    }
    last = start + raw.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
