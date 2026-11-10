import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WardrobeStore } from '../src/store.js';
import { installApi } from '../src/api.js';
import { toolSpecs } from '../src/tools.js';

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

test('一件衣服就是四个字段（另有种类与部位供筛选）：标题、给 AI 的描述、绘图提示词、图', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    const item = store.create({ title: '米白针织开衫', description: '落肩，袖口卷一圈。', prompt: 'cream knit cardigan, soft light' });
    assert.equal(item.title, '米白针织开衫');
    assert.equal(item.description, '落肩，袖口卷一圈。');
    assert.equal(item.prompt, 'cream knit cardigan, soft light');
    assert.equal(item.image, '');
    assert.deepEqual(Object.keys(item).sort(), ['body', 'createdAt', 'description', 'id', 'image', 'prompt', 'tags', 'title', 'type', 'updatedAt']);
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


test('分页：每页 10 件，页码超界夹到最后一页', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    for (let i = 1; i <= 12; i += 1) store.create({ title: `衣服${i}`, type: i % 2 ? '外套' : '连衣裙', body: i % 3 ? '腰' : '腿' });
    const first = store.page({});
    assert.equal(first.total, 12);
    assert.equal(first.pages, 2);
    assert.equal(first.items.length, 10);
    assert.deepEqual(Object.keys(first.items[0]).sort(), ['id', 'title'], '列表只回 id 和标题');
    assert.equal(store.page({ page: 2 }).items.length, 2);
    assert.equal(store.page({ page: 99 }).page, 2, '页码越界夹到最后一页');
    assert.equal(store.page({ page: 0 }).page, 1);
  } finally { store.close(); }
});

test('按种类和部位筛；一件标多个部位时命中任意一个都列出', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    store.create({ title: '麻花裙', type: '针织连衣裙', body: '颈,腰,腿' });
    store.create({ title: '风衣', type: '外套', body: '肩' });
    store.create({ title: '长靴', type: '鞋', body: '腿,脚' });
    assert.equal(store.page({ query: '连衣裙' }).total, 1);
    assert.equal(store.page({ query: '外套' }).items[0].title, '风衣');
    assert.equal(store.page({ body: '腿' }).total, 2);
    assert.equal(store.page({ body: '脚' }).items[0].title, '长靴');
    assert.equal(store.page({ body: '腰' }).total, 1);
    assert.equal(store.page({ body: '头发' }).total, 0);
  } finally { store.close(); }
});

test('当前穿着：多件同时穿，按部位能看出来各自盖哪', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    const dress = store.create({ title: '冰蓝连身裙', type: '针织连衣裙', body: '颈、腰、臀、腿' });  // 腿 → 大腿
    const coat = store.create({ title: '卡其外套', type: '外套', body: '肩、手臂' });
    const boots = store.create({ title: '长靴', type: '鞋', body: '小腿、脚' });

    const first = store.wear(dress.id);
    assert.deepEqual(first.parts, ['颈', '腰', '臀', '大腿'], '腿归一成大腿');
    assert.deepEqual(store.wornIds(), [dress.id]);

    store.wear(coat.id); store.wear(boots.id);
    assert.deepEqual(store.wornIds(), [dress.id, coat.id, boots.id], '按穿上的顺序排队');
    assert.deepEqual(store.worn().map((w) => w.item.title), ['冰蓝连身裙', '卡其外套', '长靴']);
    assert.deepEqual(Object.keys(store.wornByBody()).sort(), ['小腿', '手臂', '肩', '脚', '大腿', '臀', '腰', '颈'].sort());

    store.unwear(dress.id);
    assert.deepEqual(store.worn().map((w) => w.item.title), ['卡其外套', '长靴'], '脱裙子不影响别的');
    assert.ok(!Object.values(store.wornByBody()).flat().some((x) => x.id === dress.id));

    store.remove(coat.id);
    assert.ok(!store.worn().some((w) => w.item.id === coat.id), '删掉衣服要顺手脱掉');
    assert.throws(() => store.wear('no-such-id'), /item_not_found/);
  } finally { store.close(); }
});

test('穿另一件只是加一件，不顶掉原来那件；同部位可以挂多件', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    const skirt = store.create({ title: '百褶裙', type: '半身裙', body: '腰、腿' });
    const pants = store.create({ title: '直筒裤', type: '裤子', body: '腰、腿' });
    store.wear(skirt.id);
    store.wear(pants.id);
    assert.equal(store.worn().length, 2, '两件都在身上，谁也不顶掉谁');
    const byBody = store.wornByBody();
    assert.deepEqual(byBody['大腿'].map((x) => x.title), ['百褶裙', '直筒裤'], '同一个部位下可以挂两件');
    assert.deepEqual(byBody['腰'].map((x) => x.title), ['百褶裙', '直筒裤']);

    store.unwear(pants.id);
    assert.deepEqual(store.worn().map((w) => w.item.title), ['百褶裙'], '脱一件只动那一件');
    assert.deepEqual(store.wornByBody()['大腿'].map((x) => x.title), ['百褶裙']);

    // 重复穿同一件不会变成两件
    store.wear(skirt.id);
    store.wear(skirt.id);
    assert.equal(store.worn().length, 1);

    // 没标部位也能穿，只是不会出现在任何部位下
    const bare = store.create({ title: '没标部位的东西' });
    store.wear(bare.id);
    assert.equal(store.worn().length, 2);
    assert.ok(!Object.values(store.wornByBody()).flat().some((x) => x.id === bare.id));
  } finally { store.close(); }
});

