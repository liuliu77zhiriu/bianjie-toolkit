/* ============================================================
 * 计时器 · 桌面迷你窗逻辑
 * 数据来自后端广播 timer:tick；关闭窗口只隐藏，计时在后端继续
 * ============================================================ */

const toolkit = window.toolkit;
// sdk.js 的 ready 是 Promise（文档示例写成 ready()），两种形态都兼容
await (typeof toolkit.ready === 'function' ? toolkit.ready() : toolkit.ready);

const $ = (id) => document.getElementById(id);

const els = {
  time: $('miniTime'),
  label: $('miniLabel'),
  dot: $('miniDot'),
  toggle: $('btnToggle'),
  reset: $('btnReset'),
  close: $('btnClose'),
  bar: $('miniBarFill'),
  togglePath: $('toggleIconPath'),
};

const PLAY_PATH = 'M8 5.5v13l11-6.5-11-6.5z';
const PAUSE_PATH = 'M8 5h3.2v14H8zM12.8 5H16v14h-3.2z';

let state = null;
let busy = false;
let finishedTimer = 0;

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

function displayText(next) {
  if (next.mode === 'countdown') {
    const remaining = next.phase === 'finished' ? 0 : Math.max(0, next.remainingMs || 0);
    return formatClock(Math.ceil(remaining / 1000));
  }
  return formatClock(Math.floor((next.elapsedMs || 0) / 1000));
}

function render(next) {
  if (!next || typeof next !== 'object') return;
  state = next;

  document.body.dataset.mode = next.mode;
  document.body.dataset.phase = next.phase || 'idle';

  els.time.textContent = displayText(next);
  const labels = {
    idle: '待开始',
    running: next.mode === 'countdown' ? '倒计时中' : '计时中',
    paused: '已暂停',
    finished: '已完成',
  };
  els.label.textContent = labels[next.phase] || '';

  const isRunning = next.phase === 'running';
  els.togglePath.setAttribute('d', isRunning ? PAUSE_PATH : PLAY_PATH);
  els.toggle.title = isRunning ? '暂停' : next.phase === 'paused' ? '继续' : '开始';
  els.toggle.setAttribute('aria-label', els.toggle.title);
  els.toggle.disabled = busy;
  els.reset.disabled = busy;

  if (next.mode === 'countdown') {
    const ratio =
      next.durationMs > 0
        ? Math.min(1, Math.max(0, (next.remainingMs || 0) / next.durationMs))
        : 0;
    els.bar.style.width = (ratio * 100).toFixed(2) + '%';
  }

  if (next.phase === 'finished') {
    document.body.classList.add('is-finished');
    clearTimeout(finishedTimer);
    finishedTimer = setTimeout(() => document.body.classList.remove('is-finished'), 2400);
  } else if (next.phase !== 'idle') {
    document.body.classList.remove('is-finished');
  }
}

async function toggle() {
  if (busy || !state) return;
  busy = true;
  els.toggle.disabled = true;
  try {
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
    toolkit.toast('操作失败：' + ((err && err.message) || '未知错误'), 'error');
  } finally {
    busy = false;
    els.toggle.disabled = false;
    els.reset.disabled = false;
  }
}

async function reset() {
  if (busy) return;
  busy = true;
  els.reset.disabled = true;
  try {
    render(await toolkit.invoke('timer.reset'));
  } catch (err) {
    toolkit.toast('重置失败：' + ((err && err.message) || '未知错误'), 'error');
  } finally {
    busy = false;
    els.toggle.disabled = false;
    els.reset.disabled = false;
  }
}

els.toggle.addEventListener('click', toggle);
els.reset.addEventListener('click', reset);

async function hideMiniWindow() {
  try {
    await toolkit.invoke('timer.hideMini');
    return;
  } catch (_) {
    /* IPC 不可用时退回关闭（宿主 hideOnClose 会隐藏） */
  }
  try {
    toolkit.closeWindow();
  } catch (_) {
    window.close();
  }
}

els.close.addEventListener('click', () => {
  void hideMiniWindow();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void hideMiniWindow();
});

toolkit.on('timer:tick', (next) => render(next));
toolkit.on('timer:finished', () => {
  document.body.classList.add('is-finished');
  clearTimeout(finishedTimer);
  finishedTimer = setTimeout(() => document.body.classList.remove('is-finished'), 2400);
});

(async () => {
  // 独立窗口的 IPC 可能比宿主就绪稍晚；短暂重试后依赖 timer:tick 广播兜底
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      render(await toolkit.invoke('timer.getState'));
      return;
    } catch (err) {
      if (attempt === 3) {
        console.warn('[timer:mini] 初始状态读取失败，等待实时事件', err);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
})();
