/**
 * 录制指示器（独立小窗）。
 * 显示红点 + 计时 + 停止/取消按钮；数据来自 rec:state 广播（也支持主动拉取）。
 */

await toolkit.ready();

const $ = (id) => document.getElementById(id);

const els = {
  dot: $('dot'),
  time: $('time'),
  phase: $('phase'),
  stop: $('stop'),
  close: $('close'),
};

const ACTIVE_PHASES = new Set(['preparing', 'countdown', 'recording', 'stopping']);

let current = null;
let busy = false;
let handle = 0;

function pad(value) {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0');
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function toast(message, type = 'info') {
  try {
    toolkit.toast(String(message), type);
  } catch {
    /* ignore */
  }
}

function tick() {
  if (!current) return;
  if (current.phase === 'countdown') {
    els.time.textContent = `00:0${Math.max(0, Number(current.countdownLeft) || 0)}`;
    els.phase.textContent = '即将开始';
    els.dot.classList.remove('recording');
    return;
  }
  if (current.phase === 'preparing') {
    els.time.textContent = '00:00';
    els.phase.textContent = '准备中';
    els.dot.classList.remove('recording');
    return;
  }
  if (current.phase === 'stopping') {
    els.phase.textContent = '正在保存';
  } else {
    els.phase.textContent = '录制中';
  }
  els.dot.classList.add('recording');
  const elapsed = current.startedAt ? Date.now() - current.startedAt : current.durationMs || 0;
  els.time.textContent = formatDuration(elapsed);
}

function render(state) {
  current = state;
  if (!state || !ACTIVE_PHASES.has(state.phase)) {
    els.phase.textContent = '已结束';
    els.dot.classList.remove('recording');
    return;
  }
  tick();
  if (!handle) handle = setInterval(tick, 500);
}

function stopTimer() {
  if (handle) {
    clearInterval(handle);
    handle = 0;
  }
}

async function stopRecording() {
  if (busy) return;
  busy = true;
  els.stop.disabled = true;
  try {
    const result = await toolkit.invoke('stop');
    if (result && result.cancelled) toast('录制已取消', 'info');
    else toast('录制已保存', 'success');
  } catch (err) {
    toast(`停止失败：${err && err.message ? err.message : err}`, 'error');
  } finally {
    busy = false;
    els.stop.disabled = false;
  }
}

async function cancelRecording() {
  if (busy) return;
  busy = true;
  try {
    await toolkit.invoke('cancel');
  } catch (err) {
    toast(`取消失败：${err && err.message ? err.message : err}`, 'error');
  } finally {
    busy = false;
  }
}

els.stop.addEventListener('click', () => void stopRecording());
els.close.addEventListener('click', () => void cancelRecording());

toolkit.on('rec:state', (state) => render(state));
toolkit.on('rec:done', () => {
  stopTimer();
  current = null;
  els.phase.textContent = '已保存';
  els.dot.classList.remove('recording');
});
toolkit.on('rec:error', (payload) => {
  stopTimer();
  current = null;
  els.phase.textContent = '出错了';
  els.dot.classList.remove('recording');
  toast(payload?.message || '录制失败', 'error');
});
toolkit.on('rec:cancelled', () => {
  stopTimer();
  current = null;
  els.phase.textContent = '已取消';
  els.dot.classList.remove('recording');
});

async function init() {
  try {
    const state = await toolkit.invoke('state');
    render(state);
  } catch {
    render(null);
  }
}

void init();
