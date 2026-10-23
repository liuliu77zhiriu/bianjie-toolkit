/* ============================================================
 * 便捷工具 · 插件代码编辑器文件系统测试（node:test）
 * 覆盖：覆盖层墓碑机制（删除/恢复/写入复活）、createFile 路径校验与模板、
 *       files() 的 deletedFiles、deleteFile 覆盖层优先级、plugin.json 删除后的错误态。
 *
 * 主进程 plugin-host.ts 依赖 electron，测试时用 esbuild 把它打包并用
 * 一个 electron stub 替换（只测文件系统逻辑，不启动 Electron / 真实 UI）。
 * ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const ELECTRON_STUB = `
export class BrowserWindow {}
export const app = { getVersion: () => '1.0.0', getName: () => 'test', getLocale: () => 'zh-CN', isPackaged: false, quit() {}, relaunch() {}, setLoginItemSettings() {} };
export const clipboard = { writeText() {}, writeImage() {} };
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
export const ipcMain = { handle() {}, on() {} };
export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }) };
export class Notification { static isSupported() { return false; } constructor() {} show() {} }
export const shell = { openPath: async () => '' };
export const screen = { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) };
export const desktopCapturer = { getSources: async () => [] };
`;

let harnessPromise = null;

/** 用 esbuild 打包 plugin-host（electron → stub），返回 PluginHost 类。 */
function loadPluginHost() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const { build } = await import('esbuild');
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-editor-harness-'));
      const stub = path.join(work, 'electron-stub.mjs');
      fs.writeFileSync(stub, ELECTRON_STUB, 'utf8');
      const entry = path.join(work, 'entry.ts');
      const hostPath = path.join(repoRoot, 'src/main/core/plugin-host.ts').replace(/\\/g, '/');
      fs.writeFileSync(entry, `export { PluginHost } from ${JSON.stringify(hostPath)};\n`, 'utf8');
      const outfile = path.join(work, 'harness.cjs');
      await build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        alias: { electron: stub },
        logLevel: 'silent',
      });
      const require = createRequire(import.meta.url);
      const mod = require(outfile);
      return { PluginHost: mod.PluginHost, work };
    })();
  }
  return harnessPromise;
}

