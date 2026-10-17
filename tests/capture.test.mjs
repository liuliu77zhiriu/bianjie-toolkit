/**
 * 截图 / 录屏模块单测（capture-dev）。
 *
 * 纯逻辑（命名 / DPI 换算 / 码率 / MIME / 状态机）用 node:test 直接覆盖；
 * 插件后端用假 ctx 驱动，验证 IPC 契约、命令注册与异常兜底。
 *
 * 运行：node --test tests/capture.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureFileName,
  recordingFileName,
  formatStamp,
  clampRect,
  computePixelCrop,
  fitPreviewSize,
  normalizeFps,
  normalizeQuality,
  normalizeCountdown,
  normalizeAudio,
  videoBitrate,
  mimeCandidates,
  extFromMime,
  formatDuration,
  formatBytes,
  needsMic,
  needsSystemAudio,
} from '../src/main/core/media/geometry.ts';

import screenshotPlugin from '../resources/plugins/screenshot/main.js';
import recorderPlugin from '../resources/plugins/recorder/main.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function pluginFile(id, file) {
  return fs.readFileSync(path.join(ROOT, 'resources', 'plugins', id, file), 'utf8');
}

/** 静态检查：app.js 里 $('id') 引用的元素必须在 HTML 中存在。 */
function assertIdsExist(html, script, label) {
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g)).map((match) => match[1]));
  const refs = Array.from(script.matchAll(/\$\('([^']+)'\)/g)).map((match) => match[1]);
  const missing = Array.from(new Set(refs.filter((ref) => !ids.has(ref))));
  assert.deepEqual(missing, [], `${label} 缺少元素 id：${missing.join(', ')}`);
}

/** 静态检查：插件 UI 必须引用主题/ SDK，且 CSP 允许 tk: 资源。 */
function assertPluginPage(html, label) {
  assert.match(html, /tk:\/\/plugin-sdk\/theme\.css/, `${label} 缺少 theme.css`);
  assert.match(html, /tk:\/\/plugin-sdk\/sdk\.js/, `${label} 缺少 sdk.js`);
  assert.match(html, /Content-Security-Policy/i, `${label} 缺少 CSP`);
  const csp = (html.match(/content="([^"]*Content-Security-Policy[^"]*)"/i) || html.match(/content="([^"]+)"/i))?.[1] || '';
  assert.ok(csp.includes('tk:'), `${label} CSP 未允许 tk:`);
  assert.match(html, /<script[^>]+src="app\.js"[^>]*type="module"/, `${label} 未以 module 方式加载 app.js`);
}

/* ================================================================== 纯函数 */

test('截图命名：截图_yyyyMMdd_HHmmss_SSS.格式', () => {
  const date = new Date(2025, 0, 2, 3, 4, 5, 6);
  assert.equal(formatStamp(date), '20250102_030405_006');
  assert.equal(captureFileName('png', date), '截图_20250102_030405_006.png');
  assert.equal(captureFileName('jpg', date), '截图_20250102_030405_006.jpg');
  assert.match(captureFileName('png'), /^截图_\d{8}_\d{6}_\d{3}\.png$/);
});

test('录制命名：录制_yyyyMMdd_HHmmss_SSS.格式', () => {
  const date = new Date(2025, 11, 31, 23, 59, 58, 9);
  assert.equal(recordingFileName('mp4', date), '录制_20251231_235958_009.mp4');
  assert.equal(recordingFileName('webm', date), '录制_20251231_235958_009.webm');
});

test('clampRect 把选区限制在显示器内', () => {
  const bounds = { width: 1536, height: 864 };
  assert.deepEqual(clampRect({ x: -20, y: -10, width: 100, height: 50 }, bounds), {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
  });
  assert.deepEqual(clampRect({ x: 1500, y: 800, width: 200, height: 200 }, bounds), {
    x: 1500,
    y: 800,
    width: 36,
    height: 64,
  });
  assert.equal(clampRect({ x: 10, y: 10, width: 0, height: 0 }, bounds).width, 1);
});

