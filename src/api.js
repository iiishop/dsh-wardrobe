import fs from 'node:fs';
import path from 'node:path';
import { requireValue } from './store.js';

const MAX_JSON = 64 * 1024;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function readBody(req, limit, { json = true } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body_too_large'), { code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (!json) return resolve(buffer);
      try { resolve(buffer.length ? JSON.parse(buffer.toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('invalid_json'), { code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

const CODE_HINTS = {
  TITLE_REQUIRED: '标题不能空。',
  TITLE_TOO_LONG: '标题太长了，压到 120 字以内。',
  TYPE_TOO_LONG: '种类名太长了，压到 60 字以内。',
  BODY_TOO_LONG: '部位写太长了，压到 60 字以内。',
  TYPE_REQUIRED: '得说按哪个种类查。',
  BODY_REQUIRED: '得说按哪个部位查。',
  DESCRIPTION_TOO_LONG: 'AI 描述太长了，压到 8000 字以内。',
  PROMPT_TOO_LONG: '绘图提示词太长了，压到 8000 字以内。',
  ITEM_NOT_FOUND: '这件衣服已经不在了，刷新页面再看。',
  INVALID_IMAGE_NAME: '图片名不合法，重新上传一次。',
  EMPTY_IMAGE: '这个文件是空的。',
  IMAGE_TOO_LARGE: '图太大了（超过 12MB）。',
  UNSUPPORTED_IMAGE_TYPE: '只收 PNG / JPG / WEBP / GIF。',
  BODY_TOO_LARGE: '请求体太大。',
  INVALID_JSON: '请求不是有效 JSON。',
  UNKNOWN_ACTION: '不认识的操作，刷新页面再试。',
};

export function installApi(ctx, { store, pluginVersion }) {
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, error) => send(res, status, {
    ok: false, code, error, hint: CODE_HINTS[code] ?? '刷新页面后重试。',
  });
  // DSH 自己的会话鉴权（Host/Origin/登录态）。这里不额外锁回环——局域网入口也要能用。
  const guard = (req, res) => {
    const connection = ctx.get('connection');
    if (!connection?.requestRejection) { fail(res, 503, 'AUTH_UNAVAILABLE', 'DSH 鉴权服务不可用'); return false; }
    const rejection = connection.requestRejection(req);
    if (rejection !== undefined && rejection !== null && rejection !== false) {
      fail(res, typeof rejection === 'number' ? rejection : 403, 'AUTH_REQUIRED', 'DSH 登录已失效');
      return false;
    }
    return true;
  };

  const api = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-wardrobe/api',
    handler: async (req, res) => {
      if (!guard(req, res)) return;
      try {
        if (req.method === 'GET') return send(res, 200, { ok: true, pluginVersion, items: store.list(), wornId: store.wornId() });
        if (req.method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', '只接受 GET / POST');
        const body = await readBody(req, MAX_JSON);
        const id = String(body.id ?? '');
        if (body.action === 'create') return send(res, 200, { ok: true, item: store.create(body) });
        if (body.action === 'update') {
          requireValue(id, 'item_not_found');
          return send(res, 200, { ok: true, item: store.update(id, body) });
        }
        if (body.action === 'wear') {
          requireValue(id, 'item_not_found');
          return send(res, 200, { ok: true, worn: store.wear(id) });
        }
        if (body.action === 'unwear') {
          store.unwear();
          return send(res, 200, { ok: true, worn: null });
        }
        if (body.action === 'delete') {
          requireValue(id, 'item_not_found');
          return send(res, 200, { ok: true, removed: store.remove(id) });
        }
        return fail(res, 400, 'UNKNOWN_ACTION', `不支持的操作：${body.action || '（空）'}`);
      } catch (error) {
        const message = String(error?.message ?? '');
        if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') return fail(res, 400, error.code, message);
        const code = /^[a-z_]+$/.test(message) ? message.toUpperCase() : 'WRITE_FAILED';
        return fail(res, 400, code, `这次操作没有生效：${message.slice(0, 200)}`);
      }
    },
  });

  const image = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-wardrobe/image',
    handler: async (req, res) => {
      if (!guard(req, res)) return;
      try {
        if (req.method === 'POST') {
          const buffer = await readBody(req, 12 * 1024 * 1024, { json: false });
          return send(res, 200, { ok: true, image: store.saveImage(buffer) });
        }
        if (req.method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', '只接受 GET / POST');
        const name = new URL(req.url, 'http://localhost').searchParams.get('name') ?? '';
        const file = store.imagePath(name);
        if (!fs.existsSync(file)) return fail(res, 404, 'ITEM_NOT_FOUND', '这张图不存在');
        const ext = path.extname(file).slice(1).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' });
        res.end(fs.readFileSync(file));
        return undefined;
      } catch (error) {
        const message = String(error?.message ?? '');
        if (error?.code === 'BODY_TOO_LARGE') return fail(res, 413, error.code, message);
        const code = /^[a-z_]+$/.test(message) ? message.toUpperCase() : 'WRITE_FAILED';
        return fail(res, 400, code, `图片没有保存：${message.slice(0, 200)}`);
      }
    },
  });

  return async () => { await api?.(); await image?.(); };
}
