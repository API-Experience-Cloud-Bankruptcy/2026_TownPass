import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { fetchFormPdf, formAvailability, formPdfUrl, type FormEntry, type FormField } from '../form-fields';
import { fillForm, isAutoFillable, manualSummary, planFill } from '../form-fill';
import { confirmProfile, draftFromAccount, normalizeMobile, validateProfileValue } from '../form-profile';
import { realItem, realItems } from './real-data';

// 專案沒有 Node 型別：用變數當模組名動態載入 node:fs，避免型別錯誤，也不放寬 Vite 的檔案存取限制。
const NODE_FS = 'node:fs';
const readFile = async (relative: string): Promise<Uint8Array> => {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL): Uint8Array };
  return new Uint8Array(fs.readFileSync(new URL(relative, import.meta.url)));
};

const field = (over: Partial<FormField> & Pick<FormField, 'key'>): FormField => ({
  type: 'text', label: over.key, prefill: false, box: { page: 1, x: 100, y: 100, w: 150, h: 18 }, ...over,
});
const own = (over: Partial<FormField> & Pick<FormField, 'key' | 'prefill_key'>): FormField =>
  field({ prefill: true, subject: 'applicant', ...over });
const profile = confirmProfile(
  { name: '王小明', nationalId: 'a123456789', gender: 'male', mobile: '0912-345-678', registeredAddress: '臺北市中正區仁愛路一段1號', contactAddress: '台北市大安區和平東路二段2號' },
  { name: true, nationalId: true, gender: true, mobile: true, registeredAddress: true, contactAddress: true },
);

describe('本人資料確認', () => {
  it('只留下已確認且格式通過的值，並正規化', () => {
    expect(profile).toMatchObject({ name: '王小明', nationalId: 'A123456789', mobile: '0912345678' });
    const p = confirmProfile({ name: '王小明', mobile: '123', nationalId: 'A123456789' }, { name: true, mobile: true });
    expect(p).toEqual({ name: '王小明' });   // 手機格式錯、身分證沒確認
    expect(Object.isFrozen(p)).toBe(true);
  });
  it('城市通資料只是草稿，性別不從身分證推測', () => {
    const draft = draftFromAccount({
      realName: '金大森', idNo: 'A223456789', phoneNo: '+886912345678', residentAddress: '臺北市信義區市府路1號',
      addresses: [{ city: '臺北市', town: '大安區', village: '', street: '和平東路二段2號', priority: true }],
    } as never);
    expect(draft).toEqual({ name: '金大森', nationalId: 'A223456789', mobile: '0912345678', registeredAddress: '臺北市信義區市府路1號', contactAddress: '臺北市大安區和平東路二段2號' });
    expect(draft.gender).toBeUndefined();
    expect(draftFromAccount(null)).toEqual({});
  });
  it('格式驗證', () => {
    expect(validateProfileValue('nationalId', 'A12345678')).not.toBe('');
    expect(validateProfileValue('nationalId', 'A123456789')).toBe('');
    expect(validateProfileValue('mobile', '0212345678')).not.toBe('');
    expect(normalizeMobile('+886 912-345-678')).toBe('0912345678');
    expect(validateProfileValue('registeredAddress', '台北')).not.toBe('');
  });
});