test('computePixelCrop：125% DPI 下 DIP → 物理像素', () => {
  const display = { width: 1536, height: 864 };
  const image = { width: 1920, height: 1080 };
  assert.deepEqual(computePixelCrop({ x: 100, y: 100, width: 200, height: 100 }, display, image), {
    x: 125,
    y: 125,
    width: 250,
    height: 125,
  });
  // 右下角选区不越界
  const edge = computePixelCrop({ x: 1500, y: 800, width: 200, height: 200 }, display, image);
  assert.equal(edge.x + edge.width <= 1920, true);
  assert.equal(edge.y + edge.height <= 1080, true);
});

test('computePixelCrop：缩略图被系统缩小 / 放大时按实际比例换算', () => {
  const display = { width: 1536, height: 864 };
  const small = { width: 960, height: 540 }; // 0.625 倍
  assert.deepEqual(computePixelCrop({ x: 100, y: 100, width: 200, height: 100 }, display, small), {
    x: 63,
    y: 63,
    width: 125,
    height: 62,
  });
  const big = { width: 3840, height: 2160 }; // 2.5 倍
  assert.deepEqual(computePixelCrop({ x: 100, y: 100, width: 200, height: 100 }, display, big), {
    x: 250,
    y: 250,
    width: 500,
    height: 250,
  });
});

test('fitPreviewSize：最长边不超过 480 且保持比例', () => {
  assert.deepEqual(fitPreviewSize({ width: 3840, height: 2160 }), { width: 480, height: 270 });
  assert.deepEqual(fitPreviewSize({ width: 1080, height: 3840 }), { width: 135, height: 480 });
  assert.deepEqual(fitPreviewSize({ width: 320, height: 200 }), { width: 320, height: 200 });
});

test('参数归一化：帧率 / 画质 / 倒计时 / 音频', () => {
  assert.equal(normalizeFps(60), 60);
  assert.equal(normalizeFps(25, 30), 30);
  assert.equal(normalizeQuality(120), 100);
  assert.equal(normalizeQuality(-10), 1);
  assert.equal(normalizeQuality('abc', 85), 85);
  assert.equal(normalizeCountdown(99), 10);
  assert.equal(normalizeCountdown(-3), 0);
  assert.equal(normalizeAudio('mic'), 'mic');
  assert.equal(normalizeAudio('bogus', 'system'), 'system');
  assert.equal(needsSystemAudio('system+mic'), true);
  assert.equal(needsSystemAudio('mic'), false);
  assert.equal(needsMic('system'), false);
  assert.equal(needsMic('system+mic'), true);
});

test('videoBitrate：随分辨率 / 画质增长并限制上下界', () => {
  const base = videoBitrate({ width: 1920, height: 1080, fps: 30, quality: 85 });
  assert.ok(base >= 2_000_000 && base <= 12_000_000, `base=${base}`);
  const higher = videoBitrate({ width: 1920, height: 1080, fps: 30, quality: 100 });
  assert.ok(higher > base);
  const fourK = videoBitrate({ width: 3840, height: 2160, fps: 60, quality: 90 });
  assert.ok(fourK > base);
  assert.ok(fourK <= 30_000_000);
  const tiny = videoBitrate({ width: 320, height: 180, fps: 24, quality: 1 });
  assert.ok(tiny >= 300_000);
});

test('MIME 候选：优先 MP4/H.264，回退 WebM', () => {
  const autoAudio = mimeCandidates('auto', true);
  assert.match(autoAudio[0], /^video\/mp4/);
  assert.ok(autoAudio[0].includes('mp4a.40.2'));
  assert.ok(autoAudio.some((mime) => mime.includes('webm')));

  const noAudio = mimeCandidates('auto', false);
  assert.ok(noAudio.some((mime) => mime.startsWith('video/mp4')));
  assert.ok(!noAudio.some((mime) => mime.includes('mp4a')));

  const webmOnly = mimeCandidates('webm', true);
  assert.ok(webmOnly.every((mime) => mime.includes('webm')));

  assert.equal(extFromMime('video/mp4;codecs=avc1.42E01E,mp4a.40.2'), 'mp4');
  assert.equal(extFromMime('video/webm;codecs=vp9,opus'), 'webm');
});

