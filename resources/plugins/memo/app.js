/* ============================================================
 * 备忘录 · 面板 UI（iframe 内运行）
 * 列表 ↔ 编辑器双视图、搜索、400ms 自动保存、置顶、删除二次确认
 * ============================================================ */

const toolkit = window.toolkit;
// sdk.js 的 ready 是 Promise（文档示例写成 ready()），两种形态都兼容
await (typeof toolkit.ready === 'function' ? toolkit.ready() : toolkit.ready);

const $ = (id) => document.getElementById(id);

const dom = {
  viewList: $('viewList'),
  viewEditor: $('viewEditor'),
  listSub: $('listSub'),
  btnNew: $('btnNew'),
  searchInput: $('searchInput'),
  noteScroll: $('noteScroll'),
  noteList: $('noteList'),
  emptyState: $('emptyState'),
  emptyTitle: $('emptyTitle'),
  emptyHint: $('emptyHint'),
  btnBack: $('btnBack'),
  editorHeading: $('editorHeading'),
  saveState: $('saveState'),
  editorMeta: $('editorMeta'),
  btnPin: $('btnPin'),
  btnDelete: $('btnDelete'),
  noteTitle: $('noteTitle'),
  noteContent: $('noteContent'),
  wordCount: $('wordCount'),
  confirmMask: $('confirmMask'),
  confirmTitle: $('confirmTitle'),
  confirmText: $('confirmText'),
  btnCancelDelete: $('btnCancelDelete'),
  btnConfirmDelete: $('btnConfirmDelete'),
};

const ICON_PIN =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 5.5 3 3.5H7l3-3.5L9 4z"/><path d="M12 13v7"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>';

const app = {
  view: 'list', // list | editor
  notes: [],
  total: 0,
  query: '',
  draft: null, // { id, title, content, pinned, createdAt, updatedAt }
  dirty: false,
  saving: false,
  saveTimer: 0,
  searchTimer: 0,
  confirmAction: null,
  loadSeq: 0,
};

/* ------------------------------------------------ 工具函数 */

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function formatTime(ts) {
  const time = Number(ts);
  if (!Number.isFinite(time) || time <= 0) return '';
  const date = new Date(time);
  const now = new Date();
  const hhmm = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  if (date.toDateString() === now.toDateString()) return '今天 ' + hhmm;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天 ' + hhmm;
  if (date.getFullYear() === now.getFullYear()) {
    return date.getMonth() + 1 + '月' + date.getDate() + '日 ' + hhmm;
  }
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function setSaveState(kind) {
  const labels = { saved: '已保存', saving: '保存中…', dirty: '待保存', error: '保存失败' };
  dom.saveState.dataset.state = kind;
  dom.saveState.textContent = labels[kind] || '已保存';
}

function toast(message, type) {
  try {
    toolkit.toast(message, type || 'info');
  } catch (_) {
    /* toast 不可用时静默 */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 3000);
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(40);
  }
  return predicate();
}

function showView(view) {
  const editing = view === 'editor';
  dom.viewList.dataset.state = editing ? 'hidden-left' : 'active';
  dom.viewEditor.dataset.state = editing ? 'active' : 'hidden-right';
  app.view = view;
}

/* ------------------------------------------------ 列表 */

function renderList() {
  const query = app.query.trim();
  const notes = app.notes;
  dom.noteList.replaceChildren();

  if (!notes.length) {
    dom.emptyState.classList.remove('tk-hidden');
    dom.emptyTitle.textContent = query ? '没有匹配的备忘录' : '还没有备忘录';
    dom.emptyHint.textContent = query ? '换个关键词试试' : '点击右上角「新建」，随手记下想法';
    dom.listSub.textContent = query ? '搜索 “' + query + '” · 0 条' : '共 0 条 · 自动保存';
    return;
  }

  dom.emptyState.classList.add('tk-hidden');
  dom.listSub.textContent =
    (query ? '搜索 “' + query + '” · ' : '共 ') + notes.length + ' 条 · 自动保存';

  const fragment = document.createDocumentFragment();
  notes.forEach((note, index) => {
    fragment.appendChild(createNoteCard(note, index));
  });
  dom.noteList.appendChild(fragment);
}

