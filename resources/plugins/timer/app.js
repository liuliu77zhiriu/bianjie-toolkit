/* ============================================================
 * 计时器 · 面板 UI（iframe 内运行）
 * 后端为权威计时器：UI 只负责渲染与转发操作
 * ============================================================ */

const toolkit = window.toolkit;
// sdk.js 的 ready 是 Promise（文档示例写成 ready()），两种形态都兼容
await (typeof toolkit.ready === 'function' ? toolkit.ready() : toolkit.ready);

const $ = (id) => document.getElementById(id);

const dom = {
  statusSub: $('statusSub'),
  modeSeg: $('modeSeg'),
  clockTime: $('clockTime'),
  clockState: $('clockState'),
  ringValue: $('ringValue'),
  btnMain: $('btnMain'),
  btnLap: $('btnLap'),
  btnReset: $('btnReset'),
  presetCard: $('presetCard'),
  presetChips: $('presetChips'),
  durationHint: $('durationHint'),
  customMin: $('customMin'),
  customSec: $('customSec'),
  btnCustom: $('btnCustom'),
  lapList: $('lapList'),
  lapEmpty: $('lapEmpty'),
  lapCount: $('lapCount'),
  btnMini: $('btnMini'),
  lapsCard: $('lapsCard'),
};

const RING_RADIUS = 86;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const PRESET_DEFAULT_MS = 25 * 60 * 1000;

const app = {
  state: null,
  modeButtons: Array.from(dom.modeSeg.querySelectorAll('button')),
  presetButtons: Array.from(dom.presetChips.querySelectorAll('.tk-chip')),
  busy: false,
};

dom.ringValue.style.strokeDasharray = String(RING_CIRCUMFERENCE);
dom.ringValue.style.strokeDashoffset = '0';

/* ------------------------------------------------ 格式化 */

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return hours + ':' + pad2(minutes) + ':' + pad2(rest);
  return pad2(minutes) + ':' + pad2(rest);
}

function formatLap(ms) {
  const value = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((value % 1000) / 100);
  return pad2(minutes) + ':' + pad2(seconds) + '.' + tenths;
}

function toast(message, type) {
  try {
    toolkit.toast(message, type || 'info');
  } catch (_) {
    /* ignore */
  }
}

function displayText(state) {
  if (state.mode === 'countdown') {
    const remaining = state.phase === 'finished' ? 0 : Math.max(0, state.remainingMs || 0);
    return formatClock(Math.ceil(remaining / 1000));
  }
  return formatClock(Math.floor((state.elapsedMs || 0) / 1000));
}

/* ------------------------------------------------ 渲染 */

function renderLaps(state) {
  const laps = Array.isArray(state.laps) ? state.laps : [];
  dom.lapCount.textContent = laps.length + ' 次';
  dom.lapList.replaceChildren();

  if (!laps.length) {
    dom.lapEmpty.classList.remove('tk-hidden');
    return;
  }
  dom.lapEmpty.classList.add('tk-hidden');

  const fragment = document.createDocumentFragment();
  laps
    .slice()
    .reverse()
    .forEach((lap) => {
      const item = document.createElement('div');
      item.className = 'tk-item lap-item';

      const index = document.createElement('span');
      index.className = 'lap-index';
      index.textContent = '第 ' + lap.index + ' 次';

      const split = document.createElement('span');
      split.className = 'lap-time tk-mono';
      split.textContent = formatLap(lap.splitMs);

      const total = document.createElement('span');
      total.className = 'lap-total';
      total.textContent = '总计 ' + formatLap(lap.totalMs);

      item.append(index, split, total);
      fragment.appendChild(item);
    });
  dom.lapList.appendChild(fragment);
}

function render(state) {
  if (!state || typeof state !== 'object') return;
  app.state = state;

  const isCountdown = state.mode === 'countdown';
  document.body.dataset.mode = isCountdown ? 'countdown' : 'stopwatch';
  document.body.dataset.phase = state.phase || 'idle';

  // 模式切换按钮
  app.modeButtons.forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.disabled = state.phase === 'running';
  });

  // 大号时间 + 状态
  dom.clockTime.textContent = displayText(state);
  const stateLabels = {
    idle: isCountdown ? '准备倒计时' : '准备就绪',
    running: isCountdown ? '倒计时中' : '计时中',
    paused: '已暂停',
    finished: '已完成',
  };
  dom.clockState.textContent = stateLabels[state.phase] || '';
  dom.statusSub.textContent =
    state.phase === 'running'
      ? isCountdown
        ? '倒计时进行中 · 关闭面板后继续'
        : '秒表运行中 · 关闭面板后继续'
      : '后端计时 · 关闭面板后继续';

  // 环形进度（仅倒计时）
  if (isCountdown) {
    const ratio =
      state.durationMs > 0 ? Math.min(1, Math.max(0, (state.remainingMs || 0) / state.durationMs)) : 0;
    dom.ringValue.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - ratio));
  } else {
    dom.ringValue.style.strokeDashoffset = '0';
  }

  // 主按钮
  if (state.phase === 'running') {
    dom.btnMain.textContent = '暂停';
    dom.btnMain.dataset.action = 'pause';
  } else if (state.phase === 'paused') {
    dom.btnMain.textContent = '继续';
    dom.btnMain.dataset.action = 'resume';
  } else if (state.phase === 'finished') {
    dom.btnMain.textContent = isCountdown ? '再来一次' : '开始';
    dom.btnMain.dataset.action = 'start';
  } else {
    dom.btnMain.textContent = '开始';
    dom.btnMain.dataset.action = 'start';
  }
  dom.btnMain.disabled = false;

  // 计次 / 重置
  dom.btnLap.classList.toggle('tk-hidden', isCountdown);
  dom.btnLap.disabled = !(state.mode === 'stopwatch' && state.phase === 'running');
  dom.btnReset.disabled = state.phase === 'idle' && !state.elapsedMs;

  // 预设
  app.presetButtons.forEach((button) => {
    const duration = Number(button.dataset.minutes) * 60 * 1000;
    button.classList.toggle('active', isCountdown && duration === state.durationMs);
    button.disabled = state.phase === 'running';
  });
  dom.btnCustom.disabled = state.phase === 'running';
  dom.customMin.disabled = state.phase === 'running';
  dom.customSec.disabled = state.phase === 'running';
  dom.durationHint.textContent = '当前时长 ' + formatClock(state.durationMs / 1000);
  if (state.phase !== 'running') {
    const minutes = Math.floor(state.durationMs / 60000);
    const seconds = Math.floor((state.durationMs % 60000) / 1000);
    if (document.activeElement !== dom.customMin) dom.customMin.value = String(minutes);
    if (document.activeElement !== dom.customSec) dom.customSec.value = String(seconds);
  }

  renderLaps(state);
}