test('时长与体积格式化', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(65_000), '01:05');
  assert.equal(formatDuration(3_725_000), '01:02:05');
  assert.equal(formatBytes(800), '800 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), '2.50 GB');
});

/* ================================================================== 假 ctx */

function createSettings(overrides = {}) {
  return {
    version: 1,
    general: { launchAtLogin: false, showBall: true, closePanelOnBlur: false, rememberPanelSize: false },
    appearance: {
      accent: '#4C8DFF',
      panelOpacity: 0.86,
      blur: true,
      animation: 'full',
      ballSize: 56,
      ballOpacity: 1,
      ballAutoHide: true,
      ballEdgeSnap: true,
      alwaysOnTop: false,
      showDock: true,
    },
    shortcuts: {
      togglePanel: 'Alt+Space',
      screenshotRegion: 'Alt+A',
      screenshotFull: 'Alt+S',
      recordToggle: 'Alt+R',
      memo: 'Alt+M',
    },
    capture: {
      saveDir: '',
      format: 'png',
      copyToClipboard: true,
      showPanelAfter: true,
      playSound: false,
    },
    recorder: {
      saveDir: '',
      fps: 30,
      quality: 85,
      audio: 'system',
      countdown: 3,
      format: 'auto',
      maxDurationMin: 0,
    },
    data: { autoBackup: true, backupKeepDays: 14 },
    plugins: { disabled: [] },
    ...overrides,
  };
}

function createCtx(options = {}) {
  const handlers = new Map();
  const commands = [];
  const broadcasts = [];
  const windows = [];
  const notifications = [];
  const panelCalls = { show: [], close: 0 };
  const shellCalls = [];
  const clipboardCalls = [];
  const storeData = new Map(Object.entries(options.store || {}));
  const state = { panelOpen: options.panelOpen ?? false, stateListener: null, unsubCount: 0 };

  const settings = createSettings(options.settings || {});

  const media = {
    listSources: async () => options.sources ?? [],
    captureFullscreen: async () => options.capture ?? null,
    captureRegion: async () => options.capture ?? null,
    captureWindow: async () => options.capture ?? null,
    startRecording: async () => ({ id: 'rec-test' }),
    stopRecording: async () => ({
      path: 'C:/recordings/录制_test.mp4',
      durationMs: 1234,
      sizeBytes: 56789,
      format: 'mp4',
    }),
    cancelRecording: async () => {},
    getRecordingState: async () => null,
    onState: (cb) => {
      state.stateListener = cb;
      return () => {
        state.unsubCount += 1;
      };
    },
    ...(options.media || {}),
  };

  const ctx = {
    plugin: { id: options.pluginId || 'test', name: 'test', version: '1.0.0', dir: '', dataDir: '' },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    paths: { userData: '', screenshots: '', recordings: '', logs: '', plugins: '', overrides: '', backups: '' },
    store: {
      get: (key, fallback) => (storeData.has(key) ? storeData.get(key) : fallback),
      set: (key, value) => {
        storeData.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        storeData.delete(key);
        return Promise.resolve();
      },
      all: () => Object.fromEntries(storeData),
      clear: () => storeData.clear(),
    },
    ipc: {
      handle: (method, fn) => handlers.set(method, fn),
      unhandle: (method) => handlers.delete(method),
    },
    events: {
      broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
      on: () => () => {},
    },
    commands: {
      register: (def) => {
        commands.push(def);
        return () => {};
      },
      run: async () => null,
    },
    windows: {
      open: async (opts) => {
        windows.push({ action: 'open', opts });
        return { key: opts.key, id: 1 };
      },
      close: (key) => windows.push({ action: 'close', key }),
      send: () => {},
      exists: () => false,
      list: () => [],
    },
    overlay: {
      pickRegion: async () => options.pickRegion ?? null,
    },
    panel: {
      show: (id) => panelCalls.show.push(id),
      close: () => {
        panelCalls.close += 1;
      },
      isOpen: () => state.panelOpen,
    },
    dialogs: { save: async () => ({}), open: async () => ({}), directory: async () => '' },
    shell: {
      openPath: async (target) => shellCalls.push(['openPath', target]),
      showItemInFolder: (target) => shellCalls.push(['showItemInFolder', target]),
      openExternal: async () => {},
    },
    clipboard: {
      writeText: (text) => clipboardCalls.push(['text', text]),
      writeImage: (file) => clipboardCalls.push(['image', file]),
    },
    notifications: { show: (opts) => notifications.push(opts) },
    app: {
      version: '1.0.0',
      name: '便捷工具',
      locale: 'zh-CN',
      platform: 'win32',
      isPackaged: false,
      quit() {},
      relaunch() {},
      setLoginItem() {},
    },
    electron: {},
    settings: {
      get: () => settings,
      get appearance() {
        return settings.appearance;
      },
      get capture() {
        return settings.capture;
      },
      get recorder() {
        return settings.recorder;
      },
    },
    media,
  };

  return {
    ctx,
    handlers,
    commands,
    broadcasts,
    windows,
    notifications,
    panelCalls,
    shellCalls,
    clipboardCalls,
    storeData,
    settings,
    state,
    media,
  };
}

