/**
 * 录屏插件 UI（capture-dev）。
 * 后端方法见 main.js 的 ctx.ipc.handle；录制状态通过 rec:state 广播。
 */

await toolkit.ready();

const $ = (id) => document.getElementById(id);

const els = {
  audioBadge: $('audio-badge'),
  liveCard: $('live-card'),
  livePhase: $('live-phase'),
  liveHint: $('live-hint'),
  liveTimer: $('live-timer'),
  btnStop: $('btn-stop'),
  sourceTabs: $('source-tabs'),
  screenList: $('screen-list'),
  windowGrid: $('window-grid'),
  sourceEmpty: $('source-empty'),
  selectedName: $('selected-name'),
  btnRefresh: $('btn-refresh'),
  audioSeg: $('audio-seg'),
  fpsSeg: $('fps-seg'),
  countdownSeg: $('countdown-seg'),
  qualityRange: $('quality-range'),
  qualityLabel: $('quality-label'),
  btnStart: $('btn-start'),
  resultCard: $('result-card'),
  resultFormat: $('result-format'),
  resultDuration: $('result-duration'),
  resultSize: $('result-size'),
  resultPath: $('result-path'),
  btnOpenFile: $('btn-open-file'),
  btnOpenFolder: $('btn-open-folder'),
  busyMask: $('busy-mask'),
  busyText: $('busy-text'),
};

const AUDIO_LABELS = {
  none: '无声音',
  system: '系统声音',
  mic: '麦克风',
  'system+mic': '系统 + 麦克风',
};

const ACTIVE_PHASES = new Set(['preparing', 'countdown', 'recording', 'stopping']);

const state = {
  sources: [],
  sourceKind: 'screen',
  selected: null,
  audio: 'system',
  fps: 30,
  quality: 85,
  countdown: 3,
  busy: false,
  recording: null,
  timer: 0,
};

function toast(message, type = 'info') {
  try {
    toolkit.toast(String(message), type);
  } catch {
    /* ignore */
  }
}

