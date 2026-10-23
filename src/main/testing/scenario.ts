/**
 * 冒烟测试脚本（npm run smoke，TK_TEST=1 时由主进程加载）。
 * 覆盖：面板/悬浮球/桌面外观、插件列表、设置读写、截图、录屏、插件 iframe、设置页。
 */
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { BrowserWindow, screen } from 'electron';
import type { AppPaths, MediaApi, PluginRuntimeInfo } from '../../shared/types';
import type { IpcHub } from '../core/ipc';
import type { Logger } from '../core/logger';
import type { OverlayManager } from '../core/overlay';
import type { PluginHost } from '../core/plugin-host';
import type { SettingsService } from '../core/settings';
import type { ShortcutManager } from '../core/shortcuts';
import type { WindowManager } from '../core/windows';
import type { SettingsWindowManager } from '../core/settings-window';
import { exportStandaloneHtml } from '../core/uieditor/export';
import type { UIEditorService } from '../core/uieditor/service';
import type { UIEditorWindowManager } from '../core/uieditor/window';

export interface SmokeEnv {
  app: typeof import('electron').app;
  appRoot: string;
  paths: AppPaths;
  logger: Logger;
  settings: SettingsService;
  ipc: IpcHub;
  windows: WindowManager;
  overlay: OverlayManager;
  plugins: PluginHost;
  media: MediaApi;
  shortcuts: ShortcutManager;
  settingsWindow: SettingsWindowManager;
  uieditor: UIEditorService;
  uieditorWindow: UIEditorWindowManager;
}

