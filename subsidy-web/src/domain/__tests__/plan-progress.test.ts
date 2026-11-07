import { describe, expect, it } from 'vitest';
import { planProgress, sortPlans } from '../plan-progress';
import { makeSubsidy } from './fixtures';

const item = makeSubsidy({ id: 'a' });

describe('單張行動單進度', () => {
  it('每張行動單各自的步驟與下一步', () => {
    expect(planProgress(item, {}, {}, {})).toMatchObject({ total: 3, doneCount: 0, current: 0, status: 'todo' });
    expect(planProgress(item, {}, { a: [0] }, {})).toMatchObject({ doneCount: 1, current: 1, status: 'doing' });
    expect(planProgress(item, {}, { a: [0, 2] }, {})).toMatchObject({ doneCount: 2, current: 1, status: 'doing' });
    expect(planProgress(item, {}, { a: [0, 1, 2] }, {})).toMatchObject({ current: -1, status: 'done' });
  });
  it('資料換版後步驟變少，超出的舊進度不計入', () => {
    expect(planProgress(item, {}, { a: [0, 7] }, {}).doneCount).toBe(1);
  });
  it('原文沒有步驟時標示待問窗口', () => {
    const none = makeSubsidy({ id: 'b', application: { process_text: '' } });
    expect(planProgress(none, {}, {}, {}).status).toBe('no-steps');
  });
  it('列表把進行中排前、完成的沉底，同組保持加入順序', () => {
    const rows = [
      { id: 'done', progress: planProgress(item, {}, { a: [0, 1, 2] }, {}) },
      { id: 'todo1', progress: planProgress(item, {}, {}, {}) },
      { id: 'doing', progress: planProgress(item, {}, { a: [1] }, {}) },
      { id: 'todo2', progress: planProgress(item, {}, {}, {}) },
    ];
    expect(sortPlans(rows).map(r => r.id)).toEqual(['doing', 'todo1', 'todo2', 'done']);
  });
});