function errorText(err) {
  return err && err.message ? String(err.message) : String(err);
}

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

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value)} B`;
}

function qualityWord(value) {
  if (value >= 95) return '高清';
  if (value >= 80) return '均衡';
  if (value >= 60) return '流畅';
  return '省空间';
}

function setBusy(busy, text) {
  state.busy = busy;
  els.busyMask.hidden = !busy;
  els.busyText.textContent = text || '正在准备录制…';
  updateStartButton();
}

function isActive() {
  return !!(state.recording && ACTIVE_PHASES.has(state.recording.phase));
}

function updateStartButton() {
  const active = isActive();
  els.btnStart.disabled = state.busy || active || !state.selected;
  els.btnStart.classList.toggle('recording', active);
}

function defaultSettings() {
  const settings = (toolkit.env.settings || {}).recorder || {};
  state.audio = settings.audio || 'system';
  state.fps = [24, 30, 60].includes(settings.fps) ? settings.fps : 30;
  state.quality = typeof settings.quality === 'number' ? settings.quality : 85;
  state.countdown = typeof settings.countdown === 'number' ? settings.countdown : 3;
}

function syncControls() {
  els.audioBadge.textContent = AUDIO_LABELS[state.audio] || '系统声音';
  for (const button of els.audioSeg.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.audio === state.audio);
  }
  for (const button of els.fpsSeg.querySelectorAll('button')) {
    button.classList.toggle('active', Number(button.dataset.fps) === state.fps);
  }
  for (const button of els.countdownSeg.querySelectorAll('button')) {
    button.classList.toggle('active', Number(button.dataset.countdown) === state.countdown);
  }
  els.qualityRange.value = String(state.quality);
  els.qualityLabel.textContent = qualityWord(state.quality);
  for (const button of els.sourceTabs.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.kind === state.sourceKind);
  }
}

function renderSelected() {
  if (!state.selected) {
    els.selectedName.textContent = '未选择来源';
    updateStartButton();
    return;
  }
  const kindText = state.selected.kind === 'window' ? '窗口' : '屏幕';
  els.selectedName.textContent = `已选择：${kindText} · ${state.selected.name || '未命名'}`;
  updateStartButton();
}

async function loadSources() {
  try {
    state.sources = (await toolkit.invoke('sources', { kinds: ['screen', 'window'], thumbnailWidth: 300 })) || [];
  } catch (err) {
    state.sources = [];
    toast(`读取录制来源失败：${errorText(err)}`, 'error');
  }
  // 清理已失效的选中来源
  if (state.selected && !state.sources.some((source) => source.id === state.selected.sourceId)) {
    state.selected = null;
  }
  if (!state.selected) {
    const firstScreen = state.sources.find((source) => source.kind === 'screen');
    if (firstScreen) {
      state.selected = {
        sourceId: firstScreen.id,
        kind: 'screen',
        displayId: firstScreen.displayId,
        name: firstScreen.name,
      };
    }
  }
  renderSources();
  renderSelected();
}

function renderSources() {
  const screens = state.sources.filter((source) => source.kind === 'screen');
  const windows = state.sources.filter((source) => source.kind === 'window');
  const list = state.sourceKind === 'screen' ? screens : windows;

  els.screenList.hidden = state.sourceKind !== 'screen';
  els.windowGrid.hidden = state.sourceKind !== 'window';
  els.sourceEmpty.hidden = list.length > 0;

  els.screenList.innerHTML = '';
  for (const source of screens) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tk-item rec-source-row';
    row.classList.toggle('active', state.selected?.sourceId === source.id);
    const thumb = document.createElement('img');
    thumb.className = 'rec-source-thumb';
    thumb.src = source.thumbnail;
    thumb.alt = '';
    const info = document.createElement('span');
    info.className = 'rec-source-info';
    const name = document.createElement('b');
    name.textContent = source.name || '显示器';
    const hint = document.createElement('small');
    hint.textContent = '整块屏幕';
    info.appendChild(name);
    info.appendChild(hint);
    row.appendChild(thumb);
    row.appendChild(info);
    row.addEventListener('click', () => selectSource(source));
    els.screenList.appendChild(row);
  }

  els.windowGrid.innerHTML = '';
  for (const source of windows) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'rec-window-card';
    card.classList.toggle('active', state.selected?.sourceId === source.id);
    card.title = source.name;
    const frame = document.createElement('span');
    frame.className = 'rec-window-frame';
    const img = document.createElement('img');
    img.src = source.thumbnail;
    img.alt = source.name;
    img.loading = 'lazy';
    frame.appendChild(img);
    if (source.appIcon) {
      const icon = document.createElement('img');
      icon.className = 'rec-window-icon';
      icon.src = source.appIcon;
      icon.alt = '';
      frame.appendChild(icon);
    }
    const label = document.createElement('span');
    label.className = 'rec-window-name';
    label.textContent = source.name || '窗口';
    card.appendChild(frame);
    card.appendChild(label);
    card.addEventListener('click', () => selectSource(source));
    els.windowGrid.appendChild(card);
  }
}

function selectSource(source) {
  state.selected = {
    sourceId: source.id,
    kind: source.kind,
    displayId: source.displayId,
    name: source.name,
  };
  for (const element of document.querySelectorAll('.rec-source-row, .rec-window-card')) {
    element.classList.remove('active');
  }
  renderSources();
  renderSelected();
}

/* ------------------------------------------------ 录制状态 */

function renderState(recording) {
  state.recording = recording;
  const active = isActive();
  els.liveCard.hidden = !active;
  updateStartButton();
  if (!active) {
    stopTimer();
    return;
  }
  const phase = recording.phase;
  if (phase === 'preparing') {
    els.livePhase.textContent = '准备中';
    els.liveHint.textContent = '正在初始化录制引擎…';
  } else if (phase === 'countdown') {
    els.livePhase.textContent = `倒计时 ${recording.countdownLeft ?? ''}`;
    els.liveHint.textContent = '即将开始录制，面板已收起';
  } else if (phase === 'stopping') {
    els.livePhase.textContent = '正在停止';
    els.liveHint.textContent = '正在写入录制文件…';
  } else {
    els.livePhase.textContent = '录制中';
    els.liveHint.textContent = '录制指示器在屏幕右上角';
  }
  els.btnStop.disabled = phase === 'stopping';
  startTimer(recording);
}

let timerHandle = 0;
function stopTimer() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = 0;
  }
}
function startTimer(recording) {
  stopTimer();
  const tick = () => {
    const current = state.recording;
    if (!current) return;
    if (current.phase === 'countdown') {
      els.liveTimer.textContent = `-${pad(current.countdownLeft ?? 0)}`;
      return;
    }
    if (current.phase !== 'recording' && current.phase !== 'stopping') return;
    const elapsed = current.startedAt ? Date.now() - current.startedAt : current.durationMs || 0;
    els.liveTimer.textContent = formatDuration(elapsed);
  };
  tick();
  timerHandle = setInterval(tick, 500);
}

function renderResult(result) {
  if (!result || !result.path) return;
  els.resultCard.hidden = false;
  els.resultFormat.textContent = String(result.format || 'mp4').toUpperCase();
  els.resultDuration.textContent = formatDuration(result.durationMs);
  els.resultSize.textContent = formatBytes(result.sizeBytes);
  els.resultPath.textContent = result.path;
  els.resultPath.title = result.path;
  state.lastResult = result;
  els.resultCard.classList.remove('rec-pop');
  requestAnimationFrame(() => els.resultCard.classList.add('rec-pop'));
}

/* ------------------------------------------------ 操作 */

async function startRecording() {
  if (state.busy || isActive()) return;
  if (!state.selected) return toast('请先选择录制来源', 'error');
  setBusy(true, state.countdown > 0 ? '正在准备，随后开始倒计时…' : '正在准备录制…');
  try {
    await toolkit.invoke('start', {
      sourceId: state.selected.sourceId,
      kind: state.selected.kind,
      displayId: state.selected.displayId,
      name: state.selected.name,
      audio: state.audio,
      fps: state.fps,
      quality: state.quality,
      countdown: state.countdown,
    });
    toast('录制已开始', 'success');
  } catch (err) {
    toast(`开始录制失败：${errorText(err)}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function stopRecording() {
  if (state.busy) return;
  setBusy(true, '正在停止录制…');
  try {
    const result = await toolkit.invoke('stop');
    if (result && result.cancelled) {
      toast('录制已取消', 'info');
    } else if (result && result.path) {
      renderResult(result);
      toast('录制已保存', 'success');
    }
  } catch (err) {
    toast(`停止录制失败：${errorText(err)}`, 'error');
  } finally {
    setBusy(false);
    await refreshState();
  }
}

