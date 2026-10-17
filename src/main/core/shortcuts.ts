import { globalShortcut } from 'electron';
import type { Settings } from '../../shared/types';
import type { SettingsService } from './settings';
import type { Logger } from './logger';
import type { PluginHost } from './plugin-host';
import type { WindowManager } from './windows';
import { ToolkitError } from './errors';

export interface ShortcutStatus {
  key: keyof Settings['shortcuts'];
  action: string;
  accelerator: string;
  ok: boolean;
  error?: string;
}

export class ShortcutManager {
  private status: ShortcutStatus[] = [];
  private applied = new Map<string, string>();

  constructor(
    private deps: {
      settings: SettingsService;
      logger: Logger;
      plugins: PluginHost;
      windows: WindowManager;
    }
  ) {}

  apply(settings?: Settings) {
    const current = settings ?? this.deps.settings.get();
    this.unregisterAll();
    const entries: Array<{ key: keyof Settings['shortcuts']; action: string; accel: string; run: () => void }> = [
      {
        key: 'togglePanel',
        action: '显示/隐藏面板',
        accel: current.shortcuts.togglePanel,
        run: () => this.deps.windows.togglePanel(),
      },
      {
        key: 'screenshotRegion',
        action: '区域截图',
        accel: current.shortcuts.screenshotRegion,
        run: () => void this.runCommand('screenshot.region'),
      },
      {
        key: 'screenshotFull',
        action: '全屏截图',
        accel: current.shortcuts.screenshotFull,
        run: () => void this.runCommand('screenshot.full'),
      },
      {
        key: 'recordToggle',
        action: '开始/停止录制',
        accel: current.shortcuts.recordToggle,
        run: () => void this.runCommand('recorder.toggle'),
      },
      {
        key: 'memo',
        action: '打开备忘录',
        accel: current.shortcuts.memo,
        run: () => {
          this.deps.windows.openPanel('memo');
          void this.deps.plugins.runCommand('memo.new').catch(() => undefined);
        },
      },
    ];

    this.status = entries.map((entry) => {
      const accel = (entry.accel || '').trim();
      if (!accel) return { key: entry.key, action: entry.action, accelerator: '', ok: false, error: '未设置' };
      if (accel === 'Esc') return { key: entry.key, action: entry.action, accelerator: accel, ok: false, error: 'Esc 不可用' };
      try {
        const ok = globalShortcut.register(accel, entry.run);
        if (!ok) {
          return { key: entry.key, action: entry.action, accelerator: accel, ok: false, error: '快捷键被占用' };
        }
        this.applied.set(entry.key, accel);
        return { key: entry.key, action: entry.action, accelerator: accel, ok: true };
      } catch (err) {
        return {
          key: entry.key,
          action: entry.action,
          accelerator: accel,
          ok: false,
          error: err instanceof Error ? err.message : '无效快捷键',
        };
      }
    });
    const failed = this.status.filter((s) => !s.ok);
    if (failed.length) this.deps.logger.warn('[shortcuts] 未生效：', failed.map((f) => `${f.accelerator}(${f.error})`).join(', '));
  }

  private async runCommand(id: string) {
    try {
      await this.deps.plugins.runCommand(id);
    } catch (err) {
      if (err instanceof ToolkitError) {
        this.deps.logger.warn(`[shortcuts] 命令不可用 ${id}: ${err.message}`);
        if (id.startsWith('screenshot')) this.deps.windows.openPanel('screenshot');
        if (id.startsWith('recorder')) this.deps.windows.openPanel('recorder');
      } else {
        this.deps.logger.error('[shortcuts] 执行失败', err);
      }
    }
  }

  getStatus(): ShortcutStatus[] {
    return this.status.map((s) => ({ ...s }));
  }

  unregisterAll() {
    for (const accel of this.applied.values()) {
      try {
        globalShortcut.unregister(accel);
      } catch {
        /* ignore */
      }
    }
    this.applied.clear();
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* ignore */
    }
  }

  dispose() {
    this.unregisterAll();
  }
}