function createNoteCard(note, index) {
  const card = document.createElement('article');
  card.className = 'tk-card interactive note-card' + (note.pinned ? ' pinned' : '');
  card.dataset.id = note.id;
  card.tabIndex = 0;
  card.style.animationDelay = Math.min(index * 24, 160) + 'ms';

  const top = document.createElement('div');
  top.className = 'note-top';

  const title = document.createElement('h3');
  const hasTitle = !!String(note.title || '').trim();
  title.className = 'note-title' + (hasTitle ? '' : ' untitled');
  title.textContent = hasTitle ? note.title : '无标题';
  top.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'note-actions';

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'tk-icon-btn note-action pin' + (note.pinned ? ' is-pinned' : '');
  pinBtn.title = note.pinned ? '取消置顶' : '置顶';
  pinBtn.setAttribute('aria-label', pinBtn.title);
  pinBtn.innerHTML = ICON_PIN;
  pinBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePin(note.id);
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'tk-icon-btn note-action danger-hover';
  delBtn.title = '删除';
  delBtn.setAttribute('aria-label', '删除');
  delBtn.innerHTML = ICON_TRASH;
  delBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    askDelete(note);
  });

  actions.append(pinBtn, delBtn);
  top.appendChild(actions);

  const summary = document.createElement('p');
  summary.className = 'note-summary';
  const flat = String(note.content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat) {
    summary.textContent = flat.length > 80 ? flat.slice(0, 80) + '…' : flat;
  } else {
    summary.textContent = '（空内容）';
    summary.classList.add('empty');
  }

  const meta = document.createElement('div');
  meta.className = 'note-meta';
  const time = document.createElement('span');
  time.className = 'note-time';
  time.textContent = formatTime(note.updatedAt);
  meta.appendChild(time);
  if (note.pinned) {
    const badge = document.createElement('span');
    badge.className = 'tk-badge accent';
    badge.textContent = '置顶';
    meta.appendChild(badge);
  }

  card.append(top, summary, meta);
  card.addEventListener('click', () => openEditor(note));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openEditor(note);
    }
  });
  return card;
}

async function loadList(options) {
  const silent = !!(options && options.silent);
  const seq = ++app.loadSeq;
  try {
    const result = await toolkit.invoke('memo.list', { query: app.query.trim() });
    if (seq !== app.loadSeq) return;
    app.notes = Array.isArray(result && result.notes) ? result.notes : [];
    app.total = Number.isFinite(result && result.total) ? result.total : app.notes.length;
    renderList();
  } catch (err) {
    if (!silent) toast('读取备忘录失败：' + ((err && err.message) || '未知错误'), 'error');
  }
}

/* ------------------------------------------------ 编辑器 */

function updateEditorMeta() {
  if (!app.draft) return;
  dom.editorMeta.textContent = app.draft.id
    ? '更新于 ' + formatTime(app.draft.updatedAt) + ' · 自动保存'
    : '新备忘录 · 自动保存';
}

function updateWordCount() {
  const text = dom.noteContent.value || '';
  const chars = text.replace(/\s/g, '').length;
  dom.wordCount.textContent = chars + ' 字';
}

function updatePinButton() {
  const pinned = !!(app.draft && app.draft.pinned);
  dom.btnPin.classList.toggle('is-pinned', pinned);
  dom.btnPin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  dom.btnPin.title = pinned ? '取消置顶' : '置顶';
}

function openEditor(note) {
  app.draft = note
    ? {
        id: note.id,
        title: String(note.title || ''),
        content: String(note.content || ''),
        pinned: !!note.pinned,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      }
    : { id: null, title: '', content: '', pinned: false, createdAt: null, updatedAt: null };
  app.dirty = false;
  clearTimeout(app.saveTimer);
  app.saveTimer = 0;

  dom.noteTitle.value = app.draft.title;
  dom.noteContent.value = app.draft.content;
  dom.editorHeading.textContent = note ? '编辑备忘录' : '新建备忘录';
  setSaveState('saved');
  updateEditorMeta();
  updateWordCount();
  updatePinButton();
  showView('editor');

  requestAnimationFrame(() => {
    if (note) {
      dom.noteContent.focus();
      const length = dom.noteContent.value.length;
      try {
        dom.noteContent.setSelectionRange(length, length);
      } catch (_) {
        /* ignore */
      }
    } else {
      dom.noteTitle.focus();
    }
  });
}

