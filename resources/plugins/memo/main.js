/* ============================================================
 * 备忘录 · 后端插件模块（主进程）
 *
 * 数据（ctx.store key = "notes"）：
 *   [{ id, title, content, pinned, createdAt, updatedAt }]
 *
 * IPC：
 *   memo.list      { query? } -> { notes, total }
 *   memo.save      { id?, title?, content? } -> { note, created }
 *   memo.delete    { id } -> { ok, id }
 *   memo.togglePin { id } -> { note }
 *   memo.takeIntent -> { create }   （memo.new 命令遗留的“新建”意图）
 * ============================================================ */

const NOTES_KEY = 'notes';
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 50000;

let ctxRef = null;
let createIntent = false;
let disposers = [];

function warn(message, detail) {
  try {
    if (ctxRef && ctxRef.log && typeof ctxRef.log.warn === 'function') ctxRef.log.warn(message, detail);
  } catch (_) {
    /* 日志失败不影响业务 */
  }
}

function makeId() {
  return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
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

function toText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').slice(0, maxLen);
}

function toTimestamp(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const createdAt = toTimestamp(raw.createdAt, Date.now());
  return {
    id: raw.id,
    title: toText(raw.title, MAX_TITLE_LEN),
    content: toText(raw.content, MAX_CONTENT_LEN),
    pinned: raw.pinned === true,
    createdAt,
    updatedAt: toTimestamp(raw.updatedAt, createdAt),
  };
}

function readNotes() {
  if (!ctxRef || !ctxRef.store) return [];
  const raw = readStore(NOTES_KEY, []);
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const notes = [];
  for (const item of raw) {
    const note = normalizeNote(item);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  return notes;
}

function writeNotes(notes) {
  if (!ctxRef || !ctxRef.store) throw new Error('存储不可用');
  ctxRef.store.set(NOTES_KEY, notes);
}

function sortNotes(notes) {
  return notes.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return b.createdAt - a.createdAt;
  });
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

function listNotes(args) {
  const query = args && typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
  const all = sortNotes(readNotes());
  const notes = query
    ? all.filter((note) => {
        return (
          note.title.toLowerCase().indexOf(query) >= 0 || note.content.toLowerCase().indexOf(query) >= 0
        );
      })
    : all;
  return { notes, total: all.length, query };
}

function saveNote(args) {
  const payload = args && typeof args === 'object' ? args : {};
  const title = toText(payload.title, MAX_TITLE_LEN);
  const content = toText(payload.content, MAX_CONTENT_LEN);
  const id = typeof payload.id === 'string' && payload.id ? payload.id : '';
  const notes = readNotes();
  const now = Date.now();

  if (id) {
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) throw new Error('备忘录不存在或已被删除');
    const previous = notes[index];
    const next = {
      ...previous,
      title,
      content,
      updatedAt: Math.max(now, previous.updatedAt + 1),
    };
    notes[index] = next;
    writeNotes(notes);
    return { note: next, created: false };
  }

  // 空草稿不落库，避免自动保存产生大量空记录
  if (!title.trim() && !content.trim()) return { note: null, created: false };

  const note = {
    id: makeId(),
    title,
    content,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  notes.push(note);
  writeNotes(notes);
  return { note, created: true };
}

function deleteNote(args) {
  const id = args && typeof args.id === 'string' ? args.id : '';
  if (!id) return { ok: false, id, reason: 'invalid-id' };
  const notes = readNotes();
  const next = notes.filter((note) => note.id !== id);
  if (next.length === notes.length) return { ok: false, id, reason: 'not-found' };
  writeNotes(next);
  return { ok: true, id };
}

function togglePin(args) {
  const id = args && typeof args.id === 'string' ? args.id : '';
  const notes = readNotes();
  const index = notes.findIndex((note) => note.id === id);
  if (index < 0) throw new Error('备忘录不存在或已被删除');
  const next = { ...notes[index], pinned: !notes[index].pinned };
  notes[index] = next;
  writeNotes(notes);
  return { note: next };
}

function takeIntent() {
  const create = createIntent;
  createIntent = false;
  return { create };
}

function registerIpc(ctx) {
  const handlers = {
    'memo.list': listNotes,
    'memo.save': saveNote,
    'memo.delete': deleteNote,
    'memo.togglePin': togglePin,
    'memo.takeIntent': takeIntent,
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

export default {
  activate(ctx) {
    ctxRef = ctx;
    createIntent = false;
    try {
      disposers = registerIpc(ctx);
      const dispose = ctx.commands.register({
        id: 'memo.new',
        label: '新建备忘录',
        description: '打开备忘录面板并新建一条记录',
        // 不占用默认快捷键：核心设置 shortcuts.memo（默认 Alt+M）由内核统一绑定到本命令
        run: async () => {
          createIntent = true;
          try {
            await ctx.panel.show('memo');
          } catch (err) {
            warn('打开备忘录面板失败', err);
          }
          // 面板已经打开时通过事件即时切到编辑器；面板刚打开时由 takeIntent 兜底
          broadcast('memo:new', { at: Date.now() });
        },
      });
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (err) {
      warn('备忘录初始化失败', err);
    }
  },
  deactivate() {
    createIntent = false;
    disposers.forEach((dispose) => {
      try {
        dispose();
      } catch (err) {
        warn('清理资源失败', err);
      }
    });
    disposers = [];
    flushStore();
    ctxRef = null;
  },
};
