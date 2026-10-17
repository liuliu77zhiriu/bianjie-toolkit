/**
 * 截图插件后端（capture-dev）。
 *
 * 只做流程编排：区域框选 → ctx.media.captureRegion / captureFullscreen /
 * captureWindow，保存目录、命名、剪贴板由 ctx.media 统一处理。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PANEL_HIDE_WAIT = 240;

let commandDisposers = [];
let lastCapture = null;
let pendingMode = null;

function errorText(err) {
  if (err && typeof err === 'object' && 'message' in err) return String(err.message || err);
  return String(err);
}

function getCaptureSettings(ctx) {
  try {
    return ctx.settings.get().capture;
  } catch {
    return { showPanelAfter: true, format: 'png', copyToClipboard: true };
  }
}

function rememberCapture(ctx, result) {
  lastCapture = result;
  try {
    ctx.store.set('last', result);
  } catch (err) {
    ctx.log.warn('保存最近截图失败', errorText(err));
  }
}

async function hidePanel(ctx) {
  try {
    ctx.panel.close();
  } catch (err) {
    ctx.log.warn('收起面板失败', errorText(err));
  }
  await sleep(PANEL_HIDE_WAIT);
}

function showPanel(ctx) {
  try {
    ctx.panel.show('screenshot');
  } catch (err) {
    ctx.log.warn('打开面板失败', errorText(err));
  }
}

function notifyError(ctx, title, err) {
  const message = errorText(err);
  ctx.log.error(title, message);
  try {
    ctx.notifications.show({ title, body: message });
  } catch {
    /* ignore */
  }
}

/** 成功后：广播结果 → 按设置回到面板或发系统通知。 */
function finishCapture(ctx, result) {
  rememberCapture(ctx, result);
  try {
    ctx.events.broadcast('shot:done', result);
  } catch (err) {
    ctx.log.warn('广播截图结果失败', errorText(err));
  }
  if (getCaptureSettings(ctx).showPanelAfter) {
    showPanel(ctx);
  } else {
    try {
      ctx.notifications.show({ title: '截图已保存', body: result.path });
    } catch {
      /* ignore */
    }
  }
  return result;
}

/** 区域截图：先收面板 → 框选 → 裁剪保存。取消时静默返回 null。 */
async function runRegion(ctx, fromUI) {
  await hidePanel(ctx);
  const picked = await ctx.overlay.pickRegion({ hint: '拖拽选择区域 · Esc 取消' });
  if (!picked) {
    if (fromUI && getCaptureSettings(ctx).showPanelAfter) showPanel(ctx);
    return null;
  }
  const result = await ctx.media.captureRegion({
    displayId: picked.displayId,
    rect: picked.rect,
    hidePanel: false,
  });
  return finishCapture(ctx, result);
}

async function runFull(ctx, displayId) {
  await hidePanel(ctx);
  const result = await ctx.media.captureFullscreen({
    displayId: displayId || undefined,
    hidePanel: false,
  });
  return finishCapture(ctx, result);
}

async function runWindow(ctx, sourceId) {
  if (!sourceId) throw new Error('请选择要截图的窗口');
  await hidePanel(ctx);
  const result = await ctx.media.captureWindow({ sourceId, hidePanel: false });
  return finishCapture(ctx, result);
}

export default {
  activate(ctx) {
    commandDisposers = [];
    pendingMode = null;
    try {
      lastCapture = ctx.store.get('last', null);
    } catch {
      lastCapture = null;
    }

    /* ------------------------------------------------ IPC（UI → 后端） */

    ctx.ipc.handle('last', () => lastCapture);

    ctx.ipc.handle('sources', async (args) => {
      const kinds = Array.isArray(args?.kinds) && args.kinds.length ? args.kinds : ['screen', 'window'];
      return ctx.media.listSources({ kinds, thumbnailWidth: args?.thumbnailWidth || 320 });
    });

    ctx.ipc.handle('pending', () => {
      const mode = pendingMode;
      pendingMode = null;
      return mode;
    });

    ctx.ipc.handle('region', async (args) => {
      try {
        return await runRegion(ctx, args?.fromUI !== false);
      } catch (err) {
        notifyError(ctx, '区域截图失败', err);
        throw err;
      }
    });

    ctx.ipc.handle('full', async (args) => {
      try {
        return await runFull(ctx, args?.displayId);
      } catch (err) {
        notifyError(ctx, '全屏截图失败', err);
        throw err;
      }
    });

    ctx.ipc.handle('window', async (args) => {
      try {
        return await runWindow(ctx, args?.sourceId);
      } catch (err) {
        notifyError(ctx, '窗口截图失败', err);
        throw err;
      }
    });

    ctx.ipc.handle('copy', (args) => {
      const file = args?.path || lastCapture?.path;
      if (!file) throw new Error('还没有可复制的截图');
      ctx.clipboard.writeImage(file);
      return true;
    });

    ctx.ipc.handle('reveal', (args) => {
      const file = args?.path || lastCapture?.path;
      if (!file) throw new Error('还没有可打开的截图');
      ctx.shell.showItemInFolder(file);
      return true;
    });

    /* ------------------------------------------------ 命令（托盘 / 快捷键） */

    commandDisposers.push(
      ctx.commands.register({
        id: 'screenshot.region',
        label: '区域截图',
        description: '框选屏幕区域并保存',
        defaultAccelerator: 'Alt+A',
        run: async () => {
          try {
            return await runRegion(ctx, false);
          } catch (err) {
            notifyError(ctx, '区域截图失败', err);
            return null;
          }
        },
      })
    );

    commandDisposers.push(
      ctx.commands.register({
        id: 'screenshot.full',
        label: '全屏截图',
        description: '截取当前主显示器并保存',
        defaultAccelerator: 'Alt+S',
        run: async () => {
          try {
            return await runFull(ctx, null);
          } catch (err) {
            notifyError(ctx, '全屏截图失败', err);
            return null;
          }
        },
      })
    );

    commandDisposers.push(
      ctx.commands.register({
        id: 'screenshot.window',
        label: '窗口截图',
        description: '打开截图面板并选择窗口',
        run: async () => {
          pendingMode = 'window';
          showPanel(ctx);
          await sleep(460);
          try {
            ctx.events.broadcast('shot:pick-window', {});
          } catch {
            /* ignore */
          }
          return null;
        },
      })
    );

    ctx.log.info('截图插件已就绪，最近截图:', lastCapture?.path || '无');
  },

  deactivate() {
    for (const dispose of commandDisposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    commandDisposers = [];
    pendingMode = null;
    lastCapture = null;
  },
};
