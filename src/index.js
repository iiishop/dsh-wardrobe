import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WardrobeStore } from './store.js';
import { installApi } from './api.js';
import { toolSpecs, loadDefineTool } from './tools.js';
import { syncGarment } from './garment-sync.js';

export const name = 'dsh-wardrobe';
// webServer = 设置页与图片；tools = 她查衣柜的四个只读工具。
export const inject = ['webServer', 'tools'];

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * 「现在穿着」进上下文：每 agent 一个动态 context，读的是当场那件。
 * 只放标题 + 种类 + 给 AI 的描述——绘图提示词不进，那是生图时才需要的。
 */
function installWornContext(ctx, store, onIssue) {
  const entries = new Map();
  const register = (agent) => {
    if (entries.has(agent)) return;
    const systemPrompt = agent.ctx.get('systemPrompt');
    if (!systemPrompt?.context) return;
    entries.set(agent, systemPrompt.context({
      name: 'dsh-wardrobe-worn',
      order: 81,
      interpolate: false,
      text: () => {
        try {
          const worn = store.worn();
          if (!worn.length) return '';
          const lines = worn.map(({ item, parts }) => `- 穿在${parts.join('、')}：${item.title}${item.type ? `（${item.type}）` : ''}${item.description ? `\n  ${item.description}` : ''}`);
          return `【现在穿着】衣柜里她此刻穿在身上的（按身体部位）：\n${lines.join('\n')}`;
        } catch (error) { onIssue({ code: 'WORN_CONTEXT_FAILED', detail: String(error?.message ?? error) }); return ''; }
      },
    }));
  };
  const offCreated = ctx.on('agent/created', ({ agent }) => { try { register(agent); } catch (error) { onIssue({ code: 'WORN_CONTEXT_FAILED', detail: String(error?.message ?? error) }); } });
  const offDisposed = ctx.on('agent/disposed', ({ agent }) => { entries.get(agent)?.(); entries.delete(agent); });
  return () => { offCreated(); offDisposed(); for (const dispose of entries.values()) { try { dispose?.(); } catch {} } entries.clear(); };
}

export const apply = async (ctx, config = {}) => {
  const dshHome = config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const dataDir = config.dataDir || path.join(dshHome, 'wardrobe');
  const store = new WardrobeStore(dataDir);
  const issues = [];
  const onIssue = (issue) => { issues.push({ at: new Date().toISOString(), ...issue }); if (issues.length > 20) issues.shift(); };

  // 穿着一变就同步到 ComfyUI 的输入槽（替代 her-garment.timer 的日期轮换）。
  const comfyInput = config.comfyInput || path.join(os.homedir(), 'Projects', 'ComfyUI', 'input');
  const sync = (worn) => syncGarment(store, { comfyInput, log: (line) => console.log(`[dsh-wardrobe] ${line}`) });
  const unsubscribe = store.onWornChange(sync);
  // 启动时先对齐一次，避免上次停机期间的变更没落盘。
  sync(store.worn());

  const disposeApi = installApi(ctx, { store, pluginVersion: pkg.version });
  const disposeContext = installWornContext(ctx, store, onIssue);

  const registered = [];
  try {
    const defineTool = await loadDefineTool();
    for (const spec of toolSpecs(store)) registered.push(ctx.tools.register(defineTool(spec)));
    console.log(`[dsh-wardrobe] 已注册 ${registered.length} 个工具`);
  } catch (error) {
    // 工具挂不上不能连累设置页：记一行日志，衣柜照常能看能改。
    console.log(`[dsh-wardrobe] 工具注册失败：${error?.message ?? error}`);
  }

  console.log(`[dsh-wardrobe] 已启用 data=${dataDir} 衣服=${store.count()} 件 当前穿着=${store.worn().map((w) => `${w.item.title}(${w.parts.join('/')})`).join(' + ') || '无'}`);

  return async () => {
    unsubscribe();
    for (const dispose of registered.reverse()) { try { dispose?.(); } catch {} }
    disposeContext();
    await disposeApi();
    store.close();
  };
};

export default { name, inject, apply };
