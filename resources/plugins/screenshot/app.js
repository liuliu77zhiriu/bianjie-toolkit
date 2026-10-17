/**
 * 截图插件 UI（capture-dev）。
 * 所有后端能力通过 toolkit.invoke（对应 main.js 的 ctx.ipc.handle）。
 */

await toolkit.ready();

const $ = (id) => document.getElementById(id);

const els = {
  formatBadge: $('format-badge'),
  btnRegion: $('btn-region'),
  btnFull: $('btn-full'),
  btnWindow: $('btn-window'),
  displayRow: $('full-display-row'),
  displaySelect: $('display-select'),
  previewCard: $('preview-card'),
  previewImg: $('preview-img'),
  previewSize: $('preview-size'),
  previewPath: $('preview-path'),
  btnReveal: $('btn-reveal'),
  btnCopy: $('btn-copy'),
  copiedBadge: $('copied-badge'),
  emptyCard: $('empty-card'),
  modal: $('source-modal'),
  sourceTabs: $('source-tabs'),
  sourceGrid: $('source-grid'),
  sourceEmpty: $('source-empty'),
  btnRefresh: $('btn-refresh'),
  btnCloseModal: $('btn-close-modal'),
  busyMask: $('busy-mask'),
  busyText: $('busy-text'),
};

const state = {
  busy: false,
  lastResult: null,
  sources: [],
  sourceKind: 'window',
  screens: [],
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

function setBusy(busy, text) {
  state.busy = busy;
  els.busyMask.hidden = !busy;
  els.busyText.textContent = text || '正在截图…';
  for (const button of [els.btnRegion, els.btnFull, els.btnWindow]) {
    button.disabled = busy;
  }
}

function updateFormatBadge() {
  try {
    const settings = toolkit.env.settings || {};
    const format = settings.capture?.format || 'png';
    els.formatBadge.textContent = String(format).toUpperCase();
  } catch {
    els.formatBadge.textContent = 'PNG';
  }
}

function renderResult(result) {
  if (!result || !result.path) return;
  state.lastResult = result;
  els.emptyCard.hidden = true;
  els.previewCard.hidden = false;
  if (result.preview) {
    els.previewImg.src = result.preview;
    els.previewImg.hidden = false;
  } else {
    try {
      els.previewImg.src = toolkit.fileUrl(result.path);
      els.previewImg.hidden = false;
    } catch {
      els.previewImg.hidden = true;
    }
  }
  els.previewSize.textContent = `${result.width || '?'} × ${result.height || '?'} · ${String(
    result.format || 'png'
  ).toUpperCase()}`;
  els.previewPath.textContent = result.path;
  els.previewPath.title = result.path;
  els.copiedBadge.hidden = !result.copied;
  els.copiedBadge.textContent = result.copied ? '已复制到剪贴板' : '';
  els.previewCard.classList.remove('shot-pop');
  // 触发一次小幅度 Q 弹动画
  requestAnimationFrame(() => els.previewCard.classList.add('shot-pop'));
}

function renderScreens() {
  const screens = state.sources.filter((source) => source.kind === 'screen');
  state.screens = screens;
  const previous = els.displaySelect.value;
  els.displaySelect.innerHTML = '';
  for (const screen of screens) {
    const option = document.createElement('option');
    option.value = screen.displayId || '';
    option.textContent = screen.name || '显示器';
    els.displaySelect.appendChild(option);
  }
  if (previous && screens.some((screen) => screen.displayId === previous)) {
    els.displaySelect.value = previous;
  }
  els.displayRow.hidden = screens.length <= 1;
}

function renderSourceGrid() {
  const list = state.sources.filter((source) => source.kind === state.sourceKind);
  els.sourceGrid.innerHTML = '';
  els.sourceEmpty.hidden = list.length > 0;
  for (const source of list) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shot-source';
    card.title = source.name;

    const frame = document.createElement('span');
    frame.className = 'shot-source-frame';
    const img = document.createElement('img');
    img.alt = source.name;
    img.src = source.thumbnail;
    img.loading = 'lazy';
    frame.appendChild(img);
    if (source.appIcon) {
      const icon = document.createElement('img');
      icon.className = 'shot-source-icon';
      icon.src = source.appIcon;
      icon.alt = '';
      frame.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'shot-source-name';
    label.textContent = source.name;

    card.appendChild(frame);
    card.appendChild(label);
    card.addEventListener('click', () => void captureSource(source));
    els.sourceGrid.appendChild(card);
  }
}

async function loadSources() {
  try {
    state.sources = (await toolkit.invoke('sources', { kinds: ['screen', 'window'], thumbnailWidth: 320 })) || [];
  } catch (err) {
    state.sources = [];
    toast(`读取来源失败：${errorText(err)}`, 'error');
  }
  renderScreens();
  renderSourceGrid();
}

function openSourcePicker(kind) {
  state.sourceKind = kind === 'screen' ? 'screen' : 'window';
  for (const button of els.sourceTabs.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.kind === state.sourceKind);
  }
  els.modal.hidden = false;
  renderSourceGrid();
  if (!state.sources.length) void loadSources();
}

