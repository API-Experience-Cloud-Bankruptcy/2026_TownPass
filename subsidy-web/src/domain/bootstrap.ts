import { ADAPTIVE_VERSION, TEMPLATE_VERSION } from './adaptive';
import { REVIEW_VERSION } from './reviewed-rules';
// 啟動載入：catalog 與題庫都成功後，才一次套用到畫面狀態與工作階段。
// 任一步失敗就拋錯且不改動任何狀態，避免新資料配上舊進度。

import type { SessionState } from './session';
import type { LoadedCatalog, QuestionBank, Subsidy } from './types';

export const ENGINE_VERSION=`${REVIEW_VERSION}/${ADAPTIVE_VERSION}/${TEMPLATE_VERSION}`;
export interface MigrationPatch {
  engineVersion: string;
  answers: SessionState['answers'];
  seenQuestions: string[];
  planIds: string[];
  stepDone: SessionState['stepDone'];
  docChecks: SessionState['docChecks'];
  catalogVersion: string;
  rulesVersion: string;
  /** 給使用者看的說明；沒有變動時為空字串 */
  notice: string;
}

/** 依新資料計算工作階段需要的變更（純函式，不修改輸入）。 */
export function migrateSession(session: SessionState, catalog: { version: string; items: Subsidy[] }): MigrationPatch {
  const ids = new Set(catalog.items.map((i) => i.id));
  const planIds = session.planIds.filter((id) => ids.has(id));
  const removed = session.planIds.length - planIds.length;
  const versionChanged = !!session.catalogVersion && (session.catalogVersion !== catalog.version || session.rulesVersion !== REVIEW_VERSION || session.engineVersion !== ENGINE_VERSION);
  const migratedAnswers={...session.answers};
  if(versionChanged) delete migratedAnswers.extra;
  const notices: string[] = [];
  if (versionChanged) notices.push(`資料版本已更新（${catalog.version}），結果已依新資料重新判斷，準備進度已重設。探索偏好與已看題目也已重設，請重新確認。`);
  if (removed) notices.push(`有 ${removed} 項已不在資料中，已從行動單移除。`);
  return {
    planIds,
    engineVersion:ENGINE_VERSION,
    answers:migratedAnswers,
    seenQuestions:versionChanged?[]:session.seenQuestions,
    // 步驟與文件索引可能已變動，舊進度不可套到新流程。
    stepDone: versionChanged ? {} : session.stepDone,
    docChecks: versionChanged ? {} : session.docChecks,
    catalogVersion: catalog.version,
    rulesVersion: REVIEW_VERSION,
    notice: notices.join(''),
  };
}

export interface BootstrapDeps {
  loadCatalog: () => Promise<LoadedCatalog>;
  loadQuestions: (items: Subsidy[]) => Promise<QuestionBank>;
}

/** 依序載入 catalog 與題庫；兩者都成功才回傳，呼叫端再同步套用。 */
export async function loadAppData(deps: BootstrapDeps): Promise<{ catalog: LoadedCatalog; bank: QuestionBank }> {
  const catalog = await deps.loadCatalog();
  const bank = await deps.loadQuestions(catalog.items);
  return { catalog, bank };
}
