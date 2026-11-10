// 真实 DSH 栈里的验收：工具真的注册进去了、她真能调、当前穿着真进了模型请求。
// 不是模拟 ctx 手动 emit——用的是本机安装的 AgentLoop / SystemPrompt / ToolRuntime。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import { SessionStore } from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { LlmRuntime, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import wardrobe from '../src/index.js';
import { WardrobeStore } from '../src/store.js';

test('真实宿主：六个工具注册可用，穿衣生效并进入模型请求', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-dsh-'));
  const seed = new WardrobeStore(dataDir);
  const worn = seed.create({ title: '冰蓝麻花裙', type: '针织连衣裙', body: '颈、腰、腿', description: '清冷柔和，高领，贴腰臀。', prompt: 'icy blue knit dress' });
  seed.create({ title: '卡其风衣', type: '外套', body: '肩' });
  seed.wear(worn.id);
  seed.close();

  const ctx = new Context();
  const fibers = [];
  const handles = [];
  const requests = [];
  let host;
  class Adapter extends LlmAdapter {
    providerInfo() { return { id: 'test', name: 'Local synthetic adapter' }; }
    async *stream(options) {
      requests.push(options);
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'synthetic reply' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'synthetic reply' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  try {
    for (const plugin of [SessionStore, SessionProjections, LlmRuntime, SystemPrompt, ToolRuntime, AgentRegistry]) fibers.push(await ctx.plugin(plugin));
    fibers.push(await ctx.plugin(AgentLoop, { agents: [] }));
    // 宿主里真实存在的 webServer，这里给个最小替身（本测试不验 HTTP）
    fibers.push(await ctx.plugin({ name: 'fake-web-server', apply(c) { c.provide('webServer', { register: () => () => {} }); } }));
    fibers.push(await ctx.plugin({
      name: 'test-route',
      inject: ['llm', 'agents', 'systemPrompt'],
      apply(c) { host = c; c.llm.registerAdapter(['test'], new Adapter()); c.systemPrompt.section({ name: 'base', order: 0, text: 'BASE_PERSONA_UNCHANGED' }); },
    }));
    fibers.push(await ctx.plugin({ name: 'dsh-wardrobe-under-test', inject: wardrobe.inject, apply: (c) => wardrobe.apply(c, { dataDir }) }));

    const handle = await host.agents.create({ sessionId: 'wardrobe-session', meta: { cwd: process.cwd() }, agentOptions: { provider: 'test', model: 'synthetic' } });
    handles.push(handle);
    const agent = handle.agent;

    // 1) 工具真的在 schema 里
    const names = ctx.get('tools').schemas(agent).map((t) => t.name);
    for (const expected of ['wardrobe_list_all', 'wardrobe_list_type', 'wardrobe_list_body', 'wardrobe_get_cloth', 'wardrobe_wear', 'wardrobe_unwear']) {
      assert.ok(names.includes(expected), `${expected} 没进她的工具表：${names.join(',')}`);
    }

    // 2) 她真能调，返回 id+标题
    const listed = await ctx.get('tools').execute({
      agent, name: 'wardrobe_list_all', arguments: {}, callId: 'call-1', signal: new AbortController().signal,
    });
    const text = JSON.stringify(listed);
    assert.match(text, /冰蓝麻花裙/);
    assert.match(text, /卡其风衣/);

    // 3) 她真能把衣服穿上（写工具走同一条 ToolRuntime）
    const peek = new WardrobeStore(dataDir);
    const coatId = peek.list().find((i) => i.title === '卡其风衣').id;
    peek.close();
    const wore = await ctx.get('tools').execute({
      agent, name: 'wardrobe_wear', arguments: { id: coatId }, callId: 'call-2', signal: new AbortController().signal,
    });
    assert.match(JSON.stringify(wore), /穿上了：卡其风衣/, '穿衣工具没生效');

    // 4) 当前穿着进了真实模型请求
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '今天穿什么好' }] }));
    await agent.whenIdle();
    assert.ok(requests.length, '模型没被调用');
    const sent = JSON.stringify(requests.at(-1));
    assert.match(sent, /【现在穿着】/, '穿着没进上下文');
    assert.match(sent, /冰蓝麻花裙/);
    assert.match(sent, /清冷柔和/, '描述应当跟着穿着一起进');
    assert.doesNotMatch(sent, /icy blue knit dress/, '绘图提示词不该进聊天上下文');
    assert.match(sent, /卡其风衣/, '刚穿上的外套也要进上下文');
    assert.match(sent, /BASE_PERSONA_UNCHANGED/, '原系统提示不能被顶掉');

    // 5) 脱下之后下一轮就不带了
    const store = new WardrobeStore(dataDir);
    store.unwear(worn.id);
    store.unwear(coatId);   // 第 3 步穿上的外套也得脱掉，否则快照当然还带着它
    store.close();
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '那这件呢' }] }));
    await agent.whenIdle();
    // 历史里那份旧快照还在（它是真实发生过的消息），但最新那份必须已经被置空：
    // 宿主会写一条 "Current runtime context: none. Earlier snapshots no longer apply."
    const latest = requests.at(-1).messages.filter((m) => m.source?.kind === 'runtime-context').at(-1);
    const latestText = JSON.stringify(latest);
    assert.doesNotMatch(latestText, /【现在穿着】/, '脱了之后最新快照还带着衣服');
    assert.match(latestText, /no longer apply|none/i, '最新快照应当明确作废旧内容');
  } finally {
    for (const h of handles.reverse()) await h.dispose();
    for (const f of fibers.reverse()) await f.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
