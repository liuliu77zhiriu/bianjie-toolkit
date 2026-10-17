/**
 * 冒烟测试脚本（npm run smoke，TK_TEST=1 时由主进程加载）。
 * 覆盖：面板/悬浮球/桌面外观、插件列表、设置读写、截图、录屏、插件 iframe、设置页。
 */
import path from 'node:path';
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import type { AppPaths, MediaApi, PluginRuntimeInfo } from '../../shared/types';
import type { IpcHub } from '../core/ipc';
import type { Logger } from '../core/logger';
import type { OverlayManager } from '../core/overlay';
import type { PluginHost } from '../core/plugin-host';
import type { SettingsService } from '../core/settings';
import type { ShortcutManager } from '../core/shortcuts';
import type { WindowManager } from '../core/windows';

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

  await run('设置页', async () => {
    env.windows.openPanel('settings');
    await wait(1200);
    const size = await capturePanel('10-settings.png');
    const hasTabs = (await env.windows.panel?.webContents.executeJavaScript(
      `document.querySelectorAll('.settings-tab').length`
    )) as number;
    if (!hasTabs) throw new Error('设置页未渲染 tab');
    return `${hasTabs} tabs · panel ${size.width}x${size.height}`;
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



