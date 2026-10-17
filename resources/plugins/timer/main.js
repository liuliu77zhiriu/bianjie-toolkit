/* ============================================================
 * 计时器 · 后端插件模块（主进程，权威计时器）
 *
 * 设计要点：
 *   - 主进程 setInterval(200ms) 驱动，UI 只是显示器；关闭面板不影响计时
 *   - 状态持久化到 ctx.store('timer.state')，应用重启后安全暂停并保留已计时间
 *   - 运行中自动打开桌面迷你窗（hideOnClose=true，关闭只隐藏）
 *   - 倒计时结束：ctx.notifications.show + 广播 timer:finished
 *
 * IPC：
 *   timer.getState / start / pause / resume / reset / setMode / setDuration / lap / openMini
 * 事件（广播）：timer:tick { mode, phase, elapsedMs, remainingMs, durationMs, laps }
 *             timer:finished { mode, durationMs, at }
 * 命令：timer.toggle / timer.reset / timer.mini
 * ============================================================ */

const STATE_KEY = 'timer.state';
const TICK_INTERVAL_MS = 200;
const PERSIST_INTERVAL_MS = 2000;
const RESTORE_MAX_GAP_MS = 5000;
const DEFAULT_DURATION_MS = 25 * 60 * 1000;
const MIN_DURATION_MS = 50;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_LAPS = 200;

const MINI_WINDOW = {
  key: 'mini',
  page: 'mini.html',
  width: 236,
  height: 72,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  focusable: true,
  position: 'top-right',
  hideOnClose: true,
};

let ctxRef = null;
let state = null;
let tickHandle = null;
let lastPersistAt = 0;
let miniOpening = null;
let disposers = [];

function warn(message, detail) {
  try {
    if (ctxRef && ctxRef.log && typeof ctxRef.log.warn === 'function') ctxRef.log.warn(message, detail);
  } catch (_) {
    /* ignore */
  }
}

/**
 * 读取 store：
 *  - 文档契约：store.get(key, fallback)
 *  - 内核当前实现：JsonStore.get() 无参数，返回整个数据对象
 * 两种都兼容。
 */
function readStore(key, fallback) {
  const store = ctxRef && ctxRef.store;
  if (!store || typeof store.get !== 'function') return fallback;
  try {
    if (store.get.length === 0) {
      const all = store.get();
      if (all && typeof all === 'object' && Object.prototype.hasOwnProperty.call(all, key)) {
        return all[key];
      }
      if (all === undefined || all === null) {
        const value = store.get(key, fallback);
        return value === undefined ? fallback : value;
      }
      return fallback;
    }
    const value = store.get(key, fallback);
    return value === undefined ? fallback : value;
  } catch (err) {
    warn('读取存储失败：' + key, err);
    return fallback;
  }
}

function flushStore() {
  const store = ctxRef && ctxRef.store;
  if (!store || typeof store.flush !== 'function') return;
  try {
    store.flush();
  } catch (err) {
    warn('存储落盘失败', err);
  }
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampDuration(value) {
  const n = toNumber(value, NaN);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(n)));
}

function createState(mode) {
  const now = Date.now();
  return {
    mode: mode === 'countdown' ? 'countdown' : 'stopwatch',
    phase: 'idle', // idle | running | paused | finished
    elapsedMs: 0, // running 时为“本段开始前的累计值”
    durationMs: DEFAULT_DURATION_MS,
    laps: [],
    segmentStartedAt: null, // running 时本段开始时间戳
    savedAt: now,
    updatedAt: now,
  };
}

function currentElapsed(now) {
  if (!state) return 0;
  if (state.phase === 'running' && state.segmentStartedAt) {
    return state.elapsedMs + Math.max(0, now - state.segmentStartedAt);
  }
  return state.elapsedMs;
}

function publicState(now) {
  const at = typeof now === 'number' ? now : Date.now();
  const elapsedMs = Math.round(currentElapsed(at));
  const remainingMs =
    state.mode === 'countdown' ? Math.max(0, Math.round(state.durationMs - elapsedMs)) : null;
  return {
    mode: state.mode,
    phase: state.phase,
    elapsedMs,
    remainingMs,
    durationMs: state.durationMs,
    laps: state.laps.map((lap) => ({ ...lap })),
    savedAt: state.savedAt,
    updatedAt: state.updatedAt,
  };
}

