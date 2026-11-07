import type { Category, Identity, Profile } from '../data/welfare-schema';

/** What we understood from a free-text description of someone's situation. */
export interface Interpretation {
  categories: Category[];
  profile: Partial<Profile> & { identities: Identity[] };
  /** Short phrases shown back to the user, e.g. 「一個人住」. */
  heard: string[];
}

/**
 * Interpreter contract. The keyword version runs offline; an LLM-backed version
 * can implement the same signature and be swapped in at `interpretSituation`.
 */
export type Interpreter = (text: string) => Promise<Interpretation>;

interface Rule {
  words: RegExp;
  heard: string;
  categories?: Category[];
  identity?: Identity;
  patch?: Partial<Profile>;
}

const RULES: Rule[] = [
  { words: /中低收/, heard: '中低收入戶', categories: ['hardship'], identity: 'mid_low_income' },
  { words: /(?<!中)低收/, heard: '低收入戶', categories: ['hardship'], identity: 'low_income' },
  { words: /身障|身心障礙|殘障|障礙手冊|障礙證明/, heard: '身心障礙', categories: ['care'], identity: 'disability' },
  { words: /原住民/, heard: '原住民', identity: 'indigenous' },
  { words: /新住民|外配|外籍配偶|陸配/, heard: '新住民', identity: 'new_resident' },
  { words: /單親|特殊境遇/, heard: '單親或特殊境遇', categories: ['hardship', 'parenting'], identity: 'single_parent' },
  { words: /榮民|退伍/, heard: '榮民', identity: 'veteran' },
  { words: /照顧(家人|爸|媽|父|母|先生|太太|老伴)/, heard: '照顧家人', categories: ['care'], identity: 'caregiver' },
  { words: /獨居|一個人住|自己住|一個人生活/, heard: '一個人住', categories: ['senior'], patch: { livesAlone: true } },
  { words: /和家人住|跟家人住|同住/, heard: '和家人同住', patch: { livesAlone: false } },
  { words: /失業|沒工作|沒有工作|找工作|被裁員|資遣/, heard: '目前沒有工作', categories: ['work'], patch: { employed: false } },
  { words: /上班|有工作|打工|兼職/, heard: '目前有工作', categories: ['work'], patch: { employed: true } },
  { words: /租屋|租房|房租|租金|房東/, heard: '租屋', categories: ['housing'], patch: { renter: true } },
  { words: /老人|長輩|長者|退休|老了|阿公|阿嬤|銀髮/, heard: '長輩', categories: ['senior'] },
  { words: /懷孕|生產|生小孩|新生兒|嬰兒|寶寶|育兒|托育|小孩|孩子|兒子|女兒/, heard: '育兒', categories: ['parenting'] },
  { words: /看病|醫療|住院|生病|開刀|長照|照顧|失智|復健|輔具/, heard: '醫療或照顧', categories: ['care'] },
  { words: /學費|上學|讀書|學生|註冊費|營養午餐|課本/, heard: '就學費用', categories: ['education'] },
  { words: /上課|課程|學習|社區大學|樂齡/, heard: '想上課學習', categories: ['learning'] },
  { words: /上網|網路|手機|電腦|平板|wifi|Wi-Fi|數位/i, heard: '上網與設備', categories: ['digital'] },
  { words: /交通|公車|捷運|敬老卡|愛心卡|停車|車位/, heard: '交通', categories: ['housing'] },
  { words: /沒錢|缺錢|繳不出|付不出|負債|生活困難|急難|三餐/, heard: '經濟困難', categories: ['hardship'] },
];

export function interpretByKeywords(text: string, now: Date = new Date()): Interpretation {
  const categories = new Set<Category>();
  const identities = new Set<Identity>();
  const heard: string[] = [];
  const profile: Interpretation['profile'] = { identities: [] };

  for (const rule of RULES) {
    if (!rule.words.test(text)) continue;
    heard.push(rule.heard);
    rule.categories?.forEach((c) => categories.add(c));
    if (rule.identity) identities.add(rule.identity);
    Object.assign(profile, rule.patch);
  }

  const roc = text.match(/民國\s*(\d{2,3})\s*年/);
  const western = text.match(/(19[2-9]\d|20[0-2]\d)\s*年/);
  const age = text.match(/(\d{1,3})\s*歲/);
  if (roc) profile.birthYear = Number(roc[1]) + 1911;
  else if (western) profile.birthYear = Number(western[1]);
  else if (age) profile.birthYear = now.getFullYear() - Number(age[1]);
  if (profile.birthYear !== undefined) {
    const years = now.getFullYear() - profile.birthYear;
    heard.push(`約 ${years} 歲`);
    if (years >= 65) categories.add('senior');
  }

  const months = text.match(/(?:設籍|住在?臺北|住在?台北)[^\d]{0,6}(\d{1,2})\s*(年|個月)/);
  if (months) {
    profile.residentMonths = Number(months[1]) * (months[2] === '年' ? 12 : 1);
    heard.push(`設籍 ${months[1]} ${months[2]}`);
  }

  profile.identities = [...identities];
  return { categories: [...categories], profile, heard: [...new Set(heard)] };
}

export const interpretSituation: Interpreter = async (text) => interpretByKeywords(text);
