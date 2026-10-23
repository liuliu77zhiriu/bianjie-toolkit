/* ============================================================
 * 便捷工具 · 个性化单元测试（node:test）
 * 覆盖：
 *   1) 内置壁纸资产：manifest 完整性、文件存在、1920×1080 JPEG、单张 ≤400KB
 *   2) 主题服务：内置主题、保存/读取/删除、tokens 规范化、持久化与 30 条上限
 * 不依赖 Electron / 真实 UI：主题服务通过 esbuild 现场打包为 ESM 后导入。
 * ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WALLPAPER_DIR = path.join(ROOT, 'resources', 'wallpapers');
const REQUIRED_IDS = ['ocean', 'aurora', 'graphite', 'dusk', 'midnight', 'ember'];
const MAX_BYTES = 400 * 1024;

/* ------------------------------------------------------------------ 壁纸资产 */

/** 读取 JPEG 的宽高（解析 SOF 段，避免依赖 Electron）。 */
function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

test('内置壁纸 manifest 包含全部必需 id 且字段完整', () => {
  const manifestPath = path.join(WALLPAPER_DIR, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json 不存在');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(Array.isArray(manifest) && manifest.length >= 6, 'manifest 至少 6 项');

  const ids = manifest.map((item) => item.id);
  for (const id of REQUIRED_IDS) assert.ok(ids.includes(id), `缺少内置壁纸 id：${id}`);
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复');

  for (const item of manifest) {
    assert.match(item.id, /^[a-z0-9][a-z0-9_-]{0,63}$/, `非法 id：${item.id}`);
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.trim().length > 0, `${item.id} 缺少中文名`);
    assert.equal(typeof item.description, 'string');
    assert.ok(item.description.trim().length > 0, `${item.id} 缺少描述`);
    assert.equal(typeof item.file, 'string');
    assert.ok(!item.file.includes('/') && !item.file.includes('\\'), `${item.id} 的 file 必须是纯文件名`);
  }
});

test('内置壁纸图片均为 1920×1080 JPEG 且单张 ≤400KB', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(WALLPAPER_DIR, 'manifest.json'), 'utf8'));
  for (const item of manifest) {
    const file = path.join(WALLPAPER_DIR, item.file);
    assert.ok(fs.existsSync(file), `壁纸文件缺失：${item.file}`);
    const buffer = fs.readFileSync(file);
    assert.ok(buffer.length > 0 && buffer.length <= MAX_BYTES, `${item.file} 体积 ${buffer.length} 超出限制`);
    const size = jpegSize(buffer);
    assert.ok(size, `${item.file} 不是有效 JPEG`);
    assert.deepEqual(size, { width: 1920, height: 1080 }, `${item.file} 尺寸不是 1920×1080`);
    // 文件尾部应存在 EOI 标记，确保文件未被截断
    assert.deepEqual([buffer[buffer.length - 2], buffer[buffer.length - 1]], [0xff, 0xd9], `${item.file} 文件不完整`);
  }
});

/* ------------------------------------------------------------------ 主题服务 */

