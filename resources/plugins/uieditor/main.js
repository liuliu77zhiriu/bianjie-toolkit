/**
 * UI 编辑器 · 插件入口
 * 真正的编辑器是一个独立的大窗口（React 工作台），这里只负责注册命令/缩略入口。
 */
export default {
  activate(ctx) {
    ctx.ipc.handle('open', async () => {
      ctx.uieditor.open();
      return { ok: true };
    });
    ctx.ipc.handle('openProject', async (args) => {
      const projectId = args && typeof args.projectId === 'string' ? args.projectId : undefined;
      ctx.uieditor.open(projectId);
      return { ok: true };
    });
    ctx.commands.register({
      id: 'open',
      label: '打开 UI 编辑器',
      description: '进入可视化 UI 设计工作台',
      run: async () => {
        ctx.uieditor.open();
      },
    });
  },
  deactivate() {},
};