function handleEdit() {
  if (!app.draft) return;
  app.draft.title = dom.noteTitle.value;
  app.draft.content = dom.noteContent.value;
  updateWordCount();
  app.dirty = true;
  setSaveState('dirty');
  clearTimeout(app.saveTimer);
  app.saveTimer = setTimeout(() => {
    app.saveTimer = 0;
    saveDraft();
  }, 400);
}

async function saveDraft() {
  if (!app.draft) return true;
  if (app.saving) {
    app.dirty = true;
    clearTimeout(app.saveTimer);
    app.saveTimer = setTimeout(() => {
      app.saveTimer = 0;
      saveDraft();
    }, 160);
    return false;
  }

  const title = app.draft.title;
  const content = app.draft.content;
  if (!app.draft.id && !title.trim() && !content.trim()) {
    app.dirty = false;
    setSaveState('saved');
    return true;
  }

  app.saving = true;
  app.dirty = false;
  setSaveState('saving');

  let ok = false;
  try {
    const result = await toolkit.invoke('memo.save', { id: app.draft.id, title, content });
    const note = result && result.note;
    if (note) {
      app.draft.id = note.id;
      app.draft.createdAt = note.createdAt;
      app.draft.updatedAt = note.updatedAt;
      app.draft.pinned = !!note.pinned;
      dom.editorHeading.textContent = '编辑备忘录';
      updateEditorMeta();
      updatePinButton();
    }
    ok = true;
  } catch (err) {
    setSaveState('error');
    app.dirty = true;
    toast('保存失败：' + ((err && err.message) || '未知错误'), 'error');
  } finally {
    app.saving = false;
  }

  if (!app.draft) return ok;

  // 保存期间又有新输入：保持待保存状态，稍后再存一次
  if (app.draft.title !== title || app.draft.content !== content) {
    app.dirty = true;
    if (ok) setSaveState('dirty');
    clearTimeout(app.saveTimer);
    app.saveTimer = setTimeout(() => {
      app.saveTimer = 0;
      saveDraft();
    }, 160);
  } else if (ok && !app.dirty) {
    setSaveState('saved');
  }

  if (ok) loadList({ silent: true });
  return ok;
}

async function flushSave() {
  clearTimeout(app.saveTimer);
  app.saveTimer = 0;
  if (app.saving) await waitUntil(() => !app.saving, 4000);
  if (!app.draft) return true;
  if (!app.dirty && !app.saving) {
    if (app.draft.id) return true;
    if (!app.draft.title.trim() && !app.draft.content.trim()) return true;
  }
  return saveDraft();
}

async function goBack() {
  if (app.view !== 'editor') return;
  const ok = await flushSave();
  if (!ok && app.dirty) {
    toast('还有内容未保存成功，请重试', 'error');
    return;
  }
  app.draft = null;
  app.dirty = false;
  clearTimeout(app.saveTimer);
  app.saveTimer = 0;
  showView('list');
  await loadList();
}

/* ------------------------------------------------ 置顶 / 删除 */

async function togglePin(noteId) {
  try {
    const result = await toolkit.invoke('memo.togglePin', { id: noteId });
    const note = result && result.note;
    if (note && app.draft && app.draft.id === note.id) {
      app.draft.pinned = !!note.pinned;
      updatePinButton();
    }
    await loadList();
    if (note) toast(note.pinned ? '已置顶' : '已取消置顶', 'success');
  } catch (err) {
    toast('操作失败：' + ((err && err.message) || '未知错误'), 'error');
  }
}

