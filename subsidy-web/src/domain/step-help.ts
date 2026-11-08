// 困難排序僅用於提示；不推定資格、替代辦理方式或步驟已完成。
import { plainLanguageFor } from './plain-language';
import { stepGuideFor } from './step-guide';
import { text } from './match';
import { buildRoute } from './route';
import type { Subsidy } from './types';

const problems = [
  { id: 'documents', label: '文件不知道去哪裡拿', pattern: /文件|證明|備齊|備妥|附件|戶籍|身分證|收據/, action: '先核對本步驟的相關文件的名稱、條件與備註。缺少的文件，向受理窗口確認取得方式及是否接受替代文件。', question: '這一步缺少的文件要去哪裡取得？是否有可接受的替代文件？' },
  { id: 'form', label: '不知道怎麼填表', pattern: /填|表格|申請書/, action: '先開啟方案的表單或來源說明，對照填寫說明。把不確定的欄位名稱記下來，確認後再填，不要猜填。', question: '這一步的表單要填哪些欄位？不確定或不適用的欄位要怎麼處理？' },
  { id: 'login', label: '登入或身分驗證失敗', pattern: /登入|註冊|綁定|驗證|憑證|健保卡/, action: '從方案申請入口確認支援的登入方式，核對畫面的錯誤訊息；使用該網站提供的帳號恢復或客服入口。詢問時不要提供密碼或驗證碼。', question: '這一步的登入或驗證失敗，應使用哪種驗證方式？可以向哪個窗口排除問題？' },
  { id: 'upload', label: '附件傳不上去', pattern: /上傳|附檔|附件|掃描/, action: '先查看申請網站對格式、大小與張數的限制，確認檔案可開啟、內容清楚。若仍失敗，記下錯誤訊息，向窗口確認可用的補交方式。', question: '這一步附件無法上傳，格式與大小有什麼限制？是否有其他補交方式？' },
  { id: 'device', label: '網路或設備無法操作', pattern: /線上|網路|App|APP|平台|網站/, action: '先保留已填內容，確認網路連線，再依網站提示重試。若設備不支援，詢問窗口能否協助操作或提供其他辦理方式。', question: '我的設備無法操作這一步，有協助操作或其他辦理方式嗎？' },
  { id: 'visit', label: '不方便到現場', pattern: /臨櫃|到場|親送|現場|公所|送件/, action: '先核對本方案受理窗口及方案辦理方式，再詢問這一步能否改用郵寄、線上或委託；確認適用條件後再安排。', question: '這一步不方便到現場，是否接受郵寄、線上或委託？有什麼限制與文件要求？' },
  { id: 'contact', label: '不知道要找哪個窗口', pattern: /洽|窗口|聯絡|學校|機構|中心/, action: '先查看本方案受理窗口與方案來源，聯絡時說明方案名稱和目前步驟。若不是該窗口承辦，請對方確認正確聯絡單位。', question: '這個方案的這一步由哪個單位受理？要先預約嗎？' },
  { id: 'consent', label: '簽名或委託有困難', pattern: /簽|同意|委任|委託|保證人/, action: '先核對原文對本人簽署與委託的限制。無法取得簽名或委託文件時，向窗口確認可行處理方式，不先代簽。', question: '這一步無法取得需要的簽名或委託文件，可以怎麼處理？哪些部分必須由本人辦理？' },
  { id: 'payment', label: '繳費或費用有困難', pattern: /繳費|付款|費用|墊付/, action: '先從方案來源確認費用、期限與繳費方式。無法負擔或付款失敗時，向窗口詢問可行處理方式與證明要求。', question: '這一步繳費有困難，有哪些可行處理方式？需要提供什麼資料？' },
  { id: 'deadline', label: '擔心來不及辦', pattern: /期限|截止|補件|限期/, action: '先核對方案期限及你收到的通知日期。若可能逾期，儘早向窗口說明目前進度，確認是否能補件或有其他處理方式。', question: '這一步可能來不及完成，期限怎麼計算？是否能補件或有其他處理方式？' },
  { id: 'status', label: '等不到通知或查不到進度', pattern: /審查|審核|通知|等待|核定|撥款/, action: '先找出送件日期與收件證明，從方案提供的查詢入口查看；沒有入口或查不到時，向窗口確認是否收到資料、是否需要補件。', question: '請問申請是否已收到？目前進度及是否需要補件，要從哪裡確認？' },
  { id: 'understand', label: '看不懂這一步／其他困難', pattern: /./, action: '對照頁首的步驟原文，先確認這一步要完成的事情。把不清楚的地方或其他困難帶給窗口，請對方說明下一個具體動作。', question: '這一步應先做什麼、準備什麼？我遇到困難，能否說明可以怎麼處理？' },
] as const;
export type StepProblem = typeof problems[number];
export type StepProblemId = StepProblem['id'];

export function buildStepHelp(item: Subsidy, step: string) {
  const route = buildRoute(item); // 不以個人答案排除有條件或地方文件。
  const index = route.steps.indexOf(step);
  if (index < 0 && (step !== '' || route.steps.length > 0)) return null; // 舊步驟或跨方案文字不可沿用。
  const suggested = problems.filter(p => p.id !== 'understand' && p.pattern.test(step)).slice(0, 4);
  if (!suggested.length) suggested.push(problems[problems.length - 1]!);
  const intro = index < 0 ? plainLanguageFor(item) : null;
  const guide = stepGuideFor(item, step) ?? (intro ? { step: '', title: '先從這裡開始確認', actions: [intro.firstStep, '目前收錄資料未列出完整流程。聯絡時先說明方案名稱，記下對方確認的第一個動作、需要的文件與受理時間。'], documentNames: [], linkKind: 'program' as const } : null);
  const documents = [...route.documents, ...route.pendingDocuments, ...route.otherDocuments].filter(doc => guide?.documentNames.includes(doc.name));
  const primaryLink = guide?.linkKind ? route.links.find(link => link.kind === guide.linkKind) ?? route.links.find(link => link.kind === 'program') : undefined;
  const others = problems.filter(p => !suggested.some(s => s.id === p.id));
  return {
    guide, documents, primaryLink,
    itemId: item.id, name: item.name, step, stepNumber: index + 1, route, suggested, others,
    process: text(item.application?.process_text),
    eligibility: text(item.eligibility?.raw_summary),
    askText: (problem: StepProblem) => index < 0 ? `您好，我想了解「${item.name}」，目前找不到完整辦理流程。請問第一步應先做什麼、準備什麼，以及由哪個窗口受理？` : `您好，我想詢問「${item.name}」的第 ${index + 1} 步「${step}」。${problem.question}`,
  };
}
