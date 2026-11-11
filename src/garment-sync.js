// 把「当前穿着」同步到 ComfyUI 的输入槽。
//
// 以前是 her-garment.timer 每天 07:00 从旧的 wardrobe.json 轮换一件——那是按日期掷骰子，
// 跟她实际穿着没关系。现在唯一来源是衣柜的当前穿着：穿/脱/删之后立刻同步。
//
// 只写文件，不提交任务、不碰工作流 JSON：
//   her_garment.png     主图（第一件），selfie.json 段二现在只读这一个文件名
//   her_garment_2..N.png 叠加的其余件（工作流还没加槽，先落盘备用）
//   her_garment.json    清单：顺序、id、标题、部位、英文提示词
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CROP = fileURLToPath(new URL('../scripts/crop-two-view.py', import.meta.url));

/**
 * 衣柜里的图是「衣服平铺 + 人穿着」拼在一张的产品图。直接整张喂给 Qwen，
 * 它会把双人排版一起画出来（2026-11-10 实测：成品是两个女生并排）。
 * 所以落进 ComfyUI 前先裁成单品图：找到中间的缝，左半当正面，右半当背面。
 *
 * 两半都留（2026-11-11 用户要求）：只喂正面的话，设计在后背的衣服（深 U 露背、
 * 连体泳衣的 U 领）等于丢了一半信息。左半 → <target>，右半 → <target>_back。
 * 裁不动就原样复制，并且把上一次留下的 _back 删掉——宁可退回双人图，
 * 也不能把上一件衣服的背面当这件喂进去。
 */
function backTargetOf(target) {
  const ext = path.extname(target);
  return `${target.slice(0, -ext.length)}_back${ext}`;
}

function writeGarment(source, target, log) {
  const back = backTargetOf(target);
  fs.rmSync(back, { force: true });
  try {
    const out = execFileSync('python3', [CROP, source, target], { encoding: 'utf8', timeout: 30000 }).trim();
    if (!out.startsWith('split')) return { mode: 'as-is', back: null };
    return { mode: 'cropped', back: fs.existsSync(back) ? back : null };
  } catch (error) {
    log(`裁图失败，原样复制：${error?.message?.split('\n')[0] ?? error}`);
    fs.copyFileSync(source, target);
    return { mode: 'copied', back: null };
  }
}

export function syncGarment(store, { comfyInput, log = () => {} } = {}) {
  if (!comfyInput) return { synced: false, reason: 'no_target' };
  const worn = store.worn();
  if (!worn.length) {
    log('当前没有穿着，保留上一件 garment 图不动');
    return { synced: false, reason: 'nothing_worn' };
  }
  const withImage = worn.filter((w) => w.item.image);
  if (!withImage.length) {
    log('穿着的衣服都没有配图，保留上一张 garment 图');
    return { synced: false, reason: 'no_image' };
  }
  fs.mkdirSync(comfyInput, { recursive: true });

  // 主图固定叫 her_garment.png；其余按穿着顺序编号，供以后加多图槽。
  const written = [];
  withImage.forEach((w, index) => {
    const name = index === 0 ? 'her_garment.png' : `her_garment_${index + 1}.png`;
    const source = store.imagePath(w.item.image);
    if (!fs.existsSync(source)) { log(`跳过 ${w.item.title}：图片文件不见了`); return; }
    const { mode, back } = writeGarment(source, path.join(comfyInput, name), log);
    written.push({
      slot: name,
      slot_back: back ? path.basename(back) : '',
      id: w.item.id,
      title: w.item.title,
      parts: w.parts,
      prompt: w.item.prompt,
      image_mode: mode,
    });
  });
  if (!written.length) return { synced: false, reason: 'missing_files' };

  fs.writeFileSync(path.join(comfyInput, 'her_garment.json'), JSON.stringify({
    at: new Date().toISOString(),
    // 工作流目前只用第一件；这里写清楚，免得以后误以为多件已经生效
    workflow_uses: 1,
    items: written,
  }, null, 2));

  const backs = written.filter((w) => w.slot_back).length;
  log(`已同步 ${written.length} 件到 ComfyUI 输入：${written.map((w) => w.title).join('、')}`
    + `（${backs} 件带背面图）${written.length > 1 ? '（工作流目前只用第一件）' : ''}`);
  return { synced: true, count: written.length, written };
}
