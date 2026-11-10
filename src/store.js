import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_TITLE = 120;
const MAX_TEXT = 8000;
const MAX_TAG = 60;
const MAX_TAGS = 600;
const PAGE_SIZE = 10;
const IMAGE_NAME = /^[A-Za-z0-9_-]{4,80}\.(png|jpg|jpeg|webp|gif)$/;
// body 可以写多个部位，用这些符号分隔；查询时按 token 匹配。
const BODY_SEP = /[,，、/|]+/;

export function requireValue(ok, message) { if (!ok) throw new Error(message); }

const decode = row => row ? {
  id: row.id, title: row.title, type: row.type, body: row.body, tags: row.tags,
  description: row.description, prompt: row.prompt, image: row.image,
  createdAt: row.created_at, updatedAt: row.updated_at,
} : null;

function text(value, field, limit) {
  const out = String(value ?? '').trim();
  requireValue(out.length <= limit, `${field}_too_long`);
  return out;
}

const bodyTokens = value => String(value ?? '').split(BODY_SEP).map((x) => x.trim().toLowerCase()).filter(Boolean);

export class WardrobeStore {
  constructor(directory) {
    this.dir = directory;
    fs.mkdirSync(path.join(directory, 'images'), { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'wardrobe.sqlite');
    this.db = new DatabaseSync(this.file);
    fs.chmodSync(this.file, 0o600);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS items(
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);`);
    // 老库补两列（type/body 是后加的），只加不改已有数据。
    const columns = new Set(this.db.prepare('PRAGMA table_info(items)').all().map((c) => c.name));
    for (const [name, ddl] of [['type', "ALTER TABLE items ADD COLUMN type TEXT NOT NULL DEFAULT ''"], ['body', "ALTER TABLE items ADD COLUMN body TEXT NOT NULL DEFAULT ''"], ['tags', "ALTER TABLE items ADD COLUMN tags TEXT NOT NULL DEFAULT ''"]]) {
      if (!columns.has(name)) this.db.exec(ddl);
    }
    this.migrateWorn();
  }

  /**
   * 当前穿着存成一个 id 数组（不按部位占坑，穿另一件只是加一件，谁也不顶掉谁）。
   * 迁移两种历史格式：最早的单个 id 字符串、后来的 {部位: id} 表。
   */
  migrateWorn() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='worn'").get();
    if (!row?.value) return;
    let parsed;
    try { parsed = JSON.parse(row.value); } catch { parsed = String(row.value); }
    if (Array.isArray(parsed)) return; // 已是新格式
    const ids = parsed && typeof parsed === 'object' ? [...new Set(Object.values(parsed))] : [String(row.value)];
    this.saveWorn(ids.filter((id) => this.get(id)));
  }

  list() { return this.db.prepare('SELECT * FROM items ORDER BY created_at').all().map(decode); }
  get(id) { return decode(this.db.prepare('SELECT * FROM items WHERE id=?').get(String(id ?? ''))); }
  count() { return this.db.prepare('SELECT COUNT(*) AS n FROM items').get().n; }
  imagesDir() { return path.join(this.dir, 'images'); }

  imagePath(name) {
    requireValue(IMAGE_NAME.test(String(name ?? '')), 'invalid_image_name');
    return path.join(this.imagesDir(), String(name));
  }

  /**
   * 分页查：page 从 1 开始，每页 10 件，只回 id + title。
   * query 是模糊搜索——种类、颜色、款式词都行，匹配标题 + 种类字段；
   * 多个词用空格隔开表示「都要命中」（"冰蓝 针织"）。
   */
  page({ page = 1, query = '', body = '' } = {}) {
    const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const wantedBody = bodyTokens(body);
    let rows = this.list();
    if (words.length) {
      rows = rows.filter((r) => {
        const haystack = `${r.title} ${r.type} ${r.tags}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
    }
    if (wantedBody.length) rows = rows.filter((r) => { const have = bodyTokens(r.body); return wantedBody.some((t) => have.includes(t)); });
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(1, Number(page) || 1), pages);
    const slice = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
    return {
      total, page: current, pages, pageSize: PAGE_SIZE,
      items: slice.map((r) => ({ id: r.id, title: r.title })),
    };
  }

  create(input = {}) {
    const title = text(input.title, 'title', MAX_TITLE);
    requireValue(title.length > 0, 'title_required');
    const now = new Date().toISOString();
    const id = randomUUID();
    // 必须写列名：老库是 ALTER TABLE 补的 tags，物理列顺序和建表语句不一致。
    this.db.prepare('INSERT INTO items(id,title,type,body,tags,description,prompt,image,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      id, title,
      text(input.type, 'type', MAX_TAG),
      text(input.body, 'body', MAX_TAG),
      text(input.tags, 'tags', MAX_TAGS),
      text(input.description, 'description', MAX_TEXT),
      text(input.prompt, 'prompt', MAX_TEXT),
      this.imageNameOrEmpty(input.image),
      now, now,
    );
    return this.get(id);
  }

  update(id, input = {}) {
    const before = this.get(id);
    requireValue(before, 'item_not_found');
    const pick = (key, limit) => (input[key] === undefined ? before[key] : text(input[key], key, limit));
    const title = pick('title', MAX_TITLE);
    requireValue(title.length > 0, 'title_required');
    this.db.prepare('UPDATE items SET title=?,type=?,body=?,tags=?,description=?,prompt=?,image=?,updated_at=? WHERE id=?').run(
      title, pick('type', MAX_TAG), pick('body', MAX_TAG), pick('tags', MAX_TAGS), pick('description', MAX_TEXT), pick('prompt', MAX_TEXT),
      input.image === undefined ? before.image : this.imageNameOrEmpty(input.image),
      new Date().toISOString(), before.id,
    );
    return this.get(before.id);
  }

  remove(id) {
    const before = this.get(id);
    requireValue(before, 'item_not_found');
    this.db.prepare('DELETE FROM items WHERE id=?').run(before.id);
    this.unwear(before.id);
    return before;
  }

  imageNameOrEmpty(value) {
    const name = String(value ?? '').trim();
    if (!name) return '';
    requireValue(IMAGE_NAME.test(name), 'invalid_image_name');
    return name;
  }

  /** 正在穿的 id 列表（保持穿上顺序）。 */
  wornIds() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='worn'").get();
    if (!row?.value) return [];
    try { const parsed = JSON.parse(row.value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }

  saveWorn(ids) {
    const clean = [...new Set(ids.filter((id) => id && this.get(id)))];
    if (!clean.length) { this.db.prepare("DELETE FROM meta WHERE key='worn'").run(); return; }
    this.db.prepare("INSERT OR REPLACE INTO meta VALUES('worn',?)").run(JSON.stringify(clean));
  }

  /** 当前穿着：每件 + 它覆盖的部位（部位由这件自己的 body 决定）。 */
  worn() {
    return this.wornIds().map((id) => this.get(id)).filter(Boolean)
      .map((item) => ({ item, parts: bodyTokens(item.body) }));
  }

  /** 穿上一件：只往列表里加，不碰别的衣服。没标部位照样能穿，只是不会出现在任何部位下。 */
  wear(id) {
    const item = this.get(id);
    requireValue(item, 'item_not_found');
    const ids = this.wornIds();
    if (!ids.includes(item.id)) { ids.push(item.id); this.saveWorn(ids); }
    return { item, parts: bodyTokens(item.body) };
  }

  /** 脱下某件：只从列表里去掉这一件，别的衣服一点不动。 */
  unwear(id) {
    const target = String(id ?? '');
    const ids = this.wornIds();
    const next = ids.filter((x) => x !== target);
    if (next.length === ids.length) return false;
    this.saveWorn(next);
    return true;
  }

  unwearAll() { this.db.prepare("DELETE FROM meta WHERE key='worn'").run(); }

  /** 部位视角：{部位: [衣服…]}。同一部位可以挂多件（裙子和裤子都盖腿时两件都在）。 */
  wornByBody() {
    const map = {};
    for (const { item, parts } of this.worn()) for (const part of parts) (map[part] ??= []).push(item);
    return map;
  }

  saveImage(buffer) {
    requireValue(Buffer.isBuffer(buffer) && buffer.length > 0, 'empty_image');
    requireValue(buffer.length <= 12 * 1024 * 1024, 'image_too_large');
    const ext = buffer[0] === 0x89 && buffer[1] === 0x50 ? 'png'
      : buffer[0] === 0xff && buffer[1] === 0xd8 ? 'jpg'
        : buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP' ? 'webp'
          : buffer.slice(0, 3).toString('ascii') === 'GIF' ? 'gif'
            : null;
    requireValue(ext, 'unsupported_image_type');
    const name = `${randomUUID().replace(/-/g, '').slice(0, 24)}.${ext}`;
    fs.writeFileSync(path.join(this.imagesDir(), name), buffer, { mode: 0o600 });
    return name;
  }

  close() { this.db.close(); }
}