async function loadThemeModule() {
  const result = await build({
    entryPoints: [path.join(ROOT, 'src', 'main', 'core', 'themes.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return import(url);
}

function memoryLogger() {
  const entries = [];
  const record = (level) => (...args) => entries.push({ level, args });
  return { entries, debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') };
}

async function withTempUserData(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tk-personalize-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('主题服务：内置主题齐全且标记 builtin', async () => {
  const { ThemeService } = await loadThemeModule();
  await withTempUserData(async (userData) => {
    const service = new ThemeService({ userData }, memoryLogger());
    const list = service.list();
    const builtin = list.filter((theme) => theme.builtin);
    assert.ok(builtin.length >= 6, '内置主题至少 6 个');
    for (const id of ['midnight', 'deep-sea', 'aurora', 'graphite', 'dusk', 'pure-black']) {
      assert.ok(service.get(id), `缺少内置主题 ${id}`);
    }
    assert.equal(list.length, builtin.length, '初始不应有自定义主题');
    assert.ok(service.get('aurora').tokens.wallpaper.startsWith('builtin:aurora'));
  });
});

test('主题服务：保存 / 读取 / 删除自定义主题并持久化', async () => {
  const { ThemeService } = await loadThemeModule();
  await withTempUserData(async (userData) => {
    const service = new ThemeService({ userData }, memoryLogger());
    const tokens = {
      accent: '#46d7d1',
      panelOpacity: 0.8,
      blur: true,
      animation: 'lite',
      wallpaper: 'builtin:ocean',
      wallpaperOpacity: 0.45,
      ballEdgeHide: false,
      showDock: false,
    };
    const afterSave = service.save('  深海定制  ', tokens);
    assert.equal(afterSave.length, service.list().filter((theme) => theme.builtin).length + 1);
    const custom = service.list().find((theme) => !theme.builtin);
    assert.ok(custom, '应保存出自定义主题');
    assert.equal(custom.name, '深海定制', '名称应去除首尾空白');
    assert.match(custom.id, /^custom:/);
    assert.deepEqual(custom.tokens, tokens);
    assert.match(custom.description, /保存于/);

    // 重新构造：验证写入 userData/themes.json 后能读回
    const storePath = path.join(userData, 'themes.json');
    assert.ok(fs.existsSync(storePath), 'themes.json 未写入');
    const reloaded = new ThemeService({ userData }, memoryLogger());
    const restored = reloaded.get(custom.id);
    assert.ok(restored, '重启后应能读回自定义主题');
    assert.deepEqual(restored.tokens, tokens);

    // 删除
    const afterDelete = reloaded.delete(custom.id);
    assert.equal(afterDelete.filter((theme) => !theme.builtin).length, 0);
    const again = new ThemeService({ userData }, memoryLogger());
    assert.equal(again.list().filter((theme) => !theme.builtin).length, 0, '删除应持久化');
  });
});

test('主题服务：内置主题不可删除，非法 id 抛错', async () => {
  const { ThemeService } = await loadThemeModule();
  await withTempUserData(async (userData) => {
    const service = new ThemeService({ userData }, memoryLogger());
    assert.throws(() => service.delete('midnight'), /仅支持删除自定义主题/);
    assert.throws(() => service.delete(''), /仅支持删除自定义主题/);
    assert.throws(() => service.delete('custom:not-exist'), /主题不存在/);
  });
});

test('主题服务：非法 tokens 被规范化而非抛错', async () => {
  const { ThemeService } = await loadThemeModule();
  await withTempUserData(async (userData) => {
    const service = new ThemeService({ userData }, memoryLogger());
    service.save('脏数据', {
      accent: 'not-a-color',
      panelOpacity: 99,
      blur: 'yes',
      animation: 'wild',
      wallpaper: 'javascript:alert(1)',
      wallpaperOpacity: -3,
      ballEdgeHide: 1,
      showDock: 'no',
    });
    const custom = service.list().find((theme) => !theme.builtin);
    assert.match(custom.tokens.accent, /^#[0-9a-f]{6}$/i);
    assert.equal(custom.tokens.panelOpacity, 1);
    assert.equal(custom.tokens.wallpaperOpacity, 0.05);
    assert.equal(custom.tokens.animation, 'full');
    assert.equal(custom.tokens.wallpaper, '');
    assert.equal(custom.tokens.blur, true);
    assert.equal(custom.tokens.ballEdgeHide, true);
    assert.equal(custom.tokens.showDock, true);
  });
});

test('主题服务：自定义主题最多保留 30 个', async () => {
  const { ThemeService } = await loadThemeModule();
  await withTempUserData(async (userData) => {
    const service = new ThemeService({ userData }, memoryLogger());
    const baseTokens = service.get('midnight').tokens;
    for (let index = 0; index < 32; index += 1) service.save(`主题 ${index}`, baseTokens);
    const customs = service.list().filter((theme) => !theme.builtin);
    assert.equal(customs.length, 30, '自定义主题上限应为 30');
    // 最新保存的在最前
    assert.equal(customs[0].name, '主题 31');
  });
});

test('主题服务：同名保存不覆盖，get 按 id 精确查找', async () => {
  const { ThemeService } = await loadThemeModule();
  await withTempUserData(async (userData) => {
    const service = new ThemeService({ userData }, memoryLogger());
    const tokens = service.get('dusk').tokens;
    service.save('同名', tokens);
    service.save('同名', tokens);
    const customs = service.list().filter((theme) => !theme.builtin);
    assert.equal(customs.length, 2);
    assert.notEqual(customs[0].id, customs[1].id);
    assert.equal(service.get(customs[0].id).name, '同名');
    assert.equal(service.get('custom:not-exist'), undefined);
  });
});
