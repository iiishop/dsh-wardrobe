import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WardrobeStore } from '../src/store.js';
import { installApi } from '../src/api.js';

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-'));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function harness({ rejection = undefined, connection = true } = {}) {
  const store = new WardrobeStore(tmpdir());
  const routes = new Map();
  const ctx = {
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
    get: (name) => (name === 'connection' ? (connection ? { requestRejection: () => rejection } : undefined) : undefined),
  };
  installApi(ctx, { store, pluginVersion: '0.1.0-test' });
  const call = async (routePath, { method = 'GET', body, query = '', headers = { host: '127.0.0.1:3080' } } = {}) => {
    const handler = routes.get(routePath);
    assert.ok(handler, `route ${routePath} 未注册`);
    const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))];
    const req = {
      method, headers, url: routePath + query,
      on(event, fn) {
        if (event === 'data') for (const c of chunks) fn(c);
        if (event === 'end') fn();
        return req;
      },
      destroy() {},
    };
    const out = { status: 0, headers: {}, json: null, raw: null };
    const res = {
      writeHead(status, h) { out.status = status; out.headers = h || {}; },
      end(payload) {
        if (payload === undefined) { out.raw = Buffer.alloc(0); return; }
        const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
        if (String(out.headers['Content-Type'] ?? '').includes('json')) out.json = JSON.parse(buf.toString('utf8'));
        out.raw = buf;
      },
    };
    await handler(req, res);
    return out;
  };
  return { store, call };
}

test('一件衣服就是四个字段：标题、给 AI 的描述、绘图提示词、图', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    const item = store.create({ title: '米白针织开衫', description: '落肩，袖口卷一圈。', prompt: 'cream knit cardigan, soft light' });
    assert.equal(item.title, '米白针织开衫');
    assert.equal(item.description, '落肩，袖口卷一圈。');
    assert.equal(item.prompt, 'cream knit cardigan, soft light');
    assert.equal(item.image, '');
    assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'description', 'id', 'image', 'prompt', 'title', 'updatedAt']);
    assert.equal(store.list().length, 1);
  } finally { store.close(); }
});

test('标题必填，太长会拒；改一条只动给到的字段', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    assert.throws(() => store.create({ title: '   ' }), /title_required/);
    assert.throws(() => store.create({ title: 'x'.repeat(121) }), /title_too_long/);
    const item = store.create({ title: '风衣', description: '卡其色', prompt: 'trench coat' });
    const updated = store.update(item.id, { title: '卡其风衣' });
    assert.equal(updated.title, '卡其风衣');
    assert.equal(updated.description, '卡其色', '没给的字段不能被清空');
    assert.equal(updated.prompt, 'trench coat');
    assert.throws(() => store.update('no-such-id', { title: 'x' }), /item_not_found/);
    assert.deepEqual(store.remove(item.id).title, '卡其风衣');
    assert.equal(store.list().length, 0);
  } finally { store.close(); }
});

test('图片按魔数定扩展名，路径名不许带目录', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    const name = store.saveImage(PNG);
    assert.match(name, /^[a-z0-9]{24}\.png$/);
    assert.ok(fs.existsSync(path.join(store.imagesDir(), name)));
    assert.throws(() => store.saveImage(Buffer.from('not an image')), /unsupported_image_type/);
    assert.throws(() => store.saveImage(Buffer.alloc(0)), /empty_image/);
    assert.throws(() => store.imagePath('../../etc/passwd'), /invalid_image_name/);
    assert.throws(() => store.create({ title: 'x', image: '../evil.png' }), /invalid_image_name/);
    assert.equal(store.create({ title: 'y', image: name }).image, name);
  } finally { store.close(); }
});

test('接口：没登录读不到，登录了能增改删', async () => {
  const noService = harness({ connection: false });
  assert.equal((await noService.call('/dsh-wardrobe/api')).json.code, 'AUTH_UNAVAILABLE');
  noService.store.close();
  const denied = harness({ rejection: 401 });
  const deniedOut = await denied.call('/dsh-wardrobe/api');
  assert.equal(deniedOut.status, 401);
  assert.equal(deniedOut.json.code, 'AUTH_REQUIRED');
  assert.ok(deniedOut.json.hint);
  denied.store.close();

  const { store, call } = harness();
  try {
    const empty = await call('/dsh-wardrobe/api');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json.items, []);
    assert.equal(empty.json.pluginVersion, '0.1.0-test');

    const created = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'create', title: '白衬衫', description: '棉的', prompt: 'white shirt' } });
    assert.equal(created.status, 200);
    assert.equal(created.json.item.title, '白衬衫');

    const id = created.json.item.id;
    const renamed = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'update', id, title: '薄白衬衫' } });
    assert.equal(renamed.json.item.title, '薄白衬衫');
    assert.equal(renamed.json.item.description, '棉的');

    const bad = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'create', title: '' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'TITLE_REQUIRED');
    assert.ok(bad.json.hint);

    const unknown = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'promote' } });
    assert.equal(unknown.json.code, 'UNKNOWN_ACTION');
    assert.equal((await call('/dsh-wardrobe/api', { method: 'PUT' })).status, 405);

    const removed = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'delete', id } });
    assert.equal(removed.status, 200);
    assert.equal(removed.json.removed.title, '薄白衬衫');
    assert.equal((await call('/dsh-wardrobe/api')).json.items.length, 0);
  } finally { store.close(); }
});

test('接口：传图拿文件名，再按名字取回原字节', async () => {
  const { store, call } = harness();
  try {
    const upload = await call('/dsh-wardrobe/image', { method: 'POST', body: PNG });
    assert.equal(upload.status, 200);
    assert.match(upload.json.image, /\.png$/);
    const fetched = await call('/dsh-wardrobe/image', { query: `?name=${upload.json.image}` });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers['Content-Type'], 'image/png');
    assert.deepEqual(fetched.raw, PNG);
    const missing = await call('/dsh-wardrobe/image', { query: '?name=aaaaaaaaaaaaaaaaaaaaaaaa.png' });
    assert.equal(missing.status, 404);
    const traversal = await call('/dsh-wardrobe/image', { query: '?name=../wardrobe.sqlite' });
    assert.equal(traversal.status, 400);
    assert.equal(traversal.json.code, 'INVALID_IMAGE_NAME');
    const junk = await call('/dsh-wardrobe/image', { method: 'POST', body: Buffer.from('plain text') });
    assert.equal(junk.json.code, 'UNSUPPORTED_IMAGE_TYPE');
    assert.ok(junk.json.hint);
  } finally { store.close(); }
});