function broadcast(topic, payload) {
  try {
    if (ctxRef && ctxRef.events && typeof ctxRef.events.broadcast === 'function') {
      ctxRef.events.broadcast(topic, payload);
    }
  } catch (err) {
    warn('广播失败：' + topic, err);
  }
}

function emitTick(now) {
  broadcast('timer:tick', publicState(now));
}

function persistState() {
  if (!ctxRef || !ctxRef.store || !state) return;
  const now = Date.now();
  state.savedAt = now;
  state.updatedAt = now;
  lastPersistAt = now;
  try {
    ctxRef.store.set(STATE_KEY, {
      mode: state.mode,
      phase: state.phase,
      elapsedMs: Math.round(currentElapsed(now)),
      durationMs: state.durationMs,
      laps: state.laps,
      savedAt: now,
      updatedAt: now,
    });
  } catch (err) {
    warn('计时状态持久化失败', err);
  }
}

function stopTicker() {
  if (tickHandle !== null) {
    try {
      clearInterval(tickHandle);
    } catch (err) {
      warn('清理计时器失败', err);
    }
    tickHandle = null;
  }
}

function ensureTicker() {
  if (tickHandle !== null) return;
  tickHandle = setInterval(onTick, TICK_INTERVAL_MS);
}

function formatDurationHuman(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes > 0) return seconds > 0 ? minutes + ' 分 ' + seconds + ' 秒' : minutes + ' 分钟';
  return seconds + ' 秒';
}

function openMini() {
  if (!ctxRef || !ctxRef.windows || typeof ctxRef.windows.open !== 'function') return;
  if (miniOpening) return;
  const owner = ctxRef;
  miniOpening = Promise.resolve()
    .then(() => owner.windows.open({ ...MINI_WINDOW }))
    .then(() => {
      // 窗口创建期间插件已停用：顺手关掉，避免残留孤儿窗口
      if (ctxRef !== owner) {
        try {
          owner.windows.close('mini');
        } catch (_) {
          /* ignore */
        }
      }
    })
    .catch((err) => {
      warn('迷你窗打开失败', err);
    })
    .then(() => {
      miniOpening = null;
    });
}

function closeMini() {
  if (!ctxRef || !ctxRef.windows || typeof ctxRef.windows.close !== 'function') return;
  try {
    const result = ctxRef.windows.close('mini');
    if (result && typeof result.catch === 'function') result.catch((err) => warn('迷你窗关闭失败', err));
  } catch (err) {
    warn('迷你窗关闭失败', err);
  }
}

/** 隐藏（而非销毁）迷你窗：保留窗口实例，重新显示时复用；渲染层 window.close() 是否会绕过 hideOnClose 因版本而异 */
function hideMini() {
  try {
    if (ctxRef && ctxRef.windows && typeof ctxRef.windows.hide === 'function') {
      ctxRef.windows.hide('mini');
      return true;
    }
  } catch (err) {
    warn('迷你窗隐藏失败（ctx.windows.hide）', err);
  }
  try {
    const BrowserWindow = ctxRef && ctxRef.electron && ctxRef.electron.BrowserWindow;
    if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win || win.isDestroyed()) continue;
        try {
          if (String(win.webContents.getURL()).indexOf('/timer/mini.html') >= 0) win.hide();
        } catch (_) {
          /* ignore */
        }
      }
      return true;
    }
  } catch (err) {
    warn('迷你窗隐藏失败（BrowserWindow）', err);
  }
  return false;
}

function finishCountdown(now) {
  if (!state) return;
  state.elapsedMs = state.durationMs;
  state.segmentStartedAt = null;
  state.phase = 'finished';
  stopTicker();
  persistState();
  flushStore();
  emitTick(now);
  broadcast('timer:finished', { mode: 'countdown', durationMs: state.durationMs, at: now });
  try {
    if (ctxRef && ctxRef.notifications && typeof ctxRef.notifications.show === 'function') {
      ctxRef.notifications.show({
        title: '倒计时结束',
        body: '设定的 ' + formatDurationHuman(state.durationMs) + '倒计时已完成',
      });
    }
  } catch (err) {
    warn('倒计时通知失败', err);
  }
}

function onTick() {
  if (!ctxRef || !state) {
    stopTicker();
    return;
  }
  if (state.phase !== 'running') {
    stopTicker();
    return;
  }
  const now = Date.now();
  const elapsed = currentElapsed(now);
  if (state.mode === 'countdown' && elapsed >= state.durationMs) {
    finishCountdown(now);
    return;
  }
  emitTick(now);
  if (now - lastPersistAt >= PERSIST_INTERVAL_MS) persistState();
}

