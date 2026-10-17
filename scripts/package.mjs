/**
 * 绿色版打包：直接复制本地 Electron 运行时 + app 目录，并用 resedit 写入图标与版本信息。
 * 产物：release/便捷工具-win32-x64/便捷工具.exe
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildApp = path.join(rootDir, 'build', 'app');
const releaseRoot = path.join(rootDir, 'release');
const releaseDir = path.join(releaseRoot, '便捷工具-win32-x64');
const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist');
const electronExe = path.join(electronDist, 'electron.exe');
const appExe = path.join(releaseDir, '便捷工具.exe');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

console.log('[package] building…');
execFileSync(process.execPath, [path.join(rootDir, 'scripts/build.mjs')], { cwd: rootDir, stdio: 'inherit' });

async function assembleApp() {
  await fsp.rm(buildApp, { recursive: true, force: true });
  await fsp.mkdir(buildApp, { recursive: true });
  await fsp.cp(path.join(rootDir, 'dist'), path.join(buildApp, 'dist'), { recursive: true });
  await fsp.cp(path.join(rootDir, 'resources'), path.join(buildApp, 'resources'), { recursive: true });
  await fsp.cp(path.join(rootDir, 'docs'), path.join(buildApp, 'docs'), { recursive: true });
  for (const file of ['README.md', 'LICENSE']) {
    const source = path.join(rootDir, file);
    if (fs.existsSync(source)) await fsp.cp(source, path.join(buildApp, file));
  }
  const pkg = readJson(path.join(rootDir, 'package.json'));
  const appPkg = {
    name: 'bianjie-toolkit',
    productName: pkg.productName || '便捷工具',
    version: pkg.version || '1.0.0',
    description: pkg.description,
    main: 'dist/main/index.cjs',
    type: 'module',
    author: 'Toolkit',
    license: 'MIT',
  };
  await fsp.writeFile(path.join(buildApp, 'package.json'), JSON.stringify(appPkg, null, 2), 'utf8');
}

async function copyRuntime() {
  await fsp.rm(releaseDir, { recursive: true, force: true });
  await fsp.mkdir(releaseDir, { recursive: true });
  await fsp.cp(electronDist, releaseDir, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(electronDist, source);
      if (rel.startsWith('resources/default_app.asar')) return false;
      if (rel.startsWith('resources/electron.asar')) return false;
      return true;
    },
  });
  await fsp.rename(path.join(releaseDir, 'electron.exe'), appExe);
  const localesDir = path.join(releaseDir, 'locales');
  if (fs.existsSync(localesDir)) {
    const keep = new Set(['zh-CN.pak', 'en-US.pak']);
    for (const name of await fsp.readdir(localesDir)) {
      if (!keep.has(name)) await fsp.rm(path.join(localesDir, name), { force: true });
    }
  }
  await fsp.mkdir(path.join(releaseDir, 'resources', 'app'), { recursive: true });
  await fsp.cp(buildApp, path.join(releaseDir, 'resources', 'app'), { recursive: true });
}

async function patchResources() {
  try {
    const ResEdit = await import('resedit');
    const buffer = await fsp.readFile(appExe);
    const exe = ResEdit.NtExecutable.from(buffer, { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(exe);

    const iconPath = path.join(rootDir, 'resources', 'icons', 'app.ico');
    if (fs.existsSync(iconPath)) {
      const iconFile = ResEdit.Data.IconFile.from(await fsp.readFile(iconPath));
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        1,
        1033,
        iconFile.icons.map((item) => item.data)
      );
    }

    const versionInfos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
    if (versionInfos.length) {
      const versionInfo = versionInfos[0];
      versionInfo.setFileVersion(1, 0, 0, 0);
      versionInfo.setProductVersion(1, 0, 0, 0);
      versionInfo.setStringValues(
        { lang: 1033, codepage: 1200 },
        {
          CompanyName: '便捷工具',
          FileDescription: '便捷工具 · 桌面快捷工具箱',
          ProductName: '便捷工具',
          FileVersion: '1.0.0',
          ProductVersion: '1.0.0',
          OriginalFilename: '便捷工具.exe',
          InternalName: 'BianjieToolkit',
          LegalCopyright: '便捷工具',
        }
      );
      versionInfo.outputToResourceEntries(res.entries);
    }

    res.outputResource(exe);
    await fsp.writeFile(appExe, Buffer.from(exe.generate()));
    console.log('[package] 已写入应用图标与版本信息');
  } catch (err) {
    console.warn('[package] 图标/版本写入失败（不影响运行）:', err);
  }
}

async function summarize() {
  const total = (await fsp.readdir(releaseDir, { recursive: true, withFileTypes: true })).length;
  const size = await (async () => {
    let sum = 0;
    const walk = async (dir) => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else sum += (await fsp.stat(full)).size;
      }
    };
    await walk(releaseDir);
    return sum;
  })();
  const stat = await fsp.stat(appExe);
  console.log(`[package] 输出: ${appExe}`);
  console.log(`[package] 可执行文件 ${(stat.size / 1024 / 1024).toFixed(1)}MB，整包 ${(size / 1024 / 1024).toFixed(1)}MB，${total} 项`);
}

async function main() {
  if (!fs.existsSync(electronExe)) {
    throw new Error(`找不到 Electron 运行时：${electronExe}，请先 npm install`);
  }
  await assembleApp();
  await copyRuntime();
  await patchResources();
  await summarize();
}

main().catch((err) => {
  console.error('[package] 失败:', err);
  process.exit(1);
});