function invoke(harness, method, args) {
  const handler = harness.handlers.get(method);
  assert.ok(handler, `应注册 IPC 方法 ${method}`);
  return handler(args, { kind: 'panel', webContentsId: 1 });
}

/* ================================================================== 截图插件 */

test('截图插件：注册 UI 方法与三条命令', () => {
  const harness = createCtx({ pluginId: 'screenshot' });
  screenshotPlugin.activate(harness.ctx);
  try {
    for (const method of ['last', 'sources', 'pending', 'region', 'full', 'window', 'copy', 'reveal']) {
      assert.ok(harness.handlers.has(method), `缺少 IPC：${method}`);
    }
    const ids = harness.commands.map((command) => command.id);
    assert.deepEqual(ids, ['screenshot.region', 'screenshot.full', 'screenshot.window']);
    const accel = Object.fromEntries(harness.commands.map((command) => [command.id, command.defaultAccelerator]));
    assert.equal(accel['screenshot.region'], 'Alt+A');
    assert.equal(accel['screenshot.full'], 'Alt+S');
  } finally {
    screenshotPlugin.deactivate();
  }
});

test('截图插件：区域截图 → 收面板 / 框选 / 裁剪 / 广播 / 回面板', async () => {
  const capture = {
    path: 'C:/pictures/截图_x.png',
    width: 250,
    height: 125,
    copied: true,
    preview: 'data:image/png;base64,AA',
    format: 'png',
  };
  const calls = [];
  const harness = createCtx({
    pluginId: 'screenshot',
    capture,
    pickRegion: { displayId: 'd1', rect: { x: 10, y: 20, width: 30, height: 40 }, scaleFactor: 1.25 },
    media: {
      captureRegion: async (options) => {
        calls.push(['captureRegion', options]);
        return capture;
      },
    },
  });
  const originalClose = harness.ctx.panel.close;
  harness.ctx.panel.close = () => {
    calls.push(['panel.close']);
    originalClose();
  };
  screenshotPlugin.activate(harness.ctx);
  try {
    const result = await invoke(harness, 'region', { fromUI: true });
    assert.deepEqual(result, capture);
    assert.equal(calls[0][0], 'panel.close', '应先收起面板');
    const captureCall = calls.find((entry) => entry[0] === 'captureRegion');
    assert.ok(captureCall, '应调用 media.captureRegion');
    assert.deepEqual(captureCall[1], {
      displayId: 'd1',
      rect: { x: 10, y: 20, width: 30, height: 40 },
      hidePanel: false,
    });
    assert.ok(harness.broadcasts.some((item) => item.topic === 'shot:done' && item.payload.path === capture.path));
    assert.ok(harness.panelCalls.show.includes('screenshot'), 'showPanelAfter 后应回到截图面板');
    assert.equal(harness.storeData.get('last').path, capture.path, '应记住最近截图');
  } finally {
    screenshotPlugin.deactivate();
  }
});