/* ------------------------------------------------ 操作 */

function applyDuration(duration) {
  if (duration === null) return;
  state.durationMs = duration;
  state.elapsedMs = 0;
  state.segmentStartedAt = null;
  state.laps = [];
  if (state.phase === 'running') stopTicker();
  state.phase = 'idle';
}

function startTimer(args) {
  const now = Date.now();
  const options = args && typeof args === 'object' ? args : {};
  if (state.phase === 'running') return publicState(now);

  if (options.mode === 'stopwatch' || options.mode === 'countdown') {
    if (options.mode !== state.mode) {
      state.mode = options.mode;
      state.elapsedMs = 0;
      state.segmentStartedAt = null;
      state.laps = [];
      state.phase = 'idle';
    }
  }
  const duration = clampDuration(options.durationMs);
  if (duration !== null) applyDuration(duration);

  if (state.phase === 'finished') {
    state.elapsedMs = 0;
    state.laps = [];
    state.phase = 'idle';
  }
  if (state.mode === 'countdown' && state.elapsedMs >= state.durationMs) state.elapsedMs = 0;

  state.phase = 'running';
  state.segmentStartedAt = now;
  persistState();
  ensureTicker();
  emitTick(now);
  openMini();
  return publicState(now);
}

function pauseTimer() {
  const now = Date.now();
  if (state.phase !== 'running') return publicState(now);
  state.elapsedMs = currentElapsed(now);
  state.segmentStartedAt = null;
  state.phase = 'paused';
  stopTicker();
  persistState();
  emitTick(now);
  return publicState(now);
}

function resumeTimer() {
  const now = Date.now();
  if (state.phase !== 'paused') return publicState(now);
  state.phase = 'running';
  state.segmentStartedAt = now;
  persistState();
  ensureTicker();
  emitTick(now);
  openMini();
  return publicState(now);
}

function resetTimer() {
  stopTicker();
  state.phase = 'idle';
  state.elapsedMs = 0;
  state.segmentStartedAt = null;
  state.laps = [];
  persistState();
  emitTick();
  return publicState();
}

function setMode(args) {
  const options = args && typeof args === 'object' ? args : {};
  const mode = options.mode === 'countdown' ? 'countdown' : 'stopwatch';
  const duration = clampDuration(options.durationMs);
  stopTicker();
  state.mode = mode;
  state.phase = 'idle';
  state.elapsedMs = 0;
  state.segmentStartedAt = null;
  state.laps = [];
  if (duration !== null) state.durationMs = duration;
  persistState();
  emitTick();
  return publicState();
}

function setDuration(args) {
  const options = args && typeof args === 'object' ? args : {};
  const duration = clampDuration(options.durationMs);
  if (duration === null) throw new Error('无效的倒计时时长');
  if (state.phase === 'running') throw new Error('计时进行中，请先暂停或重置');
  state.durationMs = duration;
  state.elapsedMs = 0;
  state.segmentStartedAt = null;
  state.laps = [];
  if (state.phase !== 'idle') state.phase = 'idle';
  persistState();
  emitTick();
  return publicState();
}

function addLap() {
  if (state.mode !== 'stopwatch') throw new Error('仅秒表支持计次');
  if (state.phase !== 'running') throw new Error('请先开始秒表再计次');
  const now = Date.now();
  const totalMs = Math.round(currentElapsed(now));
  const previousTotal = state.laps.length ? state.laps[state.laps.length - 1].totalMs : 0;
  const lap = {
    index: state.laps.length + 1,
    totalMs,
    splitMs: Math.max(0, totalMs - previousTotal),
    at: now,
  };
  state.laps.push(lap);
  if (state.laps.length > MAX_LAPS) state.laps.splice(0, state.laps.length - MAX_LAPS);
  persistState();
  emitTick(now);
  return { ...publicState(now), lap };
}

function toggleTimer() {
  if (!state) return null;
  if (state.phase === 'running') return pauseTimer();
  if (state.phase === 'paused') return resumeTimer();
  return startTimer();
}

/* ------------------------------------------------ 恢复 */