function closeSourcePicker() {
  els.modal.hidden = true;
}

async function captureSource(source) {
  if (state.busy) return;
  closeSourcePicker();
  try {
    if (source.kind === 'screen') {
      setBusy(true, '正在截取全屏…');
      const result = await toolkit.invoke('full', { displayId: source.displayId });
      if (result) renderResult(result);
    } else {
      setBusy(true, '正在截取窗口…');
      const result = await toolkit.invoke('window', { sourceId: source.id });
      if (result) renderResult(result);
    }
    toast('截图已保存', 'success');
  } catch (err) {
    toast(`截图失败：${errorText(err)}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function captureRegion() {
  if (state.busy) return;
  setBusy(true, '准备区域截图…');
  try {
    // 面板由后端关闭（overlay 需要），这里不要提前关，否则用户看不到失败提示
    const result = await toolkit.invoke('region', { fromUI: true });
    if (result) {
      renderResult(result);
      toast('截图已保存', 'success');
    }
  } catch (err) {
    toast(`区域截图失败：${errorText(err)}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function captureFull() {
  if (state.busy) return;
  setBusy(true, '正在截取全屏…');
  try {
    const displayId = els.displaySelect.value || undefined;
    const result = await toolkit.invoke('full', { displayId });
    if (result) {
      renderResult(result);
      toast('截图已保存', 'success');
    }
  } catch (err) {
    toast(`全屏截图失败：${errorText(err)}`, 'error');
  } finally {
    setBusy(false);
  }
}

els.btnRegion.addEventListener('click', () => void captureRegion());
els.btnFull.addEventListener('click', () => void captureFull());
els.btnWindow.addEventListener('click', () => openSourcePicker('window'));

els.btnReveal.addEventListener('click', async () => {
  const path = state.lastResult?.path;
  if (!path) return toast('还没有可打开的截图', 'error');
  try {
    await toolkit.invoke('reveal', { path });
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

els.btnCopy.addEventListener('click', async () => {
  const path = state.lastResult?.path;
  if (!path) return toast('还没有可复制的截图', 'error');
  try {
    await toolkit.invoke('copy', { path });
    els.copiedBadge.hidden = false;
    els.copiedBadge.textContent = '已复制到剪贴板';
    toast('已复制到剪贴板', 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

els.btnRefresh.addEventListener('click', () => void loadSources());
els.btnCloseModal.addEventListener('click', closeSourcePicker);
els.modal.addEventListener('click', (event) => {
  if (event.target === els.modal) closeSourcePicker();
});
els.sourceTabs.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-kind]');
  if (!button) return;
  state.sourceKind = button.dataset.kind === 'screen' ? 'screen' : 'window';
  for (const item of els.sourceTabs.querySelectorAll('button')) {
    item.classList.toggle('active', item === button);
  }
  renderSourceGrid();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.modal.hidden) closeSourcePicker();
});

toolkit.on('shot:done', (result) => {
  if (result && result.path !== state.lastResult?.path) renderResult(result);
});

toolkit.on('shot:pick-window', () => openSourcePicker('window'));

toolkit.on('settings:changed', () => {
  updateFormatBadge();
});

toolkit.on('panel:shown', () => {
  void refreshLast();
});

async function refreshLast() {
  try {
    const last = await toolkit.invoke('last');
    if (last && last.path) renderResult(last);
  } catch {
    /* ignore */
  }
}

updateFormatBadge();
void refreshLast();
void loadSources();

// 从快捷键命令进入「窗口截图」时，主面板可能稍后才把 iframe 切进来。
setTimeout(async () => {
  try {
    const mode = await toolkit.invoke('pending');
    if (mode === 'window') openSourcePicker('window');
  } catch {
    /* ignore */
  }
}, 400);
