// 行動單保存只傳資源與準備進度；不傳聊天原句、資格答案或填表個資。
import { reactive } from 'vue';
import { apiBase, type FetchLike } from './catalog';
import type { SessionState } from './session';
import type { Account } from '../townpass/types';
import { mergeDocuments } from './documents';
import type { Subsidy } from './types';

export type SavedPlan = Pick<SessionState, 'v' | 'target' | 'planIds' | 'docChecks' | 'stepDone' | 'catalogVersion'> & {
  rulesVersion: string | null;
  engineVersion: string | null;
};
export interface PlanResponse { mode: 'demo'; profile: Account; plan: SavedPlan | null; revision: number }

function fingerprint(plan: SavedPlan): string {
  const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => a.localeCompare(b);
  return JSON.stringify([plan.v, plan.target, plan.planIds, Object.entries(plan.docChecks).sort(byKey),
    Object.entries(plan.stepDone).sort(byKey), plan.catalogVersion, plan.rulesVersion, plan.engineVersion]);
}

export function savedPlan(session: SessionState, items?: Subsidy[]): SavedPlan {
  const selected = items?.filter(item => session.planIds.includes(item.id));
  const documents = selected ? mergeDocuments(selected) : null;
  const keys = documents ? new Set([...documents.documents, ...documents.otherRegion].map(d => d.key)) : null;
  return JSON.parse(JSON.stringify({
    v: 1, target: session.target, planIds: session.planIds,
    docChecks: Object.fromEntries(Object.entries(session.docChecks).filter(([key, checked]) => checked && (!keys || keys.has(key)))),
    stepDone: Object.fromEntries(Object.entries(session.stepDone).filter(([id]) => session.planIds.includes(id))), catalogVersion: session.catalogVersion,
    rulesVersion: session.rulesVersion ?? null, engineVersion: session.engineVersion ?? null,
  })) as SavedPlan;
}

export class PlanError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 409 ? '另一個視窗已更新行動單，請先載入最新版本。' : '行動單尚未存入資料庫，請檢查連線後重試。');
    this.status = status;
  }
}

function validPlan(value: unknown): value is SavedPlan {
  if (!value || typeof value !== 'object') return false;
  const p = value as SavedPlan;
  return p.v === 1 && [null, 'self', 'other'].includes(p.target)
    && Array.isArray(p.planIds) && p.planIds.every(id => typeof id === 'string')
    && !!p.docChecks && typeof p.docChecks === 'object' && !Array.isArray(p.docChecks)
    && Object.values(p.docChecks).every(v => typeof v === 'boolean')
    && !!p.stepDone && typeof p.stepDone === 'object' && !Array.isArray(p.stepDone)
    && Object.values(p.stepDone).every(v => Array.isArray(v) && v.every(n => Number.isInteger(n) && n >= 0))
    && [p.catalogVersion, p.rulesVersion, p.engineVersion].every(v => v === null || typeof v === 'string');
}

export class PlanApi {
  private fetcher: FetchLike;
  constructor(fetcher: FetchLike = globalThis.fetch?.bind(globalThis)) { this.fetcher = fetcher; }
  private async request(init: RequestInit = {}): Promise<PlanResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await this.fetcher(`${apiBase()}/api/action-plan`, { ...init, cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new PlanError(res.status);
      const value = await res.json() as PlanResponse;
      if (value?.mode !== 'demo' || !Number.isSafeInteger(value.revision) || value.revision < 0
        || typeof value.profile?.id !== 'string' || typeof value.profile.realName !== 'string'
        || !(value.plan === null || validPlan(value.plan))) throw new PlanError(502);
      return value;
    } catch (error) {
      throw error instanceof PlanError ? error : new PlanError(0);
    } finally { clearTimeout(timer); }
  }
  read(): Promise<PlanResponse> { return this.request(); }
  write(plan: SavedPlan, revision: number): Promise<PlanResponse> {
    return this.request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, revision }), keepalive: true });
  }
}

/** 一次只送一份，寫入中發生的修改接著送，舊回覆不覆寫新畫面。 */
export class ActionPlanSync {
  readonly state = reactive({ phase: 'loading' as 'loading' | 'saved' | 'saving' | 'error' | 'conflict', error: '', profile: null as Account | null });
  private revision: number | null = null;
  private lastSaved = '';
  private writing: Promise<void> | null = null;
  private loading: Promise<void> | null = null;
  private muted = false;
  private changedBeforeLoad = false;

  private current: () => SavedPlan;
  private apply: (plan: SavedPlan) => void;
  private api: PlanApi;
  constructor(current: () => SavedPlan, apply: (plan: SavedPlan) => void, api = new PlanApi()) {
    this.current = current; this.apply = apply; this.api = api;
  }

  load(discardLocal = false): Promise<void> {
    if (this.loading) return this.loading;
    if (this.writing) return this.writing.then(() => this.load(discardLocal));
    const initial = fingerprint(this.current());
    this.state.phase = 'loading'; this.state.error = '';
    this.loading = (async () => {
      try {
        const response = await this.api.read();
        this.revision = response.revision;
        this.state.profile = response.profile;
        if ((this.changedBeforeLoad || fingerprint(this.current()) !== initial) && response.plan && !discardLocal) {
          this.state.phase = 'conflict';
          this.state.error = '連線恢復了，資料庫已有行動單。請先載入最新版本，避免覆蓋已保存的項目。';
          return;
        }
        this.muted = true;
        try { if (response.plan) this.apply(response.plan); } finally { this.muted = false; }
        // apply 可能因資料換版移除舊資源／進度；這份遷移也必須保存。
        this.lastSaved = response.plan ? fingerprint(response.plan) : '';
        this.state.phase = 'saved';
        this.changedBeforeLoad = false;
      } catch (error) { this.fail(error); }
      finally { this.loading = null; }
    })();
    return this.loading.then(() => this.state.phase === 'saved' ? this.flush() : undefined);
  }

  changed(): void {
    if (this.muted) return;
    if (this.revision === null && this.state.phase === 'error') this.changedBeforeLoad = true;
    if (this.revision === null || this.state.phase === 'loading' || this.state.phase === 'conflict' || this.state.phase === 'error') return;
    void this.flush();
  }

  async retry(): Promise<void> {
    if (this.revision === null) return this.load();
    this.state.phase = 'saved'; this.state.error = '';
    return this.flush();
  }

  flush(): Promise<void> {
    if (this.writing) return this.writing;
    if (this.revision === null || this.state.phase === 'error' || this.state.phase === 'conflict') return Promise.resolve();
    this.writing = (async () => {
      while (this.revision !== null) {
        const plan = this.current();
        const signature = fingerprint(plan);
        if (signature === this.lastSaved) { this.state.phase = 'saved'; break; }
        this.state.phase = 'saving';
        try {
          const response = await this.api.write(plan, this.revision);
          this.revision = response.revision;
          this.lastSaved = signature;
        } catch (error) { this.fail(error); break; }
      }
    })().finally(() => { this.writing = null; });
    return this.writing;
  }

  private fail(error: unknown): void {
    this.state.phase = error instanceof PlanError && error.status === 409 ? 'conflict' : 'error';
    this.state.error = error instanceof Error ? error.message : new PlanError(0).message;
  }
}
