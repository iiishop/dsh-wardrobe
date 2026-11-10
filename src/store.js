import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_TITLE = 120;
const MAX_TEXT = 8000;
const IMAGE_NAME = /^[A-Za-z0-9_-]{4,80}\.(png|jpg|jpeg|webp|gif)$/;

export function requireValue(ok, message) { if (!ok) throw new Error(message); }

const decode = row => row ? { id: row.id, title: row.title, description: row.description, prompt: row.prompt, image: row.image, createdAt: row.created_at, updatedAt: row.updated_at } : null;

function text(value, field, limit) {
  const out = String(value ?? '').trim();
  requireValue(out.length <= limit, `${field}_too_long`);
  return out;
}

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
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`);
  }

  list() { return this.db.prepare('SELECT * FROM items ORDER BY created_at').all().map(decode); }
  get(id) { return decode(this.db.prepare('SELECT * FROM items WHERE id=?').get(String(id ?? ''))); }
  imagesDir() { return path.join(this.dir, 'images'); }
  imagePath(name) {
    requireValue(IMAGE_NAME.test(String(name ?? '')), 'invalid_image_name');
    return path.join(this.imagesDir(), String(name));
  }

  create(input = {}) {
    const title = text(input.title, 'title', MAX_TITLE);
    requireValue(title.length > 0, 'title_required');
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare('INSERT INTO items VALUES(?,?,?,?,?,?,?)').run(
      id, title,
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
    const title = input.title === undefined ? before.title : text(input.title, 'title', MAX_TITLE);
    requireValue(title.length > 0, 'title_required');
    this.db.prepare('UPDATE items SET title=?,description=?,prompt=?,image=?,updated_at=? WHERE id=?').run(
      title,
      input.description === undefined ? before.description : text(input.description, 'description', MAX_TEXT),
      input.prompt === undefined ? before.prompt : text(input.prompt, 'prompt', MAX_TEXT),
      input.image === undefined ? before.image : this.imageNameOrEmpty(input.image),
      new Date().toISOString(), before.id,
    );
    return this.get(before.id);
  }

  remove(id) {
    const before = this.get(id);
    requireValue(before, 'item_not_found');
    this.db.prepare('DELETE FROM items WHERE id=?').run(before.id);
    return before;
  }

  /** 文件名只允许本插件自己落的那种；空串表示还没有图。 */
  imageNameOrEmpty(value) {
    const name = String(value ?? '').trim();
    if (!name) return '';
    requireValue(IMAGE_NAME.test(name), 'invalid_image_name');
    return name;
  }

  /** 存一张图，返回文件名。扩展名按魔数判，不信调用方给的 content-type。 */
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
    const target = path.join(this.imagesDir(), name);
    fs.writeFileSync(target, buffer, { mode: 0o600 });
    return name;
  }

  close() { this.db.close(); }
}
