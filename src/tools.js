// 她查衣柜的四个只读工具。列表只回 id + 标题（省上下文），细节走 get_cloth。
// 注意：这里是给模型看的契约——工具描述就是她的行为准则，写清楚什么时候用、能得到什么。
import { requireValue } from './store.js';

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', required: true },
      meta: { type: 'json' },
    },
  },
  render: (args, value) => [{ type: 'text', text: value.text }],
};

const pageParam = { type: 'number', description: '页码，从 1 开始，每页 10 件；不传就是第 1 页' };

function renderPage(result, label, emptyText) {
  if (!result.total) return { text: emptyText ?? `没有${label}的衣服。`, meta: result };
  const lines = result.items.map((item, index) => `${(result.page - 1) * result.pageSize + index + 1}. ${item.title}（id: ${item.id}）`);
  const more = result.page < result.pages ? `\n还有 ${result.pages - result.page} 页，要看得传 page=${result.page + 1}。` : '';
  return {
    text: `衣柜里${label}共 ${result.total} 件，第 ${result.page}/${result.pages} 页：\n${lines.join('\n')}${more}\n（这里只有标题和 id；要看某一件的描述和绘图提示词，用 wardrobe_get_cloth 传 id。）`,
    meta: result,
  };
}

export function toolSpecs(store) {
  return [
    {
      name: 'wardrobe_list_all',
      description: '看衣柜里所有衣服的标题（分页，每页 10 件）。想知道自己都有什么衣服时用。只返回 id 和标题，具体描述用 wardrobe_get_cloth。',
      parameters: { page: pageParam },
      output: OUTPUT,
      execute: async ({ page }) => renderPage(store.page({ page }), '', '衣柜还是空的，一件衣服都没有。'),
    },
    {
      name: 'wardrobe_list_type',
      description: '按关键词搜衣服的标题（分页，每页 10 件）。模糊匹配标题、种类和标签，所以种类词、颜色词、款式词、风格词都能搜：「针织」「连衣裙」「冰蓝」「睡衣」「甜美风」都行。多个词用空格隔开表示都要命中，比如「冰蓝 针织」。只返回 id 和标题，细节用 wardrobe_get_cloth。',
      parameters: {
        query: { type: 'string', description: '搜索词，比如「针织」「连衣裙」「冰蓝」；多个词用空格分隔表示同时满足' },
        page: pageParam,
      },
      output: OUTPUT,
      execute: async ({ query, page }) => {
        requireValue(String(query ?? '').trim(), 'type_required');
        return renderPage(store.page({ query, page }), `搜「${String(query).trim()}」`, `没搜到含「${String(query).trim()}」的衣服。换个词试试，或者用 wardrobe_list_all 看全部。`);
      },
    },
    {
      name: 'wardrobe_list_body',
      description: '按身体部位看衣服的标题（分页，每页 10 件）。标准部位词：头、颈、肩、胸、背、腹、腰、臀、大腿、膝、小腿、脚、手臂、手；一件衣服可以标多个部位，命中任意一个就会被列出来（「腿」按大腿算）。只返回 id 和标题。',
      parameters: {
        body: { type: 'string', description: '身体部位，比如「腰」「腿」' },
        page: pageParam,
      },
      output: OUTPUT,
      execute: async ({ body, page }) => {
        requireValue(String(body ?? '').trim(), 'body_required');
        return renderPage(store.page({ body, page }), `部位「${String(body).trim()}」`, `没有标在「${String(body).trim()}」这个部位上的衣服。`);
      },
    },
    {
      name: 'wardrobe_get_cloth',
      description: '看某一件衣服的完整资料：标题、种类、部位、给 AI 的描述、给绘图的提示词。id 从 list 类工具拿。这是只读的资料，不会改变衣柜。',
      parameters: { id: { type: 'string', description: '衣服 id（来自 wardrobe_list_all / list_type / list_body）' } },
      output: OUTPUT,
      execute: async ({ id }) => {
        const item = store.get(id);
        requireValue(item, 'item_not_found');
        const lines = [
          `标题：${item.title}`,
          item.type ? `种类：${item.type}` : null,
          item.body ? `部位：${item.body}` : null,
          item.tags ? `标签：${item.tags}` : null,
          item.description ? `描述：${item.description}` : '描述：（还没写）',
          item.prompt ? `绘图提示词：${item.prompt}` : '绘图提示词：（还没写）',
          item.image ? '有配图。' : '没有配图。',
        ].filter(Boolean);
        return { text: lines.join('\n'), meta: { id: item.id, title: item.title, type: item.type, body: item.body, hasImage: Boolean(item.image) } };
      },
    },
  ];
}

/** 按宿主安装根解析 defineTool（link 装的插件解析不到宿主的依赖树）。 */
export async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    if (typeof mod?.defineTool === 'function') return mod.defineTool;
  } catch {}
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const roots = [];
  try { roots.push(path.resolve(path.dirname(fs.realpathSync(process.argv[1] ?? '')), '..')); } catch {}
  if (process.env.DSH_ROOT) roots.push(process.env.DSH_ROOT);
  roots.push(path.join(process.env.HOME ?? '', '.local/lib/node_modules/@deepseek-ai/dsh'));
  for (const root of roots) {
    try {
      const require = createRequire(path.join(root, 'noop.js'));
      const mod = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
      if (typeof mod?.defineTool === 'function') return mod.defineTool;
    } catch {}
  }
  throw new Error('找不到 @deepseek-ai/dsh-tools 的 defineTool（可设 DSH_ROOT）');
}