async function refreshState() {
  try {
    const recording = await toolkit.invoke('state');
    renderState(recording);
  } catch {
    /* ignore */
  }
}

async function refreshLastResult() {
  try {
    const result = await toolkit.invoke('lastResult');
    if (result && result.path) renderResult(result);
  } catch {
    /* ignore */
  }
}

els.btnStart.addEventListener('click', () => void startRecording());
els.btnStop.addEventListener('click', () => void stopRecording());
els.btnRefresh.addEventListener('click', () => void loadSources());

els.sourceTabs.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-kind]');
  if (!button) return;
  state.sourceKind = button.dataset.kind === 'window' ? 'window' : 'screen';
  syncControls();
  renderSources();
});

els.audioSeg.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-audio]');
  if (!button) return;
  state.audio = button.dataset.audio || 'system';
  syncControls();
});

els.fpsSeg.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-fps]');
  if (!button) return;
  state.fps = Number(button.dataset.fps) || 30;
  syncControls();
});

els.countdownSeg.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-countdown]');
  if (!button) return;
  state.countdown = Number(button.dataset.countdown) || 0;
  syncControls();
});

els.qualityRange.addEventListener('input', () => {
  state.quality = Number(els.qualityRange.value) || 85;
  els.qualityLabel.textContent = qualityWord(state.quality);
});

els.btnOpenFile.addEventListener('click', async () => {
  try {
    await toolkit.invoke('openFile', { path: state.lastResult?.path });
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

els.btnOpenFolder.addEventListener('click', async () => {
  try {
    await toolkit.invoke('reveal', { path: state.lastResult?.path });
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

toolkit.on('rec:state', (recording) => {
  renderState(recording);
  if (recording?.phase === 'done' || recording?.phase === 'error') {
    void refreshLastResult();
  }
});

toolkit.on('rec:done', (result) => {
  renderResult(result);
  stopTimer();
  els.liveCard.hidden = true;
  void refreshState();
});

toolkit.on('rec:error', (payload) => {
  toast(`录制失败：${payload?.message || '未知错误'}`, 'error');
  okUpdateAfterError();
});

toolkit.on('rec:cancelled', () => {
  toast('录制已取消', 'info');
  okUpdateAfterError();
});

function okUpdateAfterError() {
  stopTimer();
  els.liveCard.hidden = true;
  state.recording = null;
  updateStartButton();
}

toolkit.on('panel:shown', () => {
  void refreshState();
  void refreshLastResult();
});

toolkit.on('panel:hidden', () => {
  // 面板收起时停止本地 UI 计时即可（录制在后台继续）
  stopTimer();
});

toolkit.on('settings:changed', () => {
  defaultSettings();
  syncControls();
});

/* ------------------------------------------------ 初始化 */

defaultSettings();
syncControls();
renderSelected();
updateStartButton();
void loadSources();
void refreshState();
void refreshLastResult();
