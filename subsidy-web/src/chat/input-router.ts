import type { Subsidy } from '../domain/types';
import { searchSynonyms } from '../domain/situations';
import type { ChatChoice, Interpretation, InterpretationContext } from './interpretation';

type Answer = Extract<Interpretation, { kind: 'answer' }>;
type ChoiceRoute =
  | { kind: 'answer'; answer: Answer; matchedLabel: string; match: 'exact' | 'alias' | 'ordinal' }
  | { kind: 'confirm_choice'; choices: ChatChoice[]; reason: 'typo' | 'ambiguous' };

export type InputRoute =
  | { kind: 'empty' }
  | ChoiceRoute
  | { kind: 'search'; query: string }
  | { kind: 'conversation' }
  | { kind: 'clarify'; message: string }
  | { kind: 'command'; command: 'back' | 'cancel' | 'restart' | 'help' };

/** 比對用字形；不改寫原始 evidence，也不把否定字或數字移除。 */
export function normalizeInput(input: string): string {
  return input.normalize('NFKC').toLowerCase().replace(/臺/gu, '台').replace(/[\s\p{P}]+/gu, '');
}

const yesAliases = new Set(['是', '是的', '對', '對的', '沒錯', '有', '有的', 'yes']);
const noAliases = new Set(['否', '不是', '不是的', '不對', '沒有', '沒有的', '無', 'no']);
const clarifyChoice = '請選下方的選項，或多說一點想找什麼。';
const uncertain = /(?:不確定|不知道|不清楚|可能|也許|好像|應該|大概|或者|或是|還是|如果|假如|是否|能否|可否|不一定|不見得|不太確定)/u;
const question = /[?？]|(?:嗎|呢|怎麼|如何|為何|為什麼|什麼|哪個|哪些|可不可以|能不能|有沒有)/u;

function confirm(choices: readonly ChatChoice[], reason: 'typo' | 'ambiguous'): ChoiceRoute {
  return { kind: 'confirm_choice', choices: choices.slice(0, 3).map(choice => ({ ...choice })), reason };
}

function select(choice: ChatChoice, input: string, match: 'exact' | 'alias' | 'ordinal'): ChoiceRoute {
  return { kind: 'answer', answer: { kind: 'answer', choiceId: choice.id, evidence: input }, matchedLabel: choice.label, match };
}

/** 僅限畫面上可選的需求；完整短詞匹配，不從敘述句擷取關鍵字。 */
export const NEED_ALIASES: Readonly<Record<string, readonly string[]>> = {
  living: ['生活費', '急難', '低收入'],
  elder: ['長者', '敬老', '長照', '中高齡'],
  study: ['就學', '學費', '學雜費', '助學金', '獎學金'],
  family: ['育兒', '家庭', '生育', '托育', '兒少', '婦女'],
  health: ['醫療', '健康', '健保', '篩檢', '醫療補助'],
  disability: ['身障', '身障補助', '輔具'],
  housing: ['住宅', '租屋', '租金補貼', '購屋', '修繕'],
  community: ['文化', '社區', '藝文', '競賽', '公益', '環境'],
  work: ['工作', '失業', '職訓', '職災', '創業'],
};

/** 僅解析標準的非負整數，拒絕約數、小數、範圍與混合數字。 */
function integer(text: string): number | null {
  if (/^\d{1,3}$/u.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^[零〇一二兩三四五六七八九]$/u.test(text)) return digits[text]!;
  if (/^[一二兩三四五六七八九][零〇一二三四五六七八九]{1,2}$/u.test(text)) {
    return Number([...text].map(char => digits[char]).join(''));
  }
  const match = /^(?:([一二兩三四五六七八九])百(?:[零〇])?)?(?:([一二兩三四五六七八九])?十)?([一二三四五六七八九])?$/u.exec(text);
  if (!match || !text || !/[百十]/u.test(text)) return null;
  // 「一百二」有 102 / 120 歧義；缺少零或十時交回對話處理。
  if (/百[一二三四五六七八九]$/u.test(text)) return null;
  return (match[1] ? digits[match[1]]! * 100 : 0)
    + (text.includes('十') ? (match[2] ? digits[match[2]]! : 1) * 10 : 0)
    + (match[3] ? digits[match[3]]! : 0);
}

function ordinal(text: string): number | null {
  const match = /^(?:第([\d零〇一二兩三四五六七八九十百]+)(?:個|項|個選項|項選項)|選(?:第)?([\d零〇一二兩三四五六七八九十百]+)(?:個|項|個選項|項選項)?)$/u.exec(text);
  return match ? integer(match[1] ?? match[2]!) : null;
}

