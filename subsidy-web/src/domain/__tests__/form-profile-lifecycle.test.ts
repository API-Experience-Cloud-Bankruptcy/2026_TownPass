import * as Vue from 'vue';
import { createRenderer, defineComponent, h, nextTick, ref, ssrContextKey, type Component } from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from '@vue/compiler-dom';
import { transformWithEsbuild } from 'vite';
import source from '../../components/FormProfileConfirm.vue?raw';
import { describe, expect, it, vi } from 'vitest';
import FormProfileConfirm from '../../components/FormProfileConfirm.vue';
import type { Account } from '../../townpass';
import type { Target } from '../types';

// Vitest 的 node 環境載入 SFC 使用 SSR 編譯；保留真實 setup，以實際模板編譯 client render。
const { descriptor } = parse(source);
const bindings = compileScript(descriptor, { id: 'profile-lifecycle' }).bindings;
const { code } = compile(descriptor.template!.content, { mode: 'function', prefixIdentifiers: true, bindingMetadata: bindings, isTS: true });
const client = await transformWithEsbuild(code, 'profile-render.ts', { loader: 'ts' });
const InteractiveProfile = { ...FormProfileConfirm, render: new Function('Vue', client.code)(Vue) } as unknown as Component;

type Node = { type: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null };
const node = (type: string, text = ''): Node => ({ type, text, props: {}, children: [], parent: null });
const renderer = createRenderer<Node, Node>({
  createElement: (tag) => node(tag), createText: (text) => node('#text', text), createComment: (text) => node('#comment', text),
  setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; n.children = []; },
  parentNode: (n) => n.parent, nextSibling: (n) => n.parent?.children[(n.parent?.children.indexOf(n) ?? -1) + 1] ?? null,
  patchProp: (n, key, _old, value) => { n.props[key] = value; },
  insert(n, parent, anchor = null) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, n); n.parent = parent;
  },
  remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; },
});
const all = (root: Node): Node[] => [root, ...root.children.flatMap(all)];
const text = (root: Node): string => root.text + root.children.map(text).join('');
const flush = async () => { await Promise.resolve(); await nextTick(); };
function setup(loadAccount: () => Promise<Account | null> = async () => null) {
  const root = node('root');
  const target = ref<Target | null>('self');
  const cleared = vi.fn();
  const confirmed = vi.fn();
  const app = renderer.createApp(defineComponent({ setup: () => () => h(InteractiveProfile, { target: target.value, loadAccount, onCleared: cleared, onConfirmed: confirmed }) }));
  app.provide(ssrContextKey, {});
  app.mount(root);
  const find = (predicate: (n: Node) => boolean) => {
    const found = all(root).find(predicate); if (!found) throw new Error('element missing'); return found;
  };
  const button = (label: string) => find((n) => n.type === 'button' && text(n).includes(label));
  const input = (id: string) => find((n) => n.props.id === id);
  const checkbox = () => find((n) => n.type === 'input' && n.props.type === 'checkbox');
  const fire = (n: Node, event: string, value: unknown = {}) => (n.props[event] as (event: unknown) => unknown)(value);
  return { root, target, cleared, confirmed, app, button, input, checkbox, fire };
}
const account = { realName: '王小明', addresses: [] } as unknown as Account;
const pending = () => { let resolve!: (a: Account | null) => void; const promise = new Promise<Account | null>((r) => { resolve = r; }); return { promise, resolve }; };

describe('本人資料互動生命週期', () => {
  it('帶入尚未完成時不能重新確認舊草稿', async () => {
    const wait = pending(); const c = setup(() => wait.promise);
    c.fire(c.input('pf-name'), 'onInput', { target: { value: '原姓名' } });
    c.fire(c.checkbox(), 'onChange', { target: { checked: true } });
    c.fire(c.button('使用已確認'), 'onClick');
    c.confirmed.mockClear();
    const bring = c.fire(c.button('從城市通'), 'onClick'); await nextTick();
    expect(c.button('使用已確認').props.disabled).toBe(true);
    c.fire(c.button('使用已確認'), 'onClick');
    expect(c.confirmed).not.toHaveBeenCalled();
    wait.resolve(account); await bring; await flush();
    expect(c.checkbox().props.checked).toBe(false);
    expect(c.confirmed).not.toHaveBeenCalled();
    c.app.unmount();
  });

  it('編輯、勾選與取消勾選會立即撤銷父層確認', async () => {
    const c = setup();
    c.fire(c.input('pf-name'), 'onInput', { target: { value: '王小明' } });
    await nextTick();
    c.fire(c.checkbox(), 'onChange', { target: { checked: true } });
    c.fire(c.button('使用已確認'), 'onClick');
    expect(c.confirmed).toHaveBeenLastCalledWith({ name: '王小明' });
    c.cleared.mockClear();
    c.fire(c.checkbox(), 'onChange', { target: { checked: false } });
    expect(c.cleared).toHaveBeenCalledTimes(1);
    c.fire(c.checkbox(), 'onChange', { target: { checked: true } });
    expect(c.cleared).toHaveBeenCalledTimes(2);
    c.fire(c.input('pf-name'), 'onInput', { target: { value: '陳小美' } });
    expect(c.cleared).toHaveBeenCalledTimes(3);
    await nextTick();
    expect(c.checkbox().props.checked).toBe(false);
    expect(text(c.root)).toContain('資料已變更');
    c.app.unmount();
  });
  it('換對象清空草稿與勾選，遲到的帶入不能跨換人再回本人套用', async () => {
    const wait = pending(); const c = setup(() => wait.promise);
    c.fire(c.input('pf-name'), 'onInput', { target: { value: '原姓名' } });
    c.fire(c.checkbox(), 'onChange', { target: { checked: true } });
    const bring = c.fire(c.button('從城市通'), 'onClick');
    c.target.value = 'other'; await nextTick();
    c.target.value = 'self'; await nextTick();
    wait.resolve(account); await bring; await flush();
    expect(c.input('pf-name').props.value).toBe('');
    expect(c.checkbox().props.checked).toBe(false);
    expect(c.button('從城市通').props.disabled).toBe(false);
    expect(text(c.root)).toContain('已清除本人資料');
    c.app.unmount();
  });
  it('清除或手動編輯會作廢進行中的帶入，仍可重新帶入', async () => {
    const wait = pending(); const load = vi.fn().mockReturnValueOnce(wait.promise).mockResolvedValue(account);
    const c = setup(load);
    const bring = c.fire(c.button('從城市通'), 'onClick');
    c.fire(c.button('清除這裡'), 'onClick');
    c.fire(c.input('pf-name'), 'onInput', { target: { value: '手動姓名' } });
    wait.resolve(account); await bring; await flush();
    expect(c.input('pf-name').props.value).toBe('手動姓名');
    await c.fire(c.button('從城市通'), 'onClick'); await flush();
    expect(c.input('pf-name').props.value).toBe('王小明');
    expect(c.checkbox().props.checked).toBe(false);
    c.app.unmount();
  });
  it('卸載後的帶入回覆不再發出事件或恢復 UI', async () => {
    const wait = pending(); const c = setup(() => wait.promise);
    const bring = c.fire(c.button('從城市通'), 'onClick');
    c.app.unmount(); c.cleared.mockClear();
    wait.resolve(account); await bring; await flush();
    expect(c.cleared).not.toHaveBeenCalled();
    expect(c.confirmed).not.toHaveBeenCalled();
    expect(c.root.children).toHaveLength(0);
  });
});