describe('填寫規則', () => {
  const fields = [
    own({ key: 'name', prefill_key: 'name', label: '申請人姓名' }),
    own({ key: 'national_id', prefill_key: 'national_id' }),
    own({ key: 'gender', prefill_key: 'gender' }),
    own({ key: 'mobile', prefill_key: 'mobile' }),
    own({ key: 'phone', prefill_key: 'phone', label: '住宅', variant: 'home' }),
    own({ key: 'address', prefill_key: 'address', label: '戶籍地址', variant: 'registered' }),
    own({ key: 'address', prefill_key: 'address', label: '通訊地址' }),
    field({ key: 'signature', type: 'signature', label: '申請人簽章', prefill: true, prefill_key: 'name', subject: 'applicant' }),
    field({ key: 'name', label: '代理人姓名', candidate_key: 'name', blocked_reason: 'other_person', subject: 'other' }),
    field({ key: 'name', label: '學生姓名', candidate_key: 'name', blocked_reason: 'subject_unclear' }),
    field({ key: 'other', label: '備註' }),
  ];
  it('只填已確認的本人資料；簽名、代理人、不確定主體一律不填', () => {
    const plan = planFill({ fields }, profile, 'self');
    expect(plan.fills.map((f) => [f.field.prefill_key, f.field.label, f.value])).toEqual([
      ['name', '申請人姓名', '王小明'], ['national_id', 'national_id', 'A123456789'], ['gender', 'gender', '男'],
      ['mobile', 'mobile', '0912345678'], ['address', '戶籍地址', '臺北市中正區仁愛路一段1號'], ['address', '通訊地址', '台北市大安區和平東路二段2號'],
    ]);
    const reasons = Object.fromEntries(plan.skipped.map((s) => [s.field.label, s.reason]));
    expect(reasons['申請人簽章']).toBe('signature');
    expect(reasons['代理人姓名']).toBe('not_applicant');
    expect(reasons['學生姓名']).toBe('not_applicant');
    expect(reasons['住宅']).toBe('no_value');           // 沒有確認住家電話，不拿手機代替
    expect(plan.skipped.find((s) => s.field.label === '備註')).toBeUndefined();
  });
  it('替他人辦理時完全不填，但簽名仍標示為略過', () => {
    for (const target of ['other', null] as const) {
      const plan = planFill({ fields }, profile, target);
      expect(plan.fills).toEqual([]);
      expect(plan.skipped.filter((s) => s.reason === 'not_self').length).toBeGreaterThan(0);
    }
  });
  it('資料端沒有確認為申請人本人的欄位不可自動填', () => {
    expect(isAutoFillable(own({ key: 'name', prefill_key: 'name' }))).toBe(true);
    expect(isAutoFillable(own({ key: 'name', prefill_key: 'name', subject: 'unknown' }))).toBe(false);
    expect(isAutoFillable(own({ key: 'name', prefill_key: 'name', subject: undefined }))).toBe(false);
    expect(isAutoFillable(own({ key: 'name', prefill_key: 'name', blocked_reason: 'other_person' }))).toBe(false);
    expect(isAutoFillable(own({ key: 'name', prefill_key: 'name', type: 'signature' }))).toBe(false);
  });
  it('一般電話欄優先用手機，住宅欄只用住家電話', () => {
    const f = [own({ key: 'phone', prefill_key: 'phone', label: '聯絡電話' }), own({ key: 'phone', prefill_key: 'phone', label: '市話' })];
    const only = planFill({ fields: f }, profile, 'self');
    expect(only.fills.map((x) => x.value)).toEqual(['0912345678']);       // 市話欄沒有確認住家電話：不拿手機代替
    const withHome = planFill({ fields: f }, confirmProfile({ homePhone: '02-2345-6789', mobile: '0912345678' }, { homePhone: true, mobile: true }), 'self');
    expect(withHome.fills.map((x) => x.value)).toEqual(['0912345678', '02-2345-6789']);
    const homeOnly = planFill({ fields: f }, confirmProfile({ homePhone: '02-2345-6789' }, { homePhone: true }), 'self');
    expect(homeOnly.fills.map((x) => x.value)).toEqual(['02-2345-6789', '02-2345-6789']);
  });
  it('表單已印地址前綴：只填剩餘部分；前綴對不上就不填', () => {
    const f = [own({ key: 'address', prefill_key: 'address', label: '地址：臺北市', preprinted_prefix: '臺北市' })];
    expect(planFill({ fields: f }, profile, 'self').fills[0].value).toBe('大安區和平東路二段2號');   // 台／臺 視為相同
    const other = confirmProfile({ contactAddress: '新北市板橋區文化路一段1號' }, { contactAddress: true });
    const plan = planFill({ fields: f }, other, 'self');
    expect(plan.fills).toEqual([]);
    expect(plan.skipped[0].reason).toBe('prefix_mismatch');
  });
});