function askDelete(note) {
  app.confirmAction = () => performDelete(note);
  dom.confirmTitle.textContent = '删除这条备忘录？';
  dom.confirmText.textContent =
    '「' + (String(note.title || '').trim() || '无标题') + '」删除后不可恢复。';
  dom.confirmMask.classList.remove('tk-hidden');
  dom.confirmMask.setAttribute('aria-hidden', 'false');
  dom.btnCancelDelete.focus();
}

function closeConfirm() {
  app.confirmAction = null;
  dom.confirmMask.classList.add('tk-hidden');
  dom.confirmMask.setAttribute('aria-hidden', 'true');
}

async function performDelete(note) {
  closeConfirm();
  try {
    const result = await toolkit.invoke('memo.delete', { id: note.id });
    if (!result || !result.ok) throw new Error('删除失败');
    if (app.draft && app.draft.id === note.id) {
      app.draft = null;
      app.dirty = false;
      clearTimeout(app.saveTimer);
      app.saveTimer = 0;
      showView('list');
    }
    await loadList();
    toast('已删除', 'success');
  } catch (err) {
    toast('删除失败：' + ((err && err.message) || '未知错误'), 'error');
  }
}

/* ------------------------------------------------ 事件绑定 */

dom.btnNew.addEventListener('click', () => openEditor(null));
dom.btnBack.addEventListener('click', () => goBack());

dom.searchInput.addEventListener('input', () => {
  app.query = dom.searchInput.value;
  clearTimeout(app.searchTimer);
  app.searchTimer = setTimeout(() => {
    app.searchTimer = 0;
    loadList({ silent: true });
  }, 120);
});

dom.noteTitle.addEventListener('input', handleEdit);
dom.noteContent.addEventListener('input', handleEdit);

dom.btnPin.addEventListener('click', async () => {
  if (!app.draft) return;
  if (!app.draft.id) {
    const ok = await flushSave();
    if (!ok || !app.draft || !app.draft.id) {
      toast('写点内容保存后才能置顶', 'info');
      return;
    }
  }
  togglePin(app.draft.id);
});

dom.btnDelete.addEventListener('click', () => {
  if (!app.draft) return;
  if (!app.draft.id) {
    app.draft = null;
    app.dirty = false;
    clearTimeout(app.saveTimer);
    app.saveTimer = 0;
    showView('list');
    loadList({ silent: true });
    toast('已放弃草稿', 'info');
    return;
  }
  askDelete(app.draft);
});

dom.btnCancelDelete.addEventListener('click', closeConfirm);
dom.btnConfirmDelete.addEventListener('click', () => {
  const action = app.confirmAction;
  if (typeof action === 'function') action();
});
dom.confirmMask.addEventListener('click', (event) => {
  if (event.target === dom.confirmMask) closeConfirm();
});

document.addEventListener('keydown', (event) => {
  const confirmOpen = !dom.confirmMask.classList.contains('tk-hidden');

  if (event.key === 'Escape') {
    if (confirmOpen) {
      closeConfirm();
      return;
    }
    if (app.view === 'editor') goBack();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
    if (app.view !== 'editor') return;
    event.preventDefault();
    clearTimeout(app.saveTimer);
    app.saveTimer = 0;
    saveDraft().then((ok) => {
      if (ok) toast('已保存', 'success');
    });
  }
});

/* ------------------------------------------------ 后端事件 */

toolkit.on('memo:new', async () => {
  try {
    await toolkit.invoke('memo.takeIntent');
  } catch (_) {
    /* ignore */
  }
  if (app.view === 'editor') await flushSave();
  openEditor(null);
});

toolkit.on('panel:shown', () => {
  if (app.view !== 'editor') loadList({ silent: true });
});

toolkit.on('plugin:will-reload', () => {
  // 热重载前尽力保存（同步清理由宿主负责）
  clearTimeout(app.saveTimer);
});

/* ------------------------------------------------ 启动 */

(async () => {
  try {
    await loadList();
    const intent = await toolkit.invoke('memo.takeIntent');
    if (intent && intent.create) openEditor(null);
  } catch (err) {
    toast('初始化失败：' + ((err && err.message) || '未知错误'), 'error');
  }
})();