test('旧的穿着记录（单 id 或部位表）都迁移成 id 数组', () => {
  const dir = tmpdir();
  const store = new WardrobeStore(dir);
  const dress = store.create({ title: '老格式裙子', type: '连衣裙', body: '腰、腿' });
  const coat = store.create({ title: '老格式外套', type: '外套', body: '肩' });
  store.db.prepare("INSERT OR REPLACE INTO meta VALUES('worn',?)").run(dress.id);
  store.close();
  const second = new WardrobeStore(dir);
  assert.deepEqual(second.wornIds(), [dress.id], '单个 id 字符串要变成数组');
  second.db.prepare("INSERT OR REPLACE INTO meta VALUES('worn',?)").run(JSON.stringify({ 腰: dress.id, 肩: coat.id, 腿: dress.id }));
  second.close();
  const third = new WardrobeStore(dir);
  try {
    assert.deepEqual(third.wornIds(), [dress.id, coat.id], '部位表按 id 去重成数组');
    assert.deepEqual(third.worn().map((w) => w.parts.join('/')), ['腰/大腿', '肩']);
  } finally { third.close(); }
});

test('她用的四个工具：列表只给 id+标题，细节走 get_cloth', async () => {
  const store = new WardrobeStore(tmpdir());
  try {
    const item = store.create({ title: '冰蓝麻花裙', type: '针织连衣裙', body: '颈,腰,腿', description: '清冷柔和', prompt: 'icy blue knit dress', image: '' });
    const specs = Object.fromEntries(toolSpecs(store).map((s) => [s.name, s]));
    assert.deepEqual(Object.keys(specs).sort(), ['wardrobe_get_cloth', 'wardrobe_list_all', 'wardrobe_list_body', 'wardrobe_list_type']);

    const all = await specs.wardrobe_list_all.execute({});
    assert.match(all.text, /冰蓝麻花裙/);
    assert.ok(all.text.includes(item.id), '列表必须带 id，不然她拿不到细节');
    assert.ok(!all.text.includes('清冷柔和'), '列表不该把描述塞进来');

    const byType = await specs.wardrobe_list_type.execute({ query: '连衣裙' });
    assert.match(byType.text, /冰蓝麻花裙/);
    await assert.rejects(() => specs.wardrobe_list_type.execute({ query: '  ' }), /type_required/);

    const byBody = await specs.wardrobe_list_body.execute({ body: '腿' });
    assert.match(byBody.text, /冰蓝麻花裙/);
    await assert.rejects(() => specs.wardrobe_list_body.execute({}), /body_required/);

    const detail = await specs.wardrobe_get_cloth.execute({ id: item.id });
    assert.match(detail.text, /清冷柔和/);
    assert.match(detail.text, /icy blue knit dress/);
    assert.match(detail.text, /针织连衣裙/);
    assert.match(detail.text, /没有配图/);
    await assert.rejects(() => specs.wardrobe_get_cloth.execute({ id: 'nope' }), /item_not_found/);

    // 每个工具都必须有 output（缺了宿主会崩）
    for (const spec of Object.values(specs)) {
      assert.ok(spec.output?.render, `${spec.name} 缺 output`);
      assert.equal(typeof spec.description, 'string');
      assert.ok(spec.description.length > 20, `${spec.name} 描述太短，模型不知道什么时候用`);
    }
  } finally { store.close(); }
});