test('截图插件：取消框选静默返回 null，不截图', async () => {
  let captureCalls = 0;
  const harness = createCtx({
    pluginId: 'screenshot',
    pickRegion: null,
    capture: null,
    media: {
      captureRegion: async () => {
        captureCalls += 1;
        return null;
      },
    },
  });
  screenshotPlugin.activate(harness.ctx);
  try {
    const result = await invoke(harness, 'region', { fromUI: true });
    assert.equal(result, null);
    assert.equal(captureCalls, 0);
    assert.ok(!harness.broadcasts.some((item) => item.topic === 'shot:done'));
    assert.ok(harness.panelCalls.show.includes('screenshot'), 'UI 取消后应恢复面板');
    assert.equal(harness.notifications.length, 0, '取消不应提醒');
  } finally {
    screenshotPlugin.deactivate();
  }
});

test('截图插件：全屏 / 窗口截图参数传递与缺失来源校验', async () => {
  const capture = { path: 'C:/pictures/截图_y.png', width: 1920, height: 1080, copied: true, format: 'png' };
  const seen = [];
  const harness = createCtx({
    pluginId: 'screenshot',
    capture,
    media: {
      captureFullscreen: async (options) => {
        seen.push(['full', options]);
        return capture;
      },
      captureWindow: async (options) => {
        seen.push(['window', options]);
        return capture;
      },
    },
  });
  screenshotPlugin.activate(harness.ctx);
  try {
    const full = await invoke(harness, 'full', { displayId: 'display-2' });
    assert.equal(full.path, capture.path);
    assert.deepEqual(seen[0], ['full', { displayId: 'display-2', hidePanel: false }]);

    await assert.rejects(() => invoke(harness, 'window', {}), /请选择要截图的窗口/);
    const win = await invoke(harness, 'window', { sourceId: 'window:1:0' });
    assert.equal(win.path, capture.path);
    assert.deepEqual(seen[1], ['window', { sourceId: 'window:1:0', hidePanel: false }]);
  } finally {
    screenshotPlugin.deactivate();
  }
});

test('截图插件：截图异常时记录通知并抛出可读错误', async () => {
  const harness = createCtx({
    pluginId: 'screenshot',
    media: {
      captureFullscreen: async () => {
        throw new Error('系统拒绝屏幕捕获');
      },
    },
  });
  screenshotPlugin.activate(harness.ctx);
  try {
    await assert.rejects(() => invoke(harness, 'full', {}), /系统拒绝屏幕捕获/);
    assert.ok(harness.notifications.some((item) => item.title === '全屏截图失败'));
  } finally {
    screenshotPlugin.deactivate();
  }
});

/* ================================================================== 录屏插件 */

function activeState(overrides = {}) {
  return {
    id: 'rec-test',
    phase: 'recording',
    startedAt: Date.now() - 5000,
    durationMs: 5000,
    ...overrides,
  };
}

test('录屏插件：注册 UI 方法与 Alt+R 命令，激活后订阅媒体状态', () => {
  const harness = createCtx({ pluginId: 'recorder' });
  recorderPlugin.activate(harness.ctx);
  try {
    for (const method of ['sources', 'state', 'lastResult', 'start', 'stop', 'cancel', 'openFile', 'reveal']) {
      assert.ok(harness.handlers.has(method), `缺少 IPC：${method}`);
    }
    assert.equal(harness.commands.length, 1);
    assert.equal(harness.commands[0].id, 'recorder.toggle');
    assert.equal(harness.commands[0].defaultAccelerator, 'Alt+R');
    assert.equal(typeof harness.state.stateListener, 'function', '应订阅 ctx.media.onState');
  } finally {
    recorderPlugin.deactivate(harness.ctx);
  }
  assert.equal(harness.state.unsubCount, 1, 'deactivate 应取消订阅');
});