interface StepResult {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

const findWindows = (part: string) =>
  BrowserWindow.getAllWindows().filter((win) => {
    try {
      return win.webContents.getURL().includes(part);
    } catch {
      return false;
    }
  });

export async function runSmoke(env: SmokeEnv): Promise<void> {
  const outDir = path.join(env.appRoot, 'artifacts', 'smoke');
  fs.mkdirSync(outDir, { recursive: true });
  const results: StepResult[] = [];

  const run = async (name: string, fn: () => Promise<unknown>) => {
    const start = Date.now();
    try {
      const detail = await fn();
      results.push({
        name,
        ok: true,
        ms: Date.now() - start,
        detail: typeof detail === 'string' ? detail : undefined,
      });
      env.logger.info(`[test] ✓ ${name}${typeof detail === 'string' ? ` — ${detail}` : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name, ok: false, ms: Date.now() - start, detail: message });
      env.logger.error(`[test] ✗ ${name}: ${message}`);
    }
  };

  const capturePanel = async (file: string) => {
    const panel = env.windows.panel;
    if (!panel) throw new Error('panel not created');
    const image = await panel.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, file), image.toPNG());
    return image.getSize();
  };

  const openToolPage = async (pluginId: string, file: string) => {
    env.windows.openPanel(pluginId);
    await wait(2600);
    return capturePanel(file);
  };

  const writeReport = () => {
    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      JSON.stringify({ date: new Date().toISOString(), results }, null, 2)
    );
  };

  await run('面板 + 悬浮球 + 桌面外观截图', async () => {
    env.windows.openPanel();
    await wait(1800);
    if (!env.windows.panel) throw new Error('panel not created');
    const size = await capturePanel('01-panel-home.png');
    if (env.windows.ball) {
      const ballShot = await env.windows.ball.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, '02-ball.png'), ballShot.toPNG());
    }
    const desktop = await env.media.captureFullscreen({ hidePanel: false, copy: false });
    fs.copyFileSync(desktop.path, path.join(outDir, '03-desktop-acrylic.png'));
    return `panel ${size.width}x${size.height} · ball ${env.windows.ball ? 'ok' : 'missing'} · desktop ${desktop.width}x${desktop.height}`;
  });

  await run('插件加载列表', async () => {
    const list: PluginRuntimeInfo[] = env.plugins.list();
    if (!list.length) throw new Error('没有发现任何插件');
    const loaded = list.filter((p) => p.loaded);
    if (loaded.length < 4) throw new Error(`仅加载 ${loaded.length}/4 个插件`);
    return list.map((p) => `${p.id}:${p.loaded ? 'loaded' : p.error || 'disabled'}`).join(', ');
  });

  await run('设置读写', async () => {
    const before = env.settings.get();
    const next = env.settings.patch({ appearance: { accent: '#46D7D1' } });
    if (next.appearance.accent.toLowerCase() !== '#46d7d1') throw new Error('patch 未生效');
    await wait(200);
    env.settings.patch({ appearance: { accent: before.appearance.accent } });
    return next.appearance.accent;
  });

  await run('截图能力（全屏）', async () => {
    const sources = await env.media.listSources({ kinds: ['screen', 'window'], thumbnailWidth: 240 });
    const screens = sources.filter((s) => s.kind === 'screen');
    if (!screens.length) throw new Error('未发现屏幕源');
    if (sources.filter((s) => s.kind === 'window').length === 0) throw new Error('未发现窗口源');
    const result = await env.media.captureFullscreen({ copy: true });
    if (!fs.existsSync(result.path)) throw new Error('截图文件不存在');
    const stat = fs.statSync(result.path);
    if (stat.size < 10_000) throw new Error(`截图文件异常小：${stat.size}`);
    fs.copyFileSync(result.path, path.join(outDir, '04-capture-full.png'));
    return `${result.width}x${result.height} · ${Math.round(stat.size / 1024)}KB · clipboard=${result.copied}`;
  });

  await run('录屏能力（3 秒）', async () => {
    const sources = await env.media.listSources({ kinds: ['screen'], thumbnailWidth: 120 });
    const screen = sources.find((s) => s.kind === 'screen');
    if (!screen) throw new Error('未发现屏幕源');
    const { id } = await env.media.startRecording({
      sourceId: screen.id,
      kind: 'screen',
      audio: 'none',
      countdown: 0,
      fps: 30,
      quality: 80,
    });
    await wait(3600);
    const result = await env.media.stopRecording(id);
    if (!fs.existsSync(result.path)) throw new Error('录制文件不存在');
    const stat = fs.statSync(result.path);
    if (stat.size < 20_000) throw new Error(`录制文件异常小：${stat.size}`);
    if (result.durationMs < 1500) throw new Error(`录制时长异常：${result.durationMs}ms`);
    fs.copyFileSync(result.path, path.join(outDir, `05-recording.${result.format}`));
    return `${result.format} · ${(result.durationMs / 1000).toFixed(1)}s · ${Math.round(stat.size / 1024)}KB`;
  });

  await run('截图插件 iframe', async () => {
    const size = await openToolPage('screenshot', '06-tool-screenshot.png');
    const info = (await env.windows.panel?.webContents.executeJavaScript(`(() => {
      const frame = document.querySelector('iframe[data-plugin="screenshot"]');
      return {
        header: document.querySelector('.header-title')?.textContent || '',
        src: frame ? frame.getAttribute('src') : null,
        ready: frame ? frame.classList.contains('ready') : false,
      };
    })()`)) as { header: string; src: string | null; ready: boolean } | null;
    if (!info?.src) throw new Error(`未渲染 screenshot iframe（当前页：${info?.header || '?'}）`);
    return `header=${info.header} ready=${info.ready} · panel ${size.width}x${size.height}`;
  });

  await run('备忘录 iframe', async () => {
    const size = await openToolPage('memo', '07-tool-memo.png');
    const ready = (await env.windows.panel?.webContents.executeJavaScript(
      `!!document.querySelector('iframe[data-plugin="memo"].ready')`
    )) as boolean;
    if (!ready) throw new Error('memo iframe 未就绪');
    return `panel ${size.width}x${size.height}`;
  });

  await run('计时器 iframe', async () => {
    const size = await openToolPage('timer', '08-tool-timer.png');
    const ready = (await env.windows.panel?.webContents.executeJavaScript(
      `!!document.querySelector('iframe[data-plugin="timer"].ready')`
    )) as boolean;
    if (!ready) throw new Error('timer iframe 未就绪');
    return `panel ${size.width}x${size.height}`;
  });

  await run('录制插件 iframe', async () => {
    const size = await openToolPage('recorder', '09-tool-recorder.png');
    const ready = (await env.windows.panel?.webContents.executeJavaScript(
      `!!document.querySelector('iframe[data-plugin="recorder"].ready')`
    )) as boolean;
    if (!ready) throw new Error('recorder iframe 未就绪');
    return `panel ${size.width}x${size.height}`;
  });

  await run('独立设置窗口', async () => {
    env.windows.openPanel();
    await wait(700);
    const clickedSettings = (await env.windows.panel?.webContents.executeJavaScript(
      "(() => { const button = document.querySelector('.panel-header button[title=\"设置\"]'); button?.click(); return !!button; })()"
    )) as boolean;
    if (!clickedSettings) throw new Error('面板设置按钮未找到或未响应');
    await wait(1700);
    const win = env.settingsWindow.win;
    if (!win || win.isDestroyed()) throw new Error('设置窗口未创建');
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '10-settings-window.png'), shot.toPNG());
    const layout = (await win.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.settings-window')?.getBoundingClientRect();
      return { innerW: innerWidth, innerH: innerHeight, cardW: rect?.width ?? 0, cardH: rect?.height ?? 0 };
    })()`)) as { innerW: number; innerH: number; cardW: number; cardH: number };
    if (Math.abs(layout.cardW - layout.innerW) > 1 || Math.abs(layout.cardH - layout.innerH) > 1) {
      throw new Error(`设置窗口未铺满客户区：${layout.cardW}x${layout.cardH} / ${layout.innerW}x${layout.innerH}`);
    }
    const state = (await win.webContents.executeJavaScript(`(() => ({
      nav: document.querySelectorAll('.settings-nav-item').length,
      title: document.querySelector('.settings-page-title')?.textContent ?? '',
      wallpaper: !!document.querySelector('.settings-window'),
    }))()`)) as { nav: number; title: string; wallpaper: boolean };
    if (state.nav !== 8) throw new Error(`设置导航数量异常：${state.nav}`);
    if (!state.title) throw new Error('设置页标题未渲染');
    const bounds = win.getBounds();
    // 切到个性化页，验证独立窗口中的个性化 tab 与壁纸/主题区
    env.settingsWindow.open('personalize');
    await wait(900);
    const personalize = (await win.webContents.executeJavaScript(`(() => ({
      active: document.querySelector('.settings-nav-item.active')?.textContent?.trim() ?? '',
      cards: document.querySelectorAll('.personalize-theme, .theme-preset-card, .settings-nav-item').length,
    }))()`)) as { active: string; cards: number };
    const personalizeShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '11-personalize.png'), personalizeShot.toPNG());
    if (!personalize.active.includes('个性化')) throw new Error(`个性化 tab 未激活：${personalize.active}`);
    const scrollTo = async (top: number) => {
      await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector('.settings-page-scroll'); if (el) el.scrollTop = ${top}; return true; })()`
      );
      await wait(420);
    };
    await scrollTo(760);
    const wallpaperCards = (await win.webContents.executeJavaScript(
      "document.querySelectorAll('.pz-wall-card').length"
    )) as number;
    if (wallpaperCards < 6) throw new Error(`壁纸卡片不足：${wallpaperCards}`);
    const wallsShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '22-personalize-wallpapers.png'), wallsShot.toPNG());
    await scrollTo(1780);
    const designerShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '23-personalize-designer.png'), designerShot.toPNG());
    // 窗口可缩放：放大后内容区应自适应
    win.setSize(1080, 780);
    await wait(500);
    const resizedShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '24-settings-resized.png'), resizedShot.toPNG());
    const resizedLayout = (await win.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.settings-window')?.getBoundingClientRect();
      return { innerW: innerWidth, cardW: rect?.width ?? 0 };
    })()`)) as { innerW: number; cardW: number };
    if (Math.abs(resizedLayout.cardW - resizedLayout.innerW) > 1) {
      throw new Error(`缩放后设置窗口未铺满：${resizedLayout.cardW} / ${resizedLayout.innerW}`);
    }
    win.setSize(920, 720);
    await wait(300);
    // 扩展 tab → 点击第一个「编辑」进入编辑器，验证独立设置窗口中的编辑器布局
    env.settingsWindow.open('plugins');
    await wait(900);
    const clicked = (await win.webContents.executeJavaScript(
      "(() => { const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent.trim() === '编辑'); button?.click(); return !!button; })()"
    )) as boolean;
    if (!clicked) throw new Error('未找到插件「编辑」按钮');
    await wait(1600);
    const editorState = (await win.webContents.executeJavaScript(`(() => ({
      shell: !!document.querySelector('.editor-shell'),
      buttons: Array.from(document.querySelectorAll('.editor-toolbar button')).map((item) => item.textContent.trim()).join('|'),
    }))()`)) as { shell: boolean; buttons: string };
    if (!editorState.shell) throw new Error('编辑器视图未渲染');
    const editorShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '12-editor-window.png'), editorShot.toPNG());
    // 打开「新建文件」弹层，验证 UI 可用
    const openedCreate = (await win.webContents.executeJavaScript(
      "(() => { const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent.trim() === '新建文件'); button?.click(); return !!button; })()"
    )) as boolean;
    if (!openedCreate) throw new Error('未找到新建文件按钮');
    await wait(500);
    const createModal = (await win.webContents.executeJavaScript(`(() => ({
      modal: !!document.querySelector('.modal-card'),
      input: document.querySelector('.modal-card input')?.getAttribute('placeholder') ?? '',
    }))()`)) as { modal: boolean; input: string };
    if (!createModal.modal) throw new Error('新建文件弹层未出现');
    const createShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '13-editor-newfile.png'), createShot.toPNG());
    // Esc 关闭弹层
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(250);
    env.settingsWindow.close();
    await wait(300);
    return `${state.nav} 项导航 · ${bounds.width}x${bounds.height} · 个性化卡片 ${personalize.cards} · 编辑器[${editorState.buttons}] · 新建弹层[${createModal.input}]`;
  });

  await run('个性化：主题 / 壁纸 / 自定义主题', async () => {
    const call = async <T,>(method: string, args: unknown): Promise<T> => {
      const result = await env.ipc.call('core', method, args, { kind: 'panel', webContentsId: -1 });
      if (!result.ok) throw new Error(result.error?.message ?? `${method} 调用失败`);
      return result.data as T;
    };
    const before = env.settings.get().appearance;
    const applied = await call<{ appearance: { accent: string; wallpaper: string } }>('themes.apply', {
      id: 'deep-sea',
    });
    if (applied.appearance.wallpaper !== 'builtin:ocean') throw new Error('主题未写入壁纸选择器');
    await wait(300);
    const current = await call<{ url?: string; selector?: string } | null>('wallpapers.current', {});
    if (!current?.url?.startsWith('tk://file/')) throw new Error('壁纸 URL 未解析');
    const list = await call<Array<{ source: string }>>('wallpapers.list', {});
    if (list.filter((item) => item.source === 'builtin').length < 6) throw new Error('内置壁纸不足 6 张');
    // 真实 HTTP 下载链路（本地临时服务器，避免外网依赖）
    const server = http.createServer((_req, res) => {
      const file = path.join(env.paths.resourcesDir, 'wallpapers', 'ocean.jpg');
      const data = fs.readFileSync(file);
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(data.length) });
      res.end(data);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    let downloadedInfo = '';
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const downloaded = await call<{ id: string; selector: string; source: string }>('wallpapers.download', {
        url: `http://127.0.0.1:${port}/ocean.jpg`,
        name: '冒烟下载',
      });
      if (downloaded.source !== 'user') throw new Error('下载壁纸未进入用户目录');
      await call('wallpapers.apply', { selector: downloaded.selector, opacity: 0.36 });
      const appliedCurrent = await call<{ selector?: string } | null>('wallpapers.current', {});
      if (appliedCurrent?.selector !== downloaded.selector) throw new Error('下载壁纸应用失败');
      const afterRemove = await call<Array<{ selector: string }>>('wallpapers.remove', {
        selector: downloaded.selector,
      });
      if (afterRemove.some((item) => item.selector === downloaded.selector)) throw new Error('下载壁纸删除失败');
      downloadedInfo = `下载 ${downloaded.selector} → 应用 → 删除`;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // 回到内置深海壁纸，便于后续截图
    await call('wallpapers.apply', { selector: 'builtin:ocean', opacity: 0.42 });
    env.windows.openPanel();
    await wait(700);
    const wallpaperLayer = (await env.windows.panel?.webContents.executeJavaScript(
      "!!document.querySelector('.panel-wallpaper')"
    )) as boolean;
    if (!wallpaperLayer) throw new Error('主面板未渲染壁纸层');
    const themeShot = await env.windows.panel?.webContents.capturePage();
    if (themeShot) fs.writeFileSync(path.join(outDir, '20-panel-wallpaper.png'), themeShot.toPNG());
    env.settingsWindow.open('personalize');
    await wait(900);
    const settingsWin = env.settingsWindow.win;
    const appliedShot = await settingsWin?.webContents.capturePage();
    if (appliedShot) fs.writeFileSync(path.join(outDir, '21-personalize-applied.png'), appliedShot.toPNG());
    env.settingsWindow.close();
    // 自定义主题：保存 → 出现在列表 → 删除
    const saved = await call<Array<{ id: string; name: string; builtin: boolean }>>('themes.save', {
      name: '冒烟主题',
      tokens: {
        accent: '#FFB454',
        panelOpacity: 0.82,
        blur: true,
        animation: 'full',
        wallpaper: 'builtin:dusk',
        wallpaperOpacity: 0.4,
        ballEdgeHide: true,
        showDock: true,
      },
    });
    const custom = saved.find((theme) => theme.name === '冒烟主题');
    if (!custom || custom.builtin) throw new Error('自定义主题未保存');
    const afterDelete = await call<Array<{ id: string }>>('themes.delete', { id: custom.id });
    if (afterDelete.some((theme) => theme.id === custom.id)) throw new Error('自定义主题未删除');
    env.settings.patch({ appearance: before });
    await wait(400);
    env.windows.hidePanelImmediate();
    return `主题 → ${applied.appearance.accent} · 壁纸 ${current.selector} · 内置 ${list.length} 张 · ${downloadedInfo} · 自定义主题增删`;
  });

  await run('UI 编辑器工作台', async () => {
    let project;
    try {
      project = await env.uieditor.create({ templateId: 'dashboard' });
    } catch {
      project = await env.uieditor.create({ templateId: 'blank' });
    }
    project.name = '冒烟设计';
    await env.uieditor.save(project);
    env.uieditorWindow.open(project.id);
    await wait(2800);
    const win = env.uieditorWindow.win;
    if (!win || win.isDestroyed()) throw new Error('UI 编辑器窗口未创建');
    const state = (await win.webContents.executeJavaScript(`(() => ({
      app: !!document.querySelector('.ue-app'),
      toolbar: !!document.querySelector('.ue-toolbar'),
      workbench: !!document.querySelector('.ue-workbench'),
      status: !!document.querySelector('.ue-statusbar'),
      panels: document.querySelectorAll('.ue-panel-tab, .up-tab, [role="tab"]').length,
      title: document.querySelector('.ue-name-button')?.textContent ?? '',
      nodes: document.querySelectorAll('[data-node-id]').length,
      canvasNodes: document.querySelectorAll('.uc-node').length,
      sample: Array.from(document.querySelectorAll('.uc-node')).slice(0, 6).map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { cls: el.className, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height), opacity: style.opacity, display: style.display, visibility: style.visibility };
      }),
    }))()`)) as { app: boolean; toolbar: boolean; workbench: boolean; status: boolean; panels: number; title: string; nodes: number; canvasNodes: number; sample: unknown[] };
    if (!state.app || !state.toolbar || !state.workbench) throw new Error('UI 编辑器外壳未渲染');
    if (!state.title.includes('冒烟设计')) throw new Error(`工程名称未加载：${state.title}`);
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '30-ui-editor.png'), shot.toPNG());
    // 工程库
    await win.webContents.executeJavaScript(
      "(() => { const button = document.querySelector('button[title=\"工程库\"]'); button?.click(); return !!button; })()"
    );
    await wait(650);
    const projectsState = (await win.webContents.executeJavaScript(`(() => ({
      modal: !!document.querySelector('.ue-project-modal'),
      cards: document.querySelectorAll('.ue-project-card').length,
    }))()`)) as { modal: boolean; cards: number };
    if (!projectsState.modal) throw new Error('工程库未打开');
    const projectsShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '33-ui-projects.png'), projectsShot.toPNG());
    await win.webContents.executeJavaScript(
      "(() => { const close = document.querySelector('.ue-project-modal .ue-icon-btn[title=\"关闭\"]'); close?.click(); return !!close; })()"
    );
    await wait(250);
    // 切到预览模式并截图
    await win.webContents.executeJavaScript(
      "(() => { const buttons = Array.from(document.querySelectorAll('.ue-mode')); const preview = buttons.find((b) => b.textContent.includes('预览')); preview?.click(); return !!preview; })()"
    );
    await wait(800);
    const previewShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '31-ui-editor-preview.png'), previewShot.toPNG());
    env.uieditorWindow.close();
    await wait(300);
    const list = await env.uieditor.list();
    if (!list.some((item) => item.name === '冒烟设计')) throw new Error('工程未落盘');
    // 导出独立 HTML，并用真实 BrowserWindow 打开验证
    const html = exportStandaloneHtml(project, { title: '冒烟导出' });
    const htmlPath = path.join(outDir, 'ui-export-smoke.html');
    fs.writeFileSync(htmlPath, html, 'utf8');
    const exportWin = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      backgroundColor: '#05070c',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    let exportScreens = 0;
    try {
      await exportWin.loadFile(htmlPath);
      await wait(450);
      exportScreens = (await exportWin.webContents.executeJavaScript(
        "document.querySelectorAll('.uis-screen').length"
      )) as number;
      if (!exportScreens) throw new Error('导出 HTML 未渲染屏幕');
      const exportShot = await exportWin.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, '32-ui-export-html.png'), exportShot.toPNG());
    } finally {
      if (!exportWin.isDestroyed()) exportWin.destroy();
    }
    // 发布为应用内插件并确认出现在插件列表
    const published = await env.uieditor.publishPlugin(project);
    if (!published.ok || !published.pluginId) throw new Error(published.error || '发布插件失败');
    const publishedPlugin = env.plugins.list().find((plugin) => plugin.id === published.pluginId);
    if (!publishedPlugin) throw new Error('发布后插件未出现在列表');
    // 首页卡片入口：点击 UI 编辑器卡片应打开编辑器窗口
    env.windows.openPanel();
    await wait(700);
    const clickedCard = (await env.windows.panel?.webContents.executeJavaScript(
      "(() => { const card = document.querySelector('.studio-card'); card?.click(); return !!card; })()"
    )) as boolean;
    if (!clickedCard) throw new Error('首页 UI 编辑器卡片未找到');
    await wait(1700);
    if (!env.uieditorWindow.win?.isVisible()) throw new Error('首页卡片未打开 UI 编辑器');
    env.uieditorWindow.close();
    await wait(300);
    return `${state.title} · 画布 ${state.canvasNodes} 节点 · 工程 ${list.length} 个/${projectsState.cards} 卡片 · 导出 HTML ${Math.round(html.length / 1024)}KB/${exportScreens} 屏 · 发布插件 ${published.pluginId}`;
  });

  await run('悬浮球点击打开面板', async () => {
    await env.windows.hidePanelImmediate();
    await wait(500);
    const ball = env.windows.ball;
    if (!ball) throw new Error('悬浮球窗口不存在');
    const bounds = ball.getBounds();
    const x = Math.round(bounds.width / 2);
    const y = Math.round(bounds.height / 2);
    ball.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    ball.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await wait(900);
    if (!env.windows.isPanelOpen) throw new Error('点击悬浮球后面板未打开');
    return '点击 → 面板打开';
  });

  await run('悬浮球贴边半隐藏', async () => {
    const ball = env.windows.ball;
    if (!ball) throw new Error('悬浮球不存在');
    await env.windows.hidePanelImmediate();
    await wait(350);
    env.windows.setBallDock('right', false);
    await wait(350);
    const docked = ball.getBounds();
    const area = screen.getDisplayMatching(docked).workArea;
    const visible = area.x + area.width - docked.x;
    if (visible > 40) throw new Error(`半隐藏后露出过宽：${visible}px`);
    const dockedShot = await ball.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '18-ball-docked.png'), dockedShot.toPNG());
    await ball.webContents.executeJavaScript(
      "(() => { const el = document.querySelector('.ball-root'); el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); return true; })()"
    );
    await wait(600);
    const popped = ball.getBounds();
    if (popped.x >= docked.x - 20) throw new Error(`悬停后未弹出：docked.x=${docked.x} popped.x=${popped.x}`);
    const poppedShot = await ball.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '19-ball-popped.png'), poppedShot.toPNG());
    await ball.webContents.executeJavaScript(
      "(() => { const el = document.querySelector('.ball-root'); el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); return true; })()"
    );
    await wait(2400);
    const reDocked = ball.getBounds();
    if (Math.abs(reDocked.x - docked.x) > 6) throw new Error(`离开后未重新隐藏：${reDocked.x} vs ${docked.x}`);
    env.windows.setBallDock(null, false);
    await wait(250);
    return `露出 ${visible}px · hover 弹出 x=${popped.x} · 离开后回到 x=${reDocked.x}`;
  });

  await run('overlay 框选基础能力', async () => {
    try {
    const promise = env.overlay.pickRegion({ hint: 'E2E 框选' });
    let overlays: ReturnType<typeof findWindows> = [];
    for (let i = 0; i < 60 && overlays.length === 0; i += 1) {
      await wait(120);
      overlays = findWindows('overlay.html');
    }
    if (!overlays.length) {
      env.overlay.finish(null);
      throw new Error('未创建 overlay 窗口');
    }
    const overlay = overlays[0];
    while (overlay.webContents.isLoading()) await wait(80);
    await wait(250);
    const overlaySize = overlay.getContentSize();
    if (overlaySize[1] < 800) {
      env.logger.warn('[test] overlay 视口偏小', overlaySize.join('x'));
    }
    const beforeShot = await overlay.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '16-overlay-before.png'), beforeShot.toPNG());
    const diagnostics = (await overlay.webContents.executeJavaScript(`(() => {
      const fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true
      }));
      fire('pointermove', 260, 200);
      fire('pointerdown', 260, 200);
      fire('pointermove', 760, 560);
      const selection = document.querySelector('.selection');
      return {
        ready: document.readyState,
        hint: document.querySelector('.overlay-hint')?.textContent?.trim().slice(0, 20) || '',
        selectionHidden: selection ? selection.hidden : null,
        selectionWidth: selection ? selection.style.width : '',
        selectionHeight: selection ? selection.style.height : '',
      };
    })()`)) as Record<string, unknown>;
    const midShot = await overlay.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '17-overlay-selecting.png'), midShot.toPNG());
    await overlay.webContents.executeJavaScript(`(() => {
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0,
        clientX: 760, clientY: 560, pointerId: 1, pointerType: 'mouse', isPrimary: true
      }));
      return true;
    })()`).catch(() => undefined);
    env.logger.info('[test] overlay 诊断', JSON.stringify(diagnostics));
    let result: Awaited<ReturnType<typeof env.overlay.pickRegion>> = null;
    try {
      result = await withTimeout(promise, 8000, 'overlay 框选');
    } catch (err) {
      env.overlay.finish(null);
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}（诊断：${JSON.stringify(diagnostics)}）`
      );
    }
    if (!result) throw new Error(`框选返回 null（诊断：${JSON.stringify(diagnostics)}）`);
    return `${result.rect.x},${result.rect.y} ${result.rect.width}x${result.rect.height} display=${result.displayId}`;
    } catch (err) {
      env.overlay.finish(null);
      throw err;
    }
  });

  await run('区域截图 E2E（框选遮罩 + 裁剪落盘）', async () => {
    const startedAt = Date.now();
    const command = env.plugins.runCommand('screenshot.region');
    const guarded = withTimeout(command, 15000, '区域截图');
    try {
      let overlays: ReturnType<typeof findWindows> = [];
      for (let i = 0; i < 60 && overlays.length === 0; i += 1) {
        await wait(120);
        overlays = findWindows('overlay.html');
      }
      if (!overlays.length) throw new Error('未创建区域框选遮罩窗口');
      const overlay = overlays[0];
      while (overlay.webContents.isLoading()) await wait(80);
      await wait(350);
      // 通过合成 PointerEvent 驱动遮罩渲染层（与真实鼠标事件走同一套监听逻辑）
      await overlay.webContents.executeJavaScript(`(() => {
        const fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
          clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true
        }));
        fire('pointermove', 300, 220);
        fire('pointerdown', 300, 220);
        fire('pointermove', 840, 640);
        fire('pointerup', 840, 640);
        return true;
      })()`);
      await guarded;
      const last = (await env.plugins.call('screenshot', 'last', undefined, {
        kind: 'panel',
        webContentsId: -1,
      })) as { path?: string; width?: number; height?: number; at?: number } | null;
      if (!last?.path || !fs.existsSync(last.path)) throw new Error('框选后未生成截图文件');
      const stat = fs.statSync(last.path);
      if (stat.mtimeMs < startedAt - 1000) throw new Error('截图结果是旧文件，未真正执行新截图');
      fs.copyFileSync(last.path, path.join(outDir, '11-region-capture.png'));
      return `${last.width}x${last.height} · ${path.basename(last.path)}`;
    } catch (err) {
      env.overlay.finish(null);
      throw err;
    }
  });

  await run('录制插件 E2E（指示器 + mp4）', async () => {
    const before = env.settings.get();
    env.settings.patch({ recorder: { countdown: 0 } });
    await env.plugins.runCommand('recorder.toggle');
    await wait(2200);
    const indicators = findWindows('indicator.html');
    if (!indicators.length) throw new Error('录制时未打开指示器窗口');
    const indicatorShot = await indicators[0].webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '12-recorder-indicator.png'), indicatorShot.toPNG());
    await wait(1600);
    await env.plugins.runCommand('recorder.toggle');
    await wait(1200);
    env.settings.patch({ recorder: { countdown: before.recorder.countdown } });
    const last = (await env.plugins.call('recorder', 'lastResult', undefined, {
      kind: 'panel',
      webContentsId: -1,
    })) as { path?: string; durationMs?: number; sizeBytes?: number } | null;
    if (!last?.path || !fs.existsSync(last.path)) throw new Error('录制结束后未生成文件');
    const stat = fs.statSync(last.path);
    if (stat.size < 15_000) throw new Error(`录制文件异常小：${stat.size}`);
    if (indicators.some((win) => !win.isDestroyed() && win.isVisible())) {
      throw new Error('录制结束后指示器未关闭');
    }
    fs.copyFileSync(last.path, path.join(outDir, `13-recording.${path.extname(last.path).slice(1)}`));
    return `${path.basename(last.path)} · ${Math.round(stat.size / 1024)}KB`;
  });

  await run('计时器迷你窗 E2E', async () => {
    await env.plugins.runCommand('timer.toggle');
    await wait(1500);
    const minis = findWindows('mini.html');
    if (!minis.length) throw new Error('计时器开始后未创建桌面迷你窗');
    const miniShot = await minis[0].webContents.capturePage();
    fs.writeFileSync(path.join(outDir, '14-timer-mini.png'), miniShot.toPNG());
    const desktop = await env.media.captureFullscreen({ hidePanel: false, copy: false });
    fs.copyFileSync(desktop.path, path.join(outDir, '15-timer-desktop.png'));
    await env.plugins.runCommand('timer.toggle');
    await wait(400);
    minis[0].close();
    await wait(600);
    if (findWindows('mini.html').some((win) => win.isVisible())) throw new Error('迷你窗未隐藏');
    await env.plugins.runCommand('timer.reset');
    return '迷你窗创建 / 桌面显示 / 隐藏 / 重置';
  });

  await run('编辑器文件自由化', async () => {
    await env.plugins.createPlugin({ id: 'file-demo', name: '文件演示' });
    const created = await env.plugins.createFile('file-demo', 'lib/extra.js', 'export const extra = 1;\n');
    if (!created.ok) throw new Error(created.error?.message || '新建文件失败');
    const withFile = await env.plugins.files('file-demo');
    if (!withFile.files.some((file) => file.path === 'lib/extra.js')) throw new Error('新建文件未出现在列表');
    const removed = await env.plugins.deleteFile('file-demo', 'main.js');
    if (!removed.ok) throw new Error(removed.error?.message || '删除文件失败');
    const afterDelete = await env.plugins.files('file-demo');
    if (!afterDelete.deletedFiles?.includes('main.js')) throw new Error('删除基座文件后未产生墓碑');
    const restored = await env.plugins.restoreDeletedFile('file-demo', 'main.js');
    if (!restored.ok) throw new Error(restored.error?.message || '恢复文件失败');
    const afterRestore = await env.plugins.files('file-demo');
    if (afterRestore.deletedFiles?.includes('main.js')) throw new Error('恢复后墓碑未清理');
    await env.plugins.deletePlugin('file-demo');
    return '新建 lib/extra.js · 删除 main.js 墓碑 · 恢复成功';
  });

  await run('插件编辑 + 热重载', async () => {
    await env.plugins.createPlugin({ id: 'smoke-demo', name: '冒烟示例' });
    const write = await env.plugins.writeFile(
      'smoke-demo',
      'main.js',
      `/** smoke */\nexport default {\n  activate(ctx) {\n    ctx.ipc.handle('ping', async () => 'pong-v2');\n  },\n  deactivate() {}\n};\n`
    );
    if (!write.ok) throw new Error(write.error?.message || '写入失败');
    await wait(300);
    const pong = await env.plugins.call('smoke-demo', 'ping', {}, { kind: 'panel', webContentsId: -1 });
    if (pong !== 'pong-v2') throw new Error(`热重载后调用异常：${String(pong)}`);
    await env.plugins.deletePlugin('smoke-demo');
    if (env.plugins.list().some((plugin) => plugin.id === 'smoke-demo')) throw new Error('删除插件失败');
    return '新建 → 覆盖保存 → 热重载 → 调用 → 删除';
  });

  await run('区域框选遮罩', async () => {
    if (env.overlay.active) throw new Error('overlay 仍处于激活状态');
    return 'overlay 管理器就绪且已通过 E2E';
  });

  env.windows.openPanel();
  await wait(300);
  writeReport();

  env.logger.info('[test] 冒烟测试完成');
  const failed = results.filter((r) => !r.ok);
  if (process.env.TK_TEST_KEEP_OPEN !== '1') {
    setTimeout(() => env.app.quit(), 800);
  }
  if (failed.length) env.logger.warn(`[test] 失败 ${failed.length} 项`);
}