function booleanChoice(value: boolean, context: InterpretationContext): ChatChoice | null {
  const q = context.question;
  if (q?.kind !== 'boolean') return null;
  const allowed = context.allowedFacts.find(fact => fact.field === q.field);
  const matches = context.choices.filter(choice => q.options.some(option => option.id === choice.id)).filter(choice => {
    const option = allowed?.options?.find(option => normalizeInput(option.label) === normalizeInput(choice.label));
    if (typeof option?.value === 'boolean') return option.value === value;
    return (value ? yesAliases : noAliases).has(normalizeInput(choice.label));
  });
  return matches.length === 1 ? matches[0]! : null;
}

function oneEdit(a: string, b: string): boolean {
  const left = [...a], right = [...b];
  if (Math.abs(left.length - right.length) > 1 || a === b) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (left.length <= right.length) j++;
  }
  return edits + Number(i < left.length || j < right.length) === 1;
}

function safeTypoPair(input: string, label: string): boolean {
  if ([...input].length < 3 || [...label].length < 3 || Math.max(input.length, label.length) > 40) return false;
  // 這些文字的一字差可能改變法定身分、地點或否定語意，不提供錯字猜測。
  if (/(?:低收|中低|核定|戶籍|台北|新北|taipei|newtaipei)/u.test(input + label)) return false;
  const signature = (text: string) => (text.match(/[\d零〇一二兩三四五六七八九十百不沒無未非]/gu) ?? []).join('');
  if (signature(input) !== signature(label)) return false;
  return oneEdit(input, label);
}

