import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_TITLE = 120;
const MAX_TEXT = 8000;
const MAX_TAG = 60;
const PAGE_SIZE = 10;
const IMAGE_NAME = /^[A-Za-z0-9_-]{4,80}\.(png|jpg|jpeg|webp|gif)$/;
// body 可以写多个部位，用这些符号分隔；查询时按 token 匹配。
const BODY_SEP = /[,，、/|]+/;

export function requireValue(ok, message) { if (!ok) throw new Error(message); }

const decode = row => row ? {
  id: row.id, title: row.title, type: row.type, body: row.body,
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
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);`);
    // 老库补两列（type/body 是后加的），只加不改已有数据。
    const columns = new Set(this.db.prepare('PRAGMA table_info(items)').all().map((c) => c.name));
    for (const [name, ddl] of [['type', "ALTER TABLE items ADD COLUMN type TEXT NOT NULL DEFAULT ''"], ['body', "ALTER TABLE items ADD COLUMN body TEXT NOT NULL DEFAULT ''"]]) {
      if (!columns.has(name)) this.db.exec(ddl);
    }
  }

  list() { return this.db.prepare('SELECT * FROM items ORDER BY created_at').all().map(decode); }
  get(id) { return decode(this.db.prepare('SELECT * FROM items WHERE id=?').get(String(id ?? ''))); }
  count() { return this.db.prepare('SELECT COUNT(*) AS n FROM items').get().n; }
  imagesDir() { return path.join(this.dir, 'images'); }

  imagePath(name) {
    requireValue(IMAGE_NAME.test(String(name ?? '')), 'invalid_image_name');
    return path.join(this.imagesDir(), String(name));
  }

  /** 分页查：page 从 1 开始，每页 10 件，只回 id + title。筛选在内存里做（衣柜不会大到需要索引）。 */
  page({ page = 1, type = '', body = '' } = {}) {
    const wantedType = String(type ?? '').trim().toLowerCase();
    const wantedBody = bodyTokens(body);
    let rows = this.list();
    if (wantedType) rows = rows.filter((r) => r.type.toLowerCase().includes(wantedType));
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
    this.db.prepare('INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?)').run(
      id, title,
      text(input.type, 'type', MAX_TAG),
      text(input.body, 'body', MAX_TAG),
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
    this.db.prepare('UPDATE items SET title=?,type=?,body=?,description=?,prompt=?,image=?,updated_at=? WHERE id=?').run(
      title, pick('type', MAX_TAG), pick('body', MAX_TAG), pick('description', MAX_TEXT), pick('prompt', MAX_TEXT),
      input.image === undefined ? before.image : this.imageNameOrEmpty(input.image),
      new Date().toISOString(), before.id,
    );
    return this.get(before.id);
  }

  remove(id) {
    const before = this.get(id);
    requireValue(before, 'item_not_found');
    this.db.prepare('DELETE FROM items WHERE id=?').run(before.id);
    if (this.wornId() === before.id) this.unwear();
    return before;
  }

  imageNameOrEmpty(value) {
    const name = String(value ?? '').trim();
    if (!name) return '';
    requireValue(IMAGE_NAME.test(name), 'invalid_image_name');
    return name;
  }

  wornId() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='worn'").get();
    return row?.value ?? '';
  }

  /** 当前穿着：单件。id 为空表示没穿（或没设过）。 */
  wear(id) {
    const item = this.get(id);
    requireValue(item, 'item_not_found');
    this.db.prepare("INSERT OR REPLACE INTO meta VALUES('worn',?)").run(item.id);
    return item;
  }

  unwear() { this.db.prepare("DELETE FROM meta WHERE key='worn'").run(); }
  worn() { const id = this.wornId(); return id ? this.get(id) : null; }

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