function loadState() {
  const saved = readStore(STATE_KEY, null);
  if (!saved || typeof saved !== 'object') return createState('stopwatch');

  const restored = createState(saved.mode === 'countdown' ? 'countdown' : 'stopwatch');
  const validPhases = ['idle', 'running', 'paused', 'finished'];
  restored.phase = validPhases.indexOf(saved.phase) >= 0 ? saved.phase : 'idle';
  restored.elapsedMs = Math.max(0, toNumber(saved.elapsedMs, 0));
  const duration = clampDuration(saved.durationMs);
  if (duration !== null) restored.durationMs = duration;
  if (Array.isArray(saved.laps)) {
    restored.laps = saved.laps
      .filter((lap) => lap && Number.isFinite(Number(lap.totalMs)))
      .slice(-MAX_LAPS)
      .map((lap, index) => ({
        index: toNumber(lap.index, index + 1),
        totalMs: Math.max(0, toNumber(lap.totalMs, 0)),
        splitMs: Math.max(0, toNumber(lap.splitMs, 0)),
        at: toNumber(lap.at, 0),
      }));
  }
  const now = Date.now();
  restored.savedAt = toNumber(saved.savedAt, now);
  restored.updatedAt = toNumber(saved.updatedAt, restored.savedAt);

  // 运行中退出 / 崩溃：按最后一次持久化点安全暂停，最多补齐 5s，避免把关闭期间算进计时
  if (restored.phase === 'running') {
    const gap = Math.min(Math.max(0, now - restored.savedAt), RESTORE_MAX_GAP_MS);
    restored.elapsedMs += gap;
    restored.segmentStartedAt = null;
    restored.phase = 'paused';
    if (restored.mode === 'countdown' && restored.elapsedMs >= restored.durationMs) {
      restored.elapsedMs = restored.durationMs;
      restored.phase = 'finished';
    }
  }
  return restored;
}

/* ------------------------------------------------ IPC / 命令 */

function registerIpc(ctx) {
  const handlers = {
    'timer.getState': () => publicState(),
    'timer.start': startTimer,
    'timer.pause': pauseTimer,
    'timer.resume': resumeTimer,
    'timer.reset': resetTimer,
    'timer.setMode': setMode,
    'timer.setDuration': setDuration,
    'timer.lap': addLap,
    'timer.openMini': () => {
      openMini();
      emitTick();
      return publicState();
    },
    'timer.hideMini': () => {
      hideMini();
      return publicState();
    },
  };
  Object.keys(handlers).forEach((method) => ctx.ipc.handle(method, handlers[method]));
  return Object.keys(handlers).map((method) => () => {
    try {
      ctx.ipc.unhandle(method);
    } catch (err) {
      warn('移除 IPC 失败：' + method, err);
    }
  });
}

function registerCommands(ctx) {
  const list = [
    {
      id: 'timer.toggle',
      label: '开始 / 暂停计时',
      description: '切换计时器运行状态（自动弹出桌面迷你窗）',
      defaultAccelerator: 'Alt+T',
      run: () => toggleTimer(),
    },
    {
      id: 'timer.reset',
      label: '重置计时器',
      description: '停止并清零当前计时',
      run: () => resetTimer(),
    },
    {
      id: 'timer.mini',
      label: '显示计时器迷你窗',
      description: '显示桌面悬浮迷你计时窗',
      run: () => {
        openMini();
        emitTick();
      },
    },
  ];
  return list.map((item) => {
    const dispose = ctx.commands.register(item);
    return typeof dispose === 'function' ? dispose : () => {};
  });
}

export default {
  activate(ctx) {
    ctxRef = ctx;
    try {
      state = loadState();
      lastPersistAt = Date.now();
      disposers = registerIpc(ctx);
      registerCommands(ctx).forEach((dispose) => disposers.push(dispose));
      // 统一持久化一次（把“运行中恢复”规范化为暂停），并让已存在的 UI 立即同步
      persistState();
      emitTick();
    } catch (err) {
      warn('计时器初始化失败', err);
      state = createState('stopwatch');
    }
  },
  deactivate() {
    stopTicker();
    disposers.forEach((dispose) => {
      try {
        dispose();
      } catch (err) {
        warn('清理资源失败', err);
      }
    });
    disposers = [];
    // 退出前落盘：运行中 → 记录当前累计时间并保存为暂停态，重启后不跳变
    if (ctxRef && state) {
      if (state.phase === 'running') {
        state.elapsedMs = currentElapsed(Date.now());
        state.segmentStartedAt = null;
        state.phase = 'paused';
      }
      persistState();
      flushStore();
      closeMini();
    }
    ctxRef = null;
    state = null;
    miniOpening = null;
  },
};