test('录屏插件：开始录制 → 收面板 / 校验来源 / 启动 / 打开指示器', async () => {
  const started = [];
  const harness = createCtx({
    pluginId: 'recorder',
    sources: [{ id: 'screen:0:0', name: '整个屏幕', kind: 'screen', displayId: 'd1', thumbnail: '' }],
    media: {
      startRecording: async (options) => {
        started.push(options);
        return { id: 'rec-1' };
      },
    },
  });
  recorderPlugin.activate(harness.ctx);
  try {
    const result = await invoke(harness, 'start', {
      sourceId: 'screen:0:0',
      kind: 'screen',
      displayId: 'd1',
      audio: 'system',
      fps: 60,
      quality: 90,
      countdown: 0,
    });
    assert.equal(result.id, 'rec-1');
    assert.equal(harness.panelCalls.close, 1, '开始录制前应收起面板');
    assert.equal(started.length, 1);
    assert.equal(started[0].sourceId, 'screen:0:0');
    assert.equal(started[0].kind, 'screen');
    assert.equal(started[0].fps, 60);
    assert.equal(started[0].quality, 90);
    assert.equal(started[0].countdown, 0);
    assert.equal(started[0].maxDurationSec, 0);
    assert.deepEqual(harness.storeData.get('lastSource'), {
      sourceId: 'screen:0:0',
      kind: 'screen',
      displayId: 'd1',
      name: '',
    });
    const indicator = harness.windows.find((item) => item.action === 'open');
    assert.ok(indicator, '应打开录制指示器');
    assert.equal(indicator.opts.key, 'indicator');
    assert.equal(indicator.opts.page, 'indicator.html');
    assert.equal(indicator.opts.width, 224);
    assert.equal(indicator.opts.height, 64);
    assert.equal(indicator.opts.alwaysOnTop, true);
    assert.equal(indicator.opts.position, 'top-right');
    assert.ok(harness.broadcasts.some((item) => item.topic === 'rec:started'));
  } finally {
    recorderPlugin.deactivate(harness.ctx);
  }
});

test('录屏插件：来源失效时给出可读错误', async () => {
  const harness = createCtx({
    pluginId: 'recorder',
    sources: [{ id: 'window:other', kind: 'window', name: '别的窗口', thumbnail: '' }],
  });
  recorderPlugin.activate(harness.ctx);
  try {
    await assert.rejects(
      () =>
        invoke(harness, 'start', {
          sourceId: 'window:closed',
          kind: 'window',
          audio: 'none',
          fps: 30,
          quality: 85,
          countdown: 0,
        }),
      /来源已关闭/
    );
  } finally {
    recorderPlugin.deactivate(harness.ctx);
  }
});

test('录屏插件：重复开始被拒绝；状态广播 → done 关闭指示器并展示结果', async () => {
  const harness = createCtx({ pluginId: 'recorder' });
  recorderPlugin.activate(harness.ctx);
  try {
    harness.state.stateListener(activeState());
    await assert.rejects(
      () =>
        invoke(harness, 'start', {
          sourceId: 'screen:0:0',
          kind: 'screen',
          audio: 'system',
          fps: 30,
          quality: 85,
          countdown: 0,
        }),
      /已有录制正在进行/
    );

    assert.ok(harness.broadcasts.some((item) => item.topic === 'rec:state' && item.payload.phase === 'recording'));

    harness.state.panelOpen = false;
    harness.state.stateListener(
      activeState({ phase: 'done', durationMs: 4321, path: 'C:/videos/录制_a.mp4', sizeBytes: 123456, format: 'mp4' })
    );
    const doneBroadcast = harness.broadcasts.find((item) => item.topic === 'rec:done');
    assert.ok(doneBroadcast, 'done 状态应广播 rec:done');
    assert.equal(doneBroadcast.payload.path, 'C:/videos/录制_a.mp4');
    assert.equal(doneBroadcast.payload.sizeBytes, 123456);
    assert.ok(harness.windows.some((item) => item.action === 'close' && item.key === 'indicator'));
    assert.ok(harness.panelCalls.show.includes('recorder'), '结束后应回到录屏面板展示结果');
    assert.ok(harness.notifications.some((item) => item.title === '录制完成'));
    assert.equal(harness.storeData.get('lastResult').path, 'C:/videos/录制_a.mp4');
  } finally {
    recorderPlugin.deactivate(harness.ctx);
  }
});

