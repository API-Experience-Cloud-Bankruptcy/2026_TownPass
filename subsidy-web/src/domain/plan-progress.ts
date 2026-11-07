// 單張行動單的進度：步驟與文件分開計算，只讀本人行動單已保存的勾選。

import { mergeDocuments } from './documents';
import { buildRoute } from './route';
import type { Answers, Subsidy } from './types';

export type PlanStatus = 'todo' | 'doing' | 'done' | 'no-steps';

export interface PlanProgress {
  steps: string[];
  /** 已完成的步驟索引（只含仍存在的步驟） */
  done: Set<number>;
  doneCount: number;
  total: number;
  /** 下一個未完成步驟；全部完成為 -1 */
  current: number;
  docsDone: number;
  docsTotal: number;
  status: PlanStatus;
  deadline: string;
  applicationStatus: string;
}

export function planProgress(
  item: Subsidy,
  answers: Answers,
  stepDone: Record<string, number[]>,
  docChecks: Record<string, boolean>,
): PlanProgress {
  const route = buildRoute(item, answers);
  const total = route.steps.length;
  const done = new Set((stepDone[item.id] ?? []).filter((n) => n < total));
  let current = -1;
  for (let i = 0; i < total; i += 1) if (!done.has(i)) { current = i; break; }
  const docs = mergeDocuments([item], answers).documents;
  const status: PlanStatus = total === 0 ? 'no-steps' : done.size === 0 ? 'todo' : current === -1 ? 'done' : 'doing';
  return {
    steps: route.steps,
    done,
    doneCount: done.size,
    total,
    current,
    docsDone: docs.filter((d) => docChecks[d.key]).length,
    docsTotal: docs.length,
    status,
    deadline: route.deadline,
    applicationStatus: route.applicationStatus,
  };
}

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  todo: '還沒開始',
  doing: '進行中',
  done: '步驟完成',
  'no-steps': '待問窗口',
};

/** 列表排序：進行中、還沒開始、待問窗口在前，已完成沉到最後；同組維持加入順序。 */
const ORDER: Record<PlanStatus, number> = { doing: 0, todo: 1, 'no-steps': 2, done: 3 };
export function sortPlans<T extends { progress: PlanProgress }>(rows: T[]): T[] {
  return rows.map((row, i) => ({ row, i }))
    .sort((a, b) => ORDER[a.row.progress.status] - ORDER[b.row.progress.status] || a.i - b.i)
    .map(({ row }) => row);
}