test('接口：穿上返回占了哪些部位，GET 给完整穿着表', async () => {
  const { store, call } = harness();
  try {
    const created = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'create', title: '灰毛衣', type: '上衣', body: '胸、手臂' } });
    const id = created.json.item.id;
    const worn = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'wear', id } });
    assert.equal(worn.status, 200);
    assert.deepEqual(worn.json.parts, ['胸', '手臂']);
    assert.deepEqual(worn.json.worn, [{ id, title: '灰毛衣', parts: ['胸', '手臂'] }]);

    const list = await call('/dsh-wardrobe/api');
    assert.deepEqual(list.json.worn, [{ id, title: '灰毛衣', parts: ['胸', '手臂'] }]);

    const off = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'unwear', id } });
    assert.deepEqual(off.json.worn, []);
    assert.deepEqual((await call('/dsh-wardrobe/api')).json.worn, []);

    // 再把毛衣穿上，然后加一件没标部位的：两件要同时在身上
    await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'wear', id } });
    const bare = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'create', title: '没部位' } });
    const loose = await call('/dsh-wardrobe/api', { method: 'POST', body: { action: 'wear', id: bare.json.item.id } });
    assert.equal(loose.status, 200, '没标部位也能穿，只是不落在任何部位下');
    assert.deepEqual(loose.json.parts, []);
    assert.equal(loose.json.worn.length, 2, '加一件不顶掉原来那件');
    assert.deepEqual(loose.json.worn.map((w) => w.title), ['灰毛衣', '没部位']);
  } finally { store.close(); }
});


test('种类改成模糊搜索：针织、连衣裙、颜色冰蓝都能搜到，多个词要同时命中', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    store.create({ title: '冰蓝色高领麻花针织毛衣裙', type: '针织连衣裙', body: '颈、腰、腿' });
    store.create({ title: '米白针织开衫', type: '针织上衣', body: '肩' });
    store.create({ title: '卡其风衣', type: '外套', body: '肩' });

    const titles = (q) => store.page({ query: q }).items.map((i) => i.title);
    assert.equal(store.page({ query: '针织' }).total, 2, '针织要能搜出两件');
    assert.deepEqual(titles('连衣裙'), ['冰蓝色高领麻花针织毛衣裙'], '连衣裙只在种类里，也要搜到');
    assert.deepEqual(titles('冰蓝'), ['冰蓝色高领麻花针织毛衣裙'], '颜色在标题里，也要搜到');
    assert.deepEqual(titles('冰蓝 针织'), ['冰蓝色高领麻花针织毛衣裙'], '两个词都命中才算');
    assert.equal(store.page({ query: '冰蓝 风衣' }).total, 0, '两个词分属不同衣服时不能串');
    assert.equal(store.page({ query: '牛仔' }).total, 0);
    assert.equal(store.page({ query: '   ' }).total, 3, '空查询就是全部');
  } finally { store.close(); }
});


test('标签：能存能搜，超长会拒', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    const item = store.create({ title: '冰蓝睡裙', type: '睡裙', body: '胸、腰', tags: '冰蓝色、吊带裙、蕾丝拼接、甜美风、居家服' });
    assert.match(item.tags, /蕾丝拼接/);
    assert.equal(store.page({ query: '甜美风' }).total, 1, '标签词也要能被模糊搜到');
    assert.equal(store.page({ query: '居家' }).total, 1);
    assert.equal(store.page({ query: '冰蓝 蕾丝' }).total, 1, '标题词 + 标签词组合命中也算');
    assert.throws(() => store.create({ title: 'x', tags: 'x'.repeat(601) }), /tags_too_long/);
    const renamed = store.update(item.id, { title: '冰蓝缎面睡裙' });
    assert.equal(renamed.tags, item.tags, '改标题不能把标签清掉');
  } finally { store.close(); }
});


test('部位别名归一：腰部/胸部/大腿上部都落到标准词，腿归到大腿', () => {
  const store = new WardrobeStore(tmpdir());
  try {
    const item = store.create({ title: '测试裙', body: '颈部、胸部、背部、腹部、腰部、臀部、大腿上部、膝部、小腿' });
    assert.equal(item.body, '颈、胸、背、腹、腰、臀、大腿、膝、小腿');
    assert.equal(store.create({ title: '整条腿', body: '腿' }).body, '大腿');
    assert.equal(store.create({ title: '多个', body: '腿,膝盖,脚踝' }).body, '大腿、膝、脚');
    // 表里没有的词原样保留，不拒绝新写法
    assert.equal(store.create({ title: '怪词', body: '头发' }).body, '头发');
    // 查询也用别名：搜「腿」要能命中标成「大腿」的衣服
    assert.equal(store.page({ body: '腿' }).total, 3);
    assert.equal(store.page({ body: '大腿' }).total, 3);
    assert.equal(store.page({ body: '小腿' }).total, 1, '小腿不能被大腿带出来');
  } finally { store.close(); }
});

test('老数据打开时自动归一，且重复打开不会改坏', () => {
  const dir = tmpdir();
  const store = new WardrobeStore(dir);
  const item = store.create({ title: '老写法', body: '腰' });
  store.db.prepare('UPDATE items SET body=? WHERE id=?').run('腰部、大腿上部', item.id);
  store.close();
  const again = new WardrobeStore(dir);
  assert.equal(again.get(item.id).body, '腰、大腿');
  again.close();
  const third = new WardrobeStore(dir);
  try { assert.equal(third.get(item.id).body, '腰、大腿', '再开一次不能被改回去'); } finally { third.close(); }
});