/** 只使用當下明列的選項；近似命中一律回傳候選，從不自動作答。 */
export function matchCurrentChoice(input: string, context: InterpretationContext): ChoiceRoute | null {
  const text = normalizeInput(input);
  if (!text || /[?？「」『』“”‘’"'`]/u.test(input)) return null;
  // 數值／序號不可使用會移除標點的 label 正規化，避免 6.5 或 6-5 被讀成 65。
  const numericText = input.normalize('NFKC').trim().replace(/[。!！]$/u, '').trim().replace(/\s+歲$/u, '歲');
  if (/^[\d零〇一二兩三四五六七八九十百]+$/u.test(numericText) && context.question?.kind !== 'number') return null;
  const numericLabel = /^[\d零〇一二兩三四五六七八九十百]+(?:歲)?$/u.test(text);
  const exact = numericLabel ? [] : context.choices.filter(choice => normalizeInput(choice.label) === text);
  if (exact.length === 1) return select(exact[0]!, input, 'exact');
  if (exact.length > 1) return confirm(exact, 'ambiguous');
  const targetId = ['自己', '我', '本人', '幫我', '我自己'].includes(text) ? 'target:self'
    : ['家人', '別人', '幫家人', '幫別人'].includes(text) ? 'target:other' : null;
  const targetChoice = context.choices.find(choice => choice.id === targetId);
  if (targetChoice) return select(targetChoice, input, 'alias');
  // 明確說不知道只等同畫面的略過，不是布林「否」。
  if (context.question && ['不知道', '不確定', '不清楚', '先跳過', '跳過', '略過'].includes(text)) {
    const skip = context.choices.find(choice => choice.id === 'skip');
    if (skip) return select(skip, input, 'alias');
  }
  if (uncertain.test(text) || question.test(text)) return null;

  const needs = context.choices.filter(choice => choice.id.startsWith('need:')
    && NEED_ALIASES[choice.id.slice(5)]?.some(alias => normalizeInput(alias) === text));
  if (needs.length === 1) return select(needs[0]!, input, 'alias');
  if (needs.length > 1) return confirm(needs, 'ambiguous');

  const index = ordinal(numericText);
  if (index !== null) return index > 0 && context.choices[index - 1] ? select(context.choices[index - 1]!, input, 'ordinal') : null;

  const q = context.question;
  if (q?.kind === 'number') {
    const numeric = q.field === 'age' ? numericText.replace(/歲$/u, '') : numericText;
    const value = /^\d{1,3}$/u.test(numeric) || q.field === 'age' ? integer(numeric) : null;
    if (value !== null && value >= (q.min ?? 0) && value <= (q.max ?? 130)) {
      return { kind: 'answer', answer: { kind: 'answer', numberValue: value, evidence: input }, matchedLabel: `${value}${q.field === 'age' ? ' 歲' : ''}`, match: 'exact' };
    }
    // 年齡不做錯字容錯，亦不將題目旁的略過等按鈕誤認成年齡。
    return null;
  }

  const polarity = yesAliases.has(text) ? true : noAliases.has(text) ? false : null;
  if (polarity !== null) {
    const choice = booleanChoice(polarity, context);
    return choice ? select(choice, input, 'alias') : null;
  }

  if (isSentence(input) || /[\s,，、/／+＋&＆]/u.test(input.trim()) || ['region', 'household_type'].includes(q?.field ?? '')) return null;
  const near = context.choices.filter(choice => safeTypoPair(text, normalizeInput(choice.label)));
  return near.length ? confirm(near, near.length === 1 ? 'typo' : 'ambiguous') : null;
}

function isSentence(input: string): boolean {
  const text = input.normalize('NFKC');
  return question.test(text) || uncertain.test(text)
    || /(?:我|本人|對方|家人|爸爸|媽媽|父親|母親|孩子|小孩|先生|太太|朋友|他們|她們|我們)/u.test(text)
    || /(?:不是|並非|沒有|尚未|還沒|不想|不要|不符合|不能|不需要|不可以|已經|已核定|未核定|已領|領過|目前|今年|住在|設籍|戶籍在|符合|申請過|正在|怎樣|但是|可是|因為|所以|如果|假如)/u.test(text)
    || /^(?:不(?!存在的)|沒|未|非|想|需要|請|可以|能不能|是學生)/u.test(text.trim())
    || /(?:[\d零〇一二兩三四五六七八九十百]+\s*歲|失業了|退休了|生病了)/u.test(text)
    || /(?:付不起|繳不出|繳不起|負擔不起|負擔很重|壓力很大|需要照顧|需要幫忙)/u.test(text)
    || /^(?:最近|近來|這陣子)/u.test(text.trim());
}

function multipleChoices(input: string, context: InterpretationContext): boolean {
  let remaining = normalizeInput(input);
  let count = 0;
  // 先移除長標籤，避免「中低收入戶」同時算成「低收入戶」。僅用來澄清，絕不用來選答案。
  const labels = [...new Set(context.choices.map(choice => normalizeInput(choice.label)))].filter(label => label.length >= 2).sort((a, b) => b.length - a.length);
  for (const label of labels) {
    if (remaining.includes(label)) { count++; remaining = remaining.replace(label, ''); }
  }
  return count > 1;
}

function catalogTerms(catalog: readonly Subsidy[]): string[] {
  return [...new Set(catalog.flatMap(item => [item.name, ...item.search.keywords]).map(term => term.trim()).filter(Boolean))];
}

function nounQuery(input: string): boolean {
  return input.length >= 2 && input.length <= 24 && !isSentence(input)
    && !/[。.!！?？;；:：\n\r<>={}]/u.test(input)
    && /^[\p{Script=Han}\p{L}\p{N}\s・·()（）\-]+$/u.test(input)
    && !/(?:或|以及|然後|請問|請幫|幫忙|告訴|解釋|忽略)/u.test(input);
}

const vagueResource = /^(?:所有|政府|社會)?(?:補助|補貼|津貼|福利|資源|補助資源|社會福利)$/u;

/** 明列句型的名稱搜尋捷徑；只收完整單一名詞，不從一般敘述擷取需求。 */
function requestedResource(input: string, catalog: readonly Subsidy[]): string | null {
  const text = input.normalize('NFKC').trim();
  const request = /^(?:我(?:想要|需要|想找|想查|想申請)|想要|需要|想找|請(?:幫我|幫忙)(?:找|搜尋|查找)|幫我(?:找|搜尋|查找)|(?:請問)?有沒有)\s*(.+?)(?:[?!.。]|嗎[?!.。]?)?$/u.exec(text);
  if (!request) return null;
  const query = request[1]!.trim();
  if (vagueResource.test(query)) return query;
  // 正式名稱可能含「與／及」；只允許原目錄中的完整名稱例外。
  const formalName = (name: string) => name.normalize('NFKC').toLowerCase().replace(/臺/gu, '台').replace(/\s+/gu, '');
  if (!isSentence(query) && catalog.some(item => formalName(item.name) === formalName(query))
    && !/[「」『』“”‘’"'`]/u.test(query)) return query;
  const known = catalogTerms(catalog).some(term => formalName(term) === formalName(query));
  // 「不孕症治療補助」「5歲就學補助」是目錄中的名稱，不是從否定句或年齡陳述猜出的需求。
  if (known && /(?:補助|補貼|津貼|獎學金|助學金|給付|減免|年金)$/u.test(query)) return query;
  if (!nounQuery(query) || /(?:和|與|及|還|也|但|改|只|再|不|沒|無|未|非|\d.*歲)/u.test(query)) return null;
  const normalized = normalizeInput(query);
  // 不因尾端出現「補助」就認定整句是單一名稱，避免多需求黏在一起。
  return known || searchSynonyms(normalized).length > 1 ? query : null;
}

function compoundResourceQuery(query: string, catalog: readonly Subsidy[]): boolean {
  const text = query.normalize('NFKC').replace(/臺/gu, '台').replace(/\s+/gu, '');
  // 目錄中的正式聯合方案仍是一個完整查詢，不按名稱內的「及／與」拆開。
  if (catalogTerms(catalog).some(term => term.normalize('NFKC').replace(/臺/gu, '台').replace(/\s+/gu, '') === text)) return false;
  if (/(?:和|與|及|還要|也要|還想|也想|加上|同時|或|還是|[、，,;；+＆&])/u.test(query)) return true;
  // 保留既有多 token AND 查詢（例如「租金補貼 低收入戶」），不把篩選詞當第二需求。
  if (/\s/u.test(query)) return false;
  const directions = Object.values(NEED_ALIASES).filter(aliases => aliases.some(alias => text.includes(alias)));
  return directions.length > 1;
}

const commands: Readonly<Record<string, 'back' | 'cancel' | 'restart' | 'help'>> = {
  返回: 'back', 上一步: 'back', 回上一步: 'back',
  取消: 'cancel', 取消操作: 'cancel',
  重新開始: 'restart', 重來: 'restart',
  幫助: 'help', 使用說明: 'help', 找人幫忙: 'help',
};

/** 純分類，不呼叫模型、搜尋、不改寫 context 或工作階段。上層負責執行與確認。 */
export function routeInput(input: string, context: InterpretationContext, catalog: readonly Subsidy[]): InputRoute {
  const raw = input.trim();
  if (!raw) return { kind: 'empty' };
  if (raw.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(raw)) {
    return { kind: 'clarify', message: '請簡短描述需要什麼幫忙，或選下方的選項。' };
  }
  const normalized = normalizeInput(raw);
  if (!normalized) return { kind: 'clarify', message: clarifyChoice };
  // 只允許完整固定命令；引號、問號、複合句不觸發動作。
  const commandText = raw.normalize('NFKC').replace(/[。!！]$/u, '').trim();
  const command = Object.prototype.hasOwnProperty.call(commands, commandText) ? commands[commandText] : undefined;
  if (command) return { kind: 'command', command };

  const choice = matchCurrentChoice(input, context);
  if (choice) return choice;
  const requested = requestedResource(raw, catalog);
  if (requested) return vagueResource.test(requested)
    ? { kind: 'clarify', message: '想找哪一方面的補助？例如租屋、學費或育兒，也可以選下方的選項。' }
    : { kind: 'search', query: requested };
  if (multipleChoices(raw, context) || /(?:或|還是)/u.test(raw) || (uncertain.test(raw) && !question.test(raw))) {
    return { kind: 'clarify', message: '我還不確定你要選哪一項，可以直接選下方選項，或再多說一點。' };
  }
  if (isSentence(raw)) return { kind: 'conversation' };
  // 「對」「沒有」等只有在當前布林題可作答；其他頁面不猜測其意思。
  if (yesAliases.has(normalized) || noAliases.has(normalized)) return { kind: 'clarify', message: clarifyChoice };

  const explicit = /^(?:搜尋|查找)\s*[:：]?\s*(.+)$/u.exec(raw);
  const query = explicit?.[1]?.trim() ?? raw;
  if (vagueResource.test(query)) return { kind: 'clarify', message: '想找哪一方面的補助？例如租屋、學費或育兒，也可以選下方的選項。' };
  if (compoundResourceQuery(query, catalog)) return { kind: 'clarify', message: '你提到不只一種需求，想先找哪一方面的資源？' };
  if (!nounQuery(query)) {
    // 完整正式名稱可比一般短查詢長，但仍不得含個人陳述、否定或問句。
    if (!isSentence(query) && catalog.some(item => normalizeInput(item.name) === normalizeInput(query))) return { kind: 'search', query };
    return raw.length > 24 ? { kind: 'conversation' } : { kind: 'clarify', message: clarifyChoice };
  }
  const terms = catalogTerms(catalog).map(normalizeInput);
  const tokens = query.normalize('NFKC').split(/\s+/u).filter(Boolean).map(normalizeInput);
  const known = tokens.every(token => token.length >= 2 && terms.some(term => term.includes(token)));
  const namedProgram = /(?:補助|補貼|津貼|獎學金|助學金)[a-z\d]*$/iu.test(query);
  // 未知純英數字串無法判斷是否為名稱，避免把亂碼當成明確搜尋意圖。
  if (known || namedProgram || suggestSearchQueries(query, catalog).length > 0 || (explicit && /\p{Script=Han}/u.test(query))) return { kind: 'search', query };
  return { kind: 'clarify', message: '請補充補助名稱或需要什麼幫忙，也可以選下方的選項。' };
}

/** 零筆結果的提示候選，絕不自動替換 query。僅取實際名稱與 keywords。 */
export function suggestSearchQueries(query: string, catalog: readonly Subsidy[]): string[] {
  const text = normalizeInput(query);
  if (!nounQuery(query) || [...text].length < 3) return [];
  return catalogTerms(catalog).filter(term => term.length <= 24 && safeTypoPair(text, normalizeInput(term))).slice(0, 3);
}