test('录屏插件：停止录制返回结果；失败状态广播可读错误', async () => {
  const harness = createCtx({ pluginId: 'recorder' });
  recorderPlugin.activate(harness.ctx);
  try {
    harness.state.stateListener(activeState());
    const result = await invoke(harness, 'stop');
    assert.equal(result.path, 'C:/recordings/录制_test.mp4');
    assert.equal(result.durationMs, 1234);
    assert.equal(harness.storeData.get('lastResult').path, 'C:/recordings/录制_test.mp4');

    harness.state.stateListener(activeState({ phase: 'error', error: '未捕获到任何画面数据' }));
    const errorBroadcast = harness.broadcasts.find((item) => item.topic === 'rec:error');
    assert.ok(errorBroadcast);
    assert.match(errorBroadcast.payload.message, /未捕获到任何画面数据/);
    assert.ok(harness.notifications.some((item) => item.title === '录制失败'));
  } finally {
    recorderPlugin.deactivate(harness.ctx);
  }
});

test('录屏插件：取消录制清理指示器并广播', async () => {
  const harness = createCtx({ pluginId: 'recorder' });
  let cancelCalls = 0;
  harness.ctx.media = {
    ...harness.ctx.media,
    cancelRecording: async () => {
      cancelCalls += 1;
    },
  };
  recorderPlugin.activate(harness.ctx);
  try {
    harness.state.stateListener(activeState());
    await invoke(harness, 'cancel');
    assert.equal(cancelCalls, 1);
    assert.ok(harness.broadcasts.some((item) => item.topic === 'rec:cancelled'));
    assert.ok(harness.windows.some((item) => item.action === 'close' && item.key === 'indicator'));
  } finally {
    recorderPlugin.deactivate(harness.ctx);
  }
});

test('录屏插件：Alt+R 命令用上次来源开始，录制中再次触发则停止', async () => {
  const started = [];
  let stopped = 0;
  const harness = createCtx({
    pluginId: 'recorder',
    store: {
      lastSource: { sourceId: 'screen:0:0', kind: 'screen', displayId: 'd1', name: '整个屏幕' },
    },
    sources: [{ id: 'screen:0:0', kind: 'screen', name: '整个屏幕', displayId: 'd1', thumbnail: '' }],
    media: {
      startRecording: async (options) => {
        started.push(options);
        return { id: 'rec-toggle' };
      },
      stopRecording: async () => {
        stopped += 1;
        return { path: 'C:/videos/录制_b.mp4', durationMs: 2000, sizeBytes: 2048, format: 'mp4' };
      },
    },
  });
  recorderPlugin.activate(harness.ctx);
  try {
    const command = harness.commands[0];
    const result = await command.run();
    assert.equal(result.id, 'rec-toggle');
    assert.equal(started.length, 1);
    assert.equal(started[0].sourceId, 'screen:0:0');
    assert.equal(started[0].audio, 'system', '默认使用设置里的音频来源');
    assert.equal(started[0].countdown, 3, '默认使用设置里的倒计时');

    harness.state.stateListener(activeState());
    const stoppedResult = await command.run();
    assert.equal(stopped, 1);
    assert.equal(stoppedResult.path, 'C:/videos/录制_b.mp4');
  } finally {
    recorderPlugin.deactivate(harness.ctx);
  }
});

