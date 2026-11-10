import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WardrobeStore } from './store.js';
import { installApi } from './api.js';
import { toolSpecs, loadDefineTool } from './tools.js';

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
          if (!worn) return '';
          return `【现在穿着】${worn.title}${worn.type ? `（${worn.type}）` : ''}${worn.description ? `\n${worn.description}` : ''}`;
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

  console.log(`[dsh-wardrobe] 已启用 data=${dataDir} 衣服=${store.count()} 件 当前穿着=${store.worn()?.title ?? '无'}`);

  return async () => {
    for (const dispose of registered.reverse()) { try { dispose?.(); } catch {} }
    disposeContext();
    await disposeApi();
    store.close();
  };
};

export default { name, inject, apply };
