import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import type { AppPaths, CommandInfo, Settings } from '../../shared/types';
import type { Logger } from './logger';

export interface TrayDeps {
  paths: AppPaths;
  logger: Logger;
  getSettings: () => Settings;
  commands: () => CommandInfo[];
  togglePanel: () => void;
  openSettings: () => void;
  runCommand: (id: string) => void;
  setBallVisible: (visible: boolean) => void;
  isBallVisible: () => boolean;
  quit: () => void;
}

export class TrayManager {
  private tray: Tray | null = null;

  constructor(private deps: TrayDeps) {}

  create() {
    if (this.tray) return;
    const iconPath = path.join(this.deps.paths.resourcesDir, 'icons', 'tray.png');
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty();
    }
    icon = icon.resize({ width: 16, height: 16 });
    try {
      this.tray = new Tray(icon);
    } catch (err) {
      this.deps.logger.warn('[tray] 创建托盘失败', err);
      return;
    }
    this.tray.setToolTip('便捷工具');
    this.tray.on('click', () => this.deps.togglePanel());
    this.tray.on('double-click', () => this.deps.togglePanel());
    this.rebuild();
  }

  rebuild() {
    if (!this.tray) return;
    const settings = this.deps.getSettings();
    const commands = this.deps.commands();
    const quick = commands.filter((cmd) =>
      ['screenshot.region', 'screenshot.full', 'recorder.toggle', 'recorder.start', 'memo.new', 'timer.toggle'].includes(cmd.id)
    );
    const seen = new Set<string>();
    const toolItems: MenuItemConstructorOptions[] = [];
    for (const cmd of quick) {
      if (seen.has(cmd.id)) continue;
      seen.add(cmd.id);
      toolItems.push({ label: cmd.label, click: () => this.deps.runCommand(cmd.id) });
    }
    if (!toolItems.length) toolItems.push({ label: '暂无可用的快捷操作', enabled: false });

    const template: MenuItemConstructorOptions[] = [
      { label: '打开工具箱', click: () => this.deps.togglePanel() },
      { type: 'separator' },
      { label: '快捷操作', submenu: toolItems },
      { type: 'separator' },
      { label: '设置', click: () => this.deps.openSettings() },
      {
        label: '显示悬浮球',
        type: 'checkbox',
        checked: this.deps.isBallVisible() && settings.general.showBall,
        click: (item) => this.deps.setBallVisible(item.checked),
      },
      { type: 'separator' },
      { label: '退出便捷工具', click: () => this.deps.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
    this.tray.setToolTip('便捷工具 · 截图 / 录制 / 备忘 / 计时');
  }

  destroy() {
    try {
      this.tray?.destroy();
    } catch {
      /* ignore */
    }
    this.tray = null;
  }
}