function seedPlugin(root) {
  const resourcesDir = path.join(root, 'resources');
  const pluginsDir = path.join(root, 'plugins');
  const overridesDir = path.join(root, 'overrides');
  const backupsDir = path.join(root, 'backups');
  const pluginDir = path.join(pluginsDir, 'demo');
  fs.mkdirSync(path.join(resourcesDir, 'plugins'), { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0', entry: 'main.mjs', ui: 'index.html' }, null, 2),
    'utf8'
  );
  fs.writeFileSync(path.join(pluginDir, 'main.mjs'), 'export default { activate() {} };\n', 'utf8');
  fs.writeFileSync(path.join(pluginDir, 'index.html'), '<!doctype html><html><body>demo</body></html>\n', 'utf8');
  fs.writeFileSync(path.join(pluginDir, 'app.js'), '// app\n', 'utf8');
  fs.writeFileSync(path.join(pluginDir, 'style.css'), '/* style */\n', 'utf8');
  return { resourcesDir, pluginsDir, overridesDir, backupsDir, pluginDir };
}

async function createHost(PluginHost) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-editor-fs-'));
  const dirs = seedPlugin(root);
  const host = new PluginHost({
    paths: {
      userData: root,
      resourcesDir: dirs.resourcesDir,
      plugins: dirs.pluginsDir,
      overrides: dirs.overridesDir,
      backups: dirs.backupsDir,
      screenshots: path.join(root, 'screenshots'),
      recordings: path.join(root, 'recordings'),
      logs: path.join(root, 'logs'),
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    settings: { get: () => ({ plugins: { disabled: [] }, data: { autoBackup: false }, shortcuts: {} }), patch() {} },
    ipc: { broadcast() {}, broadcastPlugin() {}, registerClient() {}, getClient: () => undefined },
    windows: { withNativeDialog: async (fn) => fn() },
    overlay: {},
    media: {},
  });
  await host.start();
  return { host, root, dirs };
}

test('createFile：子目录 / 模板 / 路径校验 / FILE_EXISTS', async () => {
  const { PluginHost, work } = await loadPluginHost();
  const { host, root, dirs } = await createHost(PluginHost);
  try {
    const initial = await host.files('demo');
    assert.deepEqual(initial.deletedFiles, []);
    assert.deepEqual(
      initial.files.map((file) => file.path),
      ['app.js', 'index.html', 'main.mjs', 'plugin.json', 'style.css']
    );

    let result = await host.createFile('demo', 'lib/helpers.js');
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(path.join(dirs.overridesDir, 'demo', 'lib', 'helpers.js')));
    assert.match((await host.readFile('demo', 'lib/helpers.js')).content, /helpers\.js/);
    assert.ok((await host.files('demo')).files.some((file) => file.path === 'lib/helpers.js' && file.editable));

    await assert.rejects(() => host.createFile('demo', 'lib/helpers.js'), (err) => err.code === 'FILE_EXISTS');

    for (const bad of ['../escape.js', '.hidden.js', 'C:/abs.js', 'bad|name.js', 'no-extension', 'lib//x.js']) {
      await assert.rejects(() => host.createFile('demo', bad), (err) => err.code === 'BAD_PATH', bad);
    }

    await host.createFile('demo', 'notes.txt', '');
    assert.equal((await host.readFile('demo', 'notes.txt')).content, '');
    await host.createFile('demo', 'data.json');
    assert.equal((await host.readFile('demo', 'data.json')).content, '{}\n');
    await host.createFile('demo', 'readme.md');
    assert.match((await host.readFile('demo', 'readme.md')).content, /^# readme\n$/);
    await host.createFile('demo', 'page.htm');
    assert.match((await host.readFile('demo', 'page.htm')).content, /<!doctype html>/);
  } finally {
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('deleteFile / restoreDeletedFile：基座墓碑隐藏、写入复活、plugin.json 错误态', async () => {
  const { PluginHost, work } = await loadPluginHost();
  const { host, root, dirs } = await createHost(PluginHost);
  try {
    // 删除入口文件：操作保留但插件进入错误态
    let result = await host.deleteFile('demo', 'main.mjs');
    assert.equal(result.ok, true);
    assert.ok(result.error && /main\.mjs|插件入口/.test(result.error.message));
    assert.equal(host.resolveFile('demo', 'main.mjs'), null);
    await assert.rejects(() => host.readFile('demo', 'main.mjs'), (err) => err.code === 'FILE_DELETED');
    let payload = await host.files('demo');
    assert.deepEqual(payload.deletedFiles, ['main.mjs']);
    assert.ok(!payload.files.some((file) => file.path === 'main.mjs'));
    assert.ok(host.list().find((item) => item.id === 'demo').error);
    await assert.rejects(() => host.deleteFile('demo', 'main.mjs'), (err) => err.code === 'FILE_NOT_FOUND');

    // 恢复后插件重新加载
    result = await host.restoreDeletedFile('demo', 'main.mjs');
    assert.equal(result.ok, true);
    assert.equal(result.reloaded, true);
    assert.ok(host.resolveFile('demo', 'main.mjs'));
    assert.deepEqual((await host.files('demo')).deletedFiles, []);
    await assert.rejects(() => host.restoreDeletedFile('demo', 'main.mjs'), (err) => err.code === 'FILE_NOT_FOUND');

    // 写入墓碑文件 = 重新创建
    await host.deleteFile('demo', 'app.js');
    assert.equal((await host.writeFile('demo', 'app.js', '// rewritten\n')).ok, true);
    assert.equal((await host.readFile('demo', 'app.js')).content, '// rewritten\n');
    assert.deepEqual((await host.files('demo')).deletedFiles, []);

    // 删除覆盖层文件时基座版本重新可见
    await host.writeFile('demo', 'main.mjs', '// overridden\n');
    assert.ok(host.resolveFile('demo', 'main.mjs').includes('overrides'));
    assert.equal((await host.deleteFile('demo', 'main.mjs')).ok, true);
    assert.ok(host.resolveFile('demo', 'main.mjs').includes('plugins'));

    // 新建文件可被彻底删除（无墓碑，空目录清理）
    await host.createFile('demo', 'tmp/remove-me.js');
    assert.equal((await host.deleteFile('demo', 'tmp/remove-me.js')).ok, true);
    payload = await host.files('demo');
    assert.ok(!payload.files.some((file) => file.path === 'tmp/remove-me.js'));
    assert.deepEqual(payload.deletedFiles, []);
    assert.equal(fs.existsSync(path.join(dirs.overridesDir, 'demo', 'tmp')), false);

    // plugin.json 墓碑：视为缺失、记录保留、可恢复
    result = await host.deleteFile('demo', 'plugin.json');
    assert.equal(result.ok, true);
    assert.ok(result.error && /plugin\.json/.test(result.error.message));
    payload = await host.files('demo');
    assert.deepEqual(payload.deletedFiles, ['plugin.json']);
    assert.ok(!payload.files.some((file) => file.path === 'plugin.json'));
    assert.ok(host.list().find((item) => item.id === 'demo'));
    result = await host.restoreDeletedFile('demo', 'plugin.json');
    assert.equal(result.ok, true);
    assert.equal(result.reloaded, true);
    assert.ok(fs.existsSync(path.join(dirs.pluginDir, 'plugin.json')));
  } finally {
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('restore(id)：整体恢复清理墓碑并移除新建覆盖文件', async () => {
  const { PluginHost, work } = await loadPluginHost();
  const { host, root } = await createHost(PluginHost);
  try {
    await host.createFile('demo', 'lib/helpers.js');
    await host.deleteFile('demo', 'index.html');
    assert.deepEqual((await host.files('demo')).deletedFiles, ['index.html']);

    const result = await host.restore('demo');
    assert.equal(result.ok, true);
    const payload = await host.files('demo');
    assert.deepEqual(payload.deletedFiles, []);
    assert.deepEqual(
      payload.files.map((file) => file.path),
      ['app.js', 'index.html', 'main.mjs', 'plugin.json', 'style.css']
    );
    assert.equal(payload.customized, false);
  } finally {
    await host.stop();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});