test('录屏插件：无来源时命令给出通知而不是崩溃', async () => {
  const harness = createCtx({ pluginId: 'recorder', sources: [] });
  recorderPlugin.activate(harness.ctx);
  try {
    const result = await harness.commands[0].run();
    assert.equal(result, null);
    assert.ok(harness.notifications.some((item) => item.title === '录制操作失败'));
  } finally {
    recorderPlugin.deactivate(harness.ctx);
  }
});

test('插件 deactivate 幂等且清理命令', () => {
  const harness = createCtx({ pluginId: 'screenshot' });
  screenshotPlugin.activate(harness.ctx);
  screenshotPlugin.deactivate();
  screenshotPlugin.deactivate();
  assert.equal(harness.commands.length, 3);
});

/* ================================================================== 静态一致性 */

test('截图插件：清单 / UI / 元素 id / CSP 一致', () => {
  const manifest = JSON.parse(pluginFile('screenshot', 'plugin.json'));
  assert.equal(manifest.id, 'screenshot');
  assert.equal(manifest.name, '截图');
  assert.equal(manifest.entry, 'main.js');
  assert.equal(manifest.ui, 'index.html');
  const html = pluginFile('screenshot', 'index.html');
  const script = pluginFile('screenshot', 'app.js');
  assertPluginPage(html, '截图插件');
  assertIdsExist(html, script, '截图插件');
  for (const topic of ['shot:done', 'shot:pick-window', 'panel:shown', 'settings:changed']) {
    assert.ok(script.includes(`'${topic}'`), `截图 UI 缺少事件订阅：${topic}`);
  }
  for (const method of ['sources', 'region', 'full', 'window', 'copy', 'reveal', 'last', 'pending']) {
    assert.ok(script.includes(`invoke('${method}'`), `截图 UI 缺少后端方法调用：${method}`);
  }
});

test('录屏插件：清单 / UI / 元素 id / 指示器一致', () => {
  const manifest = JSON.parse(pluginFile('recorder', 'plugin.json'));
  assert.equal(manifest.id, 'recorder');
  assert.equal(manifest.name, '录屏');
  const html = pluginFile('recorder', 'index.html');
  const script = pluginFile('recorder', 'app.js');
  assertPluginPage(html, '录屏插件');
  assertIdsExist(html, script, '录屏插件');
  for (const topic of ['rec:state', 'rec:done', 'rec:error', 'rec:cancelled', 'panel:shown', 'panel:hidden']) {
    assert.ok(script.includes(`'${topic}'`), `录屏 UI 缺少事件订阅：${topic}`);
  }
  for (const method of ['sources', 'start', 'stop', 'state', 'lastResult', 'openFile', 'reveal']) {
    assert.ok(script.includes(`invoke('${method}'`), `录屏 UI 缺少后端方法调用：${method}`);
  }

  const indicatorHtml = pluginFile('recorder', 'indicator.html');
  const indicatorScript = pluginFile('recorder', 'indicator.js');
  const indicatorCss = pluginFile('recorder', 'indicator.css');
  assert.match(indicatorHtml, /tk:\/\/plugin-sdk\/theme\.css/);
  assert.match(indicatorHtml, /tk:\/\/plugin-sdk\/sdk\.js/);
  assert.match(indicatorHtml, /indicator\.css/);
  assert.match(indicatorCss, /-webkit-app-region:\s*drag/, '指示器需要可拖动区域');
  assert.match(indicatorCss, /-webkit-app-region:\s*no-drag/, '指示器按钮需禁止拖动');
  assertIdsExist(indicatorHtml, indicatorScript, '录制指示器');
  assert.ok(indicatorScript.includes("invoke('stop'"));
  assert.ok(indicatorScript.includes("invoke('cancel'"));
});

void sleep;