describe('真實資料', () => {
  it('每筆資源都能判斷申請表狀態，可填寫的都帶有合法檔名', () => {
    const kinds = { fillable: 0, external: 0, none: 0 };
    for (const item of realItems) {
      const a = formAvailability(item);
      kinds[a.kind]++;
      if (a.kind === 'fillable') for (const form of a.forms) expect(formPdfUrl(form.entry.localFile!, '')).toMatch(/^\/api\/forms\/[0-9a-f]{12}\.pdf$/);
    }
    expect(kinds.fillable + kinds.external + kinds.none).toBe(217);
    expect(kinds.fillable).toBe(118);
  });
  it('壞資料不會丟例外，也不產生可填表單', () => {
    expect(formAvailability(null).kind).toBe('none');
    expect(formAvailability({ application: { form_fields: 'x' } }).kind).toBe('none');
    const bad = { application: { form_fields: { status: 'analyzed', local_file: '../../etc/passwd', fields: [{ box: { page: 1, x: 0, y: 0, w: 5, h: 5 }, key: 'name' }] } } };
    expect(formAvailability(bad).kind).toBe('none');
  });
  it('簽名欄與親簽政策能被讀到', () => {
    const a = formAvailability(realItem('WEL-0067'));
    expect(a.kind).toBe('fillable');
    if (a.kind === 'fillable') expect(a.forms[0].entry.requiresHandwritten).toBe(true);
  });
});

describe('取得 PDF', () => {
  const entry = { localFile: 'forms/0123456789ab.pdf' };
  const reply = (body: BodyInit, status = 200) => vi.fn().mockResolvedValue(new Response(body, { status }));
  it('接受真正的 PDF', async () => {
    const fetchImpl = reply('%PDF-1.7 body');
    expect((await fetchFormPdf(entry, { base: 'http://x', fetchImpl })).length).toBeGreaterThan(5);
    expect(fetchImpl).toHaveBeenCalledWith('http://x/api/forms/0123456789ab.pdf');
  });
  it('拒絕非 PDF、HTTP 錯誤與非法路徑，且不發請求', async () => {
    await expect(fetchFormPdf(entry, { fetchImpl: reply('<html>') })).rejects.toThrow('不是 PDF');
    await expect(fetchFormPdf(entry, { fetchImpl: reply('x', 404) })).rejects.toThrow('404');
    const never = vi.fn();
    await expect(fetchFormPdf({ localFile: 'forms/../secret.pdf' }, { fetchImpl: never })).rejects.toThrow('無效');
    await expect(fetchFormPdf({ localFile: null }, { fetchImpl: never })).rejects.toThrow('無效');
    expect(never).not.toHaveBeenCalled();
  });
});

describe('在真實表單上填寫', () => {
  const entryOf = async (id: string): Promise<{ entry: FormEntry; bytes: Uint8Array; font: Uint8Array }> => {
    const a = formAvailability(realItem(id));
    if (a.kind !== 'fillable') throw new Error(`${id} not fillable`);
    const entry = a.forms[0].entry;
    return {
      entry,
      bytes: await readFile(`../../../../backend/data/${entry.localFile}`),
      font: await readFile('../../assets/fonts/NotoSansTC-Regular.ttf'),
    };
  };
  it('產生仍可開啟、頁數不變的 PDF，並如實回報填了什麼', async () => {
    const { entry, bytes, font } = await entryOf('WEL-0028');       // 含 90° 旋轉頁
    const before = (await PDFDocument.load(bytes)).getPageCount();
    const report = await fillForm(bytes, font, entry, profile, 'self');
    expect((await PDFDocument.load(report.bytes)).getPageCount()).toBe(before);
    expect(report.drawn.length).toBeGreaterThan(0);
    expect(report.drawn.every((d) => isAutoFillable(d.field))).toBe(true);
    expect(report.drawn.some((d) => d.field.type === 'signature')).toBe(false);
    expect(manualSummary(entry, report).signatures).toBeGreaterThan(0);
  }, 60_000);
  it('不是替本人辦理時，一個字都不畫', async () => {
    const { entry, bytes, font } = await entryOf('WEL-0028');
    const report = await fillForm(bytes, font, entry, profile, 'other');
    expect(report.drawn).toEqual([]);
  }, 60_000);
});
