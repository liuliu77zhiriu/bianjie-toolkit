/**
 * 录屏插件后端（capture-dev）。
 *
 * 职责：来源枚举、启动/停止/取消编排、状态转发（ctx.media.onState →
 * ctx.events.broadcast('rec:state')）、录制指示器小窗管理、命令注册。
 * 真正的录制、保存目录、编码均由 ctx.media 负责。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ACTIVE_PHASES = new Set(['preparing', 'countdown', 'recording', 'stopping']);
const INDICATOR_KEY = 'indicator';

let unsubMedia = null;
let lastState = null;
let lastResult = null;
let activeId = null;
let activeCtx = null;

function errorText(err) {
  if (err && typeof err === 'object' && 'message' in err) return String(err.message || err);
  return String(err);
}

function isActive() {
  return !!(lastState && ACTIVE_PHASES.has(lastState.phase));
}

function summarizeState(state) {
  if (!state) return null;
  return {
    id: state.id,
    phase: state.phase,
    startedAt: state.startedAt,
    durationMs: state.durationMs,
    path: state.path,
    error: state.error,
    countdownLeft: state.countdownLeft,
    sizeBytes: state.sizeBytes,
    format: state.format,
  };
}

function resultFromState(state) {
  if (!state || !state.path) return null;
  return {
    path: state.path,
    durationMs: Math.max(0, Math.round(state.durationMs || 0)),
    sizeBytes: typeof state.sizeBytes === 'number' ? state.sizeBytes : 0,
    format: state.format || 'mp4',
  };
}

function broadcast(ctx, topic, payload) {
  try {
    ctx.events.broadcast(topic, payload);
  } catch (err) {
    ctx.log.warn(`广播 ${topic} 失败`, errorText(err));
  }
}

function closeIndicator(ctx) {
  try {
    ctx.windows.close(INDICATOR_KEY);
  } catch (err) {
    ctx.log.warn('关闭录制指示器失败', errorText(err));
  }
}

async function openIndicator(ctx) {
  try {
    await ctx.windows.open({
      key: INDICATOR_KEY,
      page: 'indicator.html',
      width: 224,
      height: 64,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      position: 'top-right',
      hideOnClose: true,
      resizable: false,
      focusable: true,
    });
  } catch (err) {
    ctx.log.warn('打开录制指示器失败', errorText(err));
  }
}

function storeSet(ctx, key, value) {
  try {
    void ctx.store.set(key, value);
  } catch (err) {
    ctx.log.warn(`保存 ${key} 失败`, errorText(err));
  }
}

function storeGet(ctx, key, fallback) {
  try {
    const value = ctx.store.get(key, fallback);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function readLastSource(ctx) {
  const saved = storeGet(ctx, 'lastSource', null);
  if (saved && typeof saved.sourceId === 'string' && saved.sourceId) return saved;
  return null;
}

async function pickFallbackSource(ctx) {
  const saved = readLastSource(ctx);
  if (saved) return saved;
  const sources = await ctx.media.listSources({ kinds: ['screen'], thumbnailWidth: 64 });
  const first = sources && sources[0];
  if (!first) throw new Error('没有找到可录制的屏幕');
  return { sourceId: first.id, kind: 'screen', displayId: first.displayId };
}

/** 开始录制（UI 与快捷键共用）。 */
async function startFlow(ctx, args) {
  if (isActive()) throw new Error('已有录制正在进行，请先停止');
  const recorderSettings = ctx.settings.get().recorder;

  let sourceId = typeof args?.sourceId === 'string' ? args.sourceId.trim() : '';
  let kind = args?.kind === 'window' ? 'window' : 'screen';
  let displayId = args?.displayId ? String(args.displayId) : undefined;
  let sourceName = args?.name ? String(args.name) : '';

  if (!sourceId) {
    const fallback = await pickFallbackSource(ctx);
    sourceId = fallback.sourceId;
    kind = fallback.kind === 'window' ? 'window' : 'screen';
    displayId = fallback.displayId;
    sourceName = sourceName || '上次的录制来源';
  }

  // 来源校验：窗口可能已经关闭，给出可读错误而不是录出黑屏。
  try {
    const kinds = kind === 'window' ? ['window'] : ['screen'];
    const sources = await ctx.media.listSources({ kinds, thumbnailWidth: 64 });
    if (sources.length && !sources.some((item) => item.id === sourceId)) {
      throw new Error('所选录制来源已关闭，请刷新来源后重试');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('来源已关闭')) throw err;
    ctx.log.warn('录制来源校验失败，继续尝试录制', errorText(err));
  }

  const audio = args?.audio || recorderSettings.audio;
  const fps = args?.fps || recorderSettings.fps;
  const quality = typeof args?.quality === 'number' ? args.quality : recorderSettings.quality;
  const countdown = typeof args?.countdown === 'number' ? args.countdown : recorderSettings.countdown;
  const maxDurationSec = recorderSettings.maxDurationMin > 0 ? recorderSettings.maxDurationMin * 60 : 0;

  // 先收起面板：留出淡出时间，避免把面板录进画面（媒体层还会再兜底隐藏一次）。
  try {
    ctx.panel.close();
  } catch (err) {
    ctx.log.warn('收起面板失败', errorText(err));
  }
  await sleep(260);

  const { id } = await ctx.media.startRecording({
    sourceId,
    kind,
    displayId,
    audio,
    fps,
    quality,
    countdown,
    maxDurationSec,
  });
  activeId = id;
  storeSet(ctx, 'lastSource', { sourceId, kind, displayId, name: sourceName });
  broadcast(ctx, 'rec:started', { id, countdown, audio, fps });
  void openIndicator(ctx);
  return { id, countdown, audio, fps, sourceId, kind };
}