/* ------------------------------------------------ 操作 */

async function onMainClick() {
  if (app.busy || !app.state) return;
  app.busy = true;
  try {
    const state = app.state;
    if (state.phase === 'running') {
      render(await toolkit.invoke('timer.pause'));
    } else if (state.phase === 'paused') {
      render(await toolkit.invoke('timer.resume'));
    } else {
      render(
        await toolkit.invoke('timer.start', {
          mode: state.mode,
          durationMs: state.mode === 'countdown' ? state.durationMs : undefined,
        })
      );
    }
  } catch (err) {
    toast('操作失败：' + ((err && err.message) || '未知错误'), 'error');
  } finally {
    app.busy = false;
  }
}

async function onLapClick() {
  try {
    const result = await toolkit.invoke('timer.lap');
    if (result) render(result);
  } catch (err) {
    toast('计次失败：' + ((err && err.message) || '未知错误'), 'error');
  }
}

async function onResetClick() {
  try {
    render(await toolkit.invoke('timer.reset'));
  } catch (err) {
    toast('重置失败：' + ((err && err.message) || '未知错误'), 'error');
  }
}

async function switchMode(mode) {
  if (!app.state || app.state.mode === mode || app.state.phase === 'running') return;
  try {
    const durationMs =
      mode === 'countdown'
        ? app.state.mode === 'countdown'
          ? app.state.durationMs
          : PRESET_DEFAULT_MS
        : undefined;
    render(await toolkit.invoke('timer.setMode', { mode, durationMs }));
  } catch (err) {
    toast('切换模式失败：' + ((err && err.message) || '未知错误'), 'error');
  }
}

async function applyDuration(durationMs) {
  if (!app.state) return;
  if (app.state.phase === 'running') {
    toast('请先暂停或重置计时', 'info');
    return;
  }
  try {
    render(await toolkit.invoke('timer.setMode', { mode: 'countdown', durationMs }));
    toast('时长已设为 ' + formatClock(durationMs / 1000), 'success');
  } catch (err) {
    toast('设置时长失败：' + ((err && err.message) || '未知错误'), 'error');
  }
}

function applyCustomDuration() {
  const minutes = Math.max(0, Math.min(599, Math.floor(Number(dom.customMin.value) || 0)));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(dom.customSec.value) || 0)));
  const durationMs = (minutes * 60 + seconds) * 1000;
  if (durationMs < 1000) {
    toast('自定义时长至少 1 秒', 'info');
    return;
  }
  applyDuration(durationMs);
}

/* ------------------------------------------------ 事件绑定 */

dom.btnMain.addEventListener('click', onMainClick);
dom.btnLap.addEventListener('click', onLapClick);
dom.btnReset.addEventListener('click', onResetClick);
dom.btnMini.addEventListener('click', async () => {
  try {
    await toolkit.invoke('timer.openMini');
    toast('迷你窗已显示在桌面右上角', 'success');
  } catch (err) {
    toast('打开迷你窗失败：' + ((err && err.message) || '未知错误'), 'error');
  }
});

dom.modeSeg.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  switchMode(button.dataset.mode);
});

dom.presetChips.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-minutes]');
  if (!button) return;
  applyDuration(Number(button.dataset.minutes) * 60 * 1000);
});

dom.btnCustom.addEventListener('click', applyCustomDuration);
[dom.customMin, dom.customSec].forEach((input) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyCustomDuration();
    }
  });
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) || event.altKey) return;
  const target = event.target;
  const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
  if (isTyping) return;
  if (event.code === 'Space') {
    event.preventDefault();
    onMainClick();
  } else if (event.key === 'l' || event.key === 'L') {
    if (app.state && app.state.mode === 'stopwatch' && app.state.phase === 'running') onLapClick();
  } else if (event.key === 'r' || event.key === 'R') {
    onResetClick();
  }
});

/* ------------------------------------------------ 后端事件 */

toolkit.on('timer:tick', (state) => render(state));
toolkit.on('timer:finished', () => {
  document.body.classList.add('finished');
  toast('倒计时结束', 'success');
  setTimeout(() => document.body.classList.remove('finished'), 2600);
});

toolkit.on('panel:shown', async () => {
  try {
    render(await toolkit.invoke('timer.getState'));
  } catch (_) {
    /* ignore */
  }
});

toolkit.on('plugin:will-reload', () => {
  app.busy = true;
});

/* ------------------------------------------------ 启动 */

(async () => {
  try {
    render(await toolkit.invoke('timer.getState'));
  } catch (err) {
    toast('初始化失败：' + ((err && err.message) || '未知错误'), 'error');
  }
})();
