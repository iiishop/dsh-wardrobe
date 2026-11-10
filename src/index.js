import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WardrobeStore } from './store.js';
import { installApi } from './api.js';

export const name = 'dsh-wardrobe';
export const inject = ['webServer'];

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const apply = async (ctx, config = {}) => {
  const dshHome = config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const dataDir = config.dataDir || path.join(dshHome, 'wardrobe');
  const store = new WardrobeStore(dataDir);
  const disposeApi = installApi(ctx, { store, pluginVersion: pkg.version });
  console.log(`[dsh-wardrobe] 已启用 data=${dataDir} 衣服=${store.list().length} 件`);
  return async () => { await disposeApi(); store.close(); };
};

export default { name, inject, apply };