async function stopFlow(ctx) {
  const id = lastState?.id || activeId;
  if (!id) {
    if (lastResult) return { alreadyStopped: true, result: lastResult };
    throw new Error('当前没有进行中的录制');
  }
  if (!isActive()) {
    closeIndicator(ctx);
    if (lastResult) return { alreadyStopped: true, result: lastResult };
    throw new Error('当前没有进行中的录制');
  }
  try {
    const result = await ctx.media.stopRecording(id);
    activeId = null;
    lastResult = result;
    storeSet(ctx, 'lastResult', result);
    return result;
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : '';
    if (code === 'RECORDING_NOT_STARTED' || code === 'RECORDING_CANCELLED') {
      activeId = null;
      closeIndicator(ctx);
      broadcast(ctx, 'rec:cancelled', { reason: errorText(err) });
      return { cancelled: true };
    }
    throw err;
  }
}

export default {
  activate(ctx) {
    activeCtx = ctx;
    lastState = null;
    lastResult = storeGet(ctx, 'lastResult', null);
    activeId = null;

    /* ------------------------------------------------ 媒体状态订阅 → UI */

    unsubMedia = ctx.media.onState((state) => {
      const summary = summarizeState(state);
      lastState = summary;
      if (summary.phase === 'recording' && summary.id) activeId = summary.id;
      broadcast(ctx, 'rec:state', summary);

      if (summary.phase === 'done') {
        const result = resultFromState(summary) || lastResult;
        if (result) {
          lastResult = result;
          storeSet(ctx, 'lastResult', result);
          broadcast(ctx, 'rec:done', result);
        }
        activeId = null;
        closeIndicator(ctx);
        if (!ctx.panel.isOpen()) ctx.panel.show('recorder');
        try {
          ctx.notifications.show({
            title: '录制完成',
            body: result ? `已保存：${result.path}` : '录制已保存',
          });
        } catch {
          /* ignore */
        }
      } else if (summary.phase === 'error') {
        activeId = null;
        closeIndicator(ctx);
        broadcast(ctx, 'rec:error', { message: summary.error || '录制失败' });
        try {
          ctx.notifications.show({ title: '录制失败', body: summary.error || '录制失败' });
        } catch {
          /* ignore */
        }
        if (!ctx.panel.isOpen()) ctx.panel.show('recorder');
      } else if (summary.phase === 'cancelled') {
        activeId = null;
        closeIndicator(ctx);
        broadcast(ctx, 'rec:cancelled', {});
      }
    });

    /* ------------------------------------------------ IPC（UI → 后端） */

    ctx.ipc.handle('sources', async (args) => {
      const kinds = Array.isArray(args?.kinds) && args.kinds.length ? args.kinds : ['screen', 'window'];
      return ctx.media.listSources({ kinds, thumbnailWidth: args?.thumbnailWidth || 300 });
    });

    ctx.ipc.handle('state', () => summarizeState(lastState));

    ctx.ipc.handle('lastResult', () => lastResult);

    ctx.ipc.handle('start', async (args) => {
      try {
        return await startFlow(ctx, args);
      } catch (err) {
        ctx.log.error('开始录制失败', errorText(err));
        throw err;
      }
    });

    ctx.ipc.handle('stop', async () => {
      try {
        return await stopFlow(ctx);
      } catch (err) {
        ctx.log.error('停止录制失败', errorText(err));
        throw err;
      }
    });

    ctx.ipc.handle('cancel', async () => {
      const id = lastState?.id || activeId;
      if (id) {
        try {
          await ctx.media.cancelRecording(id);
        } catch (err) {
          ctx.log.warn('取消录制失败', errorText(err));
        }
      }
      activeId = null;
      closeIndicator(ctx);
      broadcast(ctx, 'rec:cancelled', {});
      return true;
    });

    ctx.ipc.handle('openFile', (args) => {
      const file = args?.path || lastResult?.path;
      if (!file) throw new Error('还没有录制文件');
      return ctx.shell.openPath(file);
    });

    ctx.ipc.handle('reveal', (args) => {
      const file = args?.path || lastResult?.path;
      if (!file) throw new Error('还没有录制文件');
      ctx.shell.showItemInFolder(file);
      return true;
    });

    ctx.ipc.handle('openRecorderPanel', () => {
      ctx.panel.show('recorder');
      return true;
    });

    /* ------------------------------------------------ 命令：Alt+R 开关 */

    ctx.commands.register({
      id: 'recorder.toggle',
      label: '开始 / 停止录制',
      description: '一键录制屏幕，再次触发停止',
      defaultAccelerator: 'Alt+R',
      run: async () => {
        try {
          if (isActive()) {
            const result = await stopFlow(ctx);
            return result;
          }
          const saved = await pickFallbackSource(ctx);
          return await startFlow(ctx, {
            sourceId: saved.sourceId,
            kind: saved.kind,
            displayId: saved.displayId,
            name: saved.name,
          });
        } catch (err) {
          ctx.log.error('录制快捷键执行失败', errorText(err));
          try {
            ctx.notifications.show({ title: '录制操作失败', body: errorText(err) });
          } catch {
            /* ignore */
          }
          return null;
        }
      },
    });

    ctx.log.info('录屏插件已就绪，上次结果:', lastResult?.path || '无');
  },

  deactivate(ctx) {
    const context = activeCtx || ctx || null;
    activeCtx = null;
    if (unsubMedia) {
      try {
        unsubMedia();
      } catch {
        /* ignore */
      }
      unsubMedia = null;
    }
    if (context) {
      const id = lastState?.id || activeId;
      if (id && isActive()) {
        try {
          void context.media.cancelRecording(id);
        } catch {
          /* ignore */
        }
      }
      closeIndicator(context);
    }
    lastState = null;
    activeId = null;
  },
};
