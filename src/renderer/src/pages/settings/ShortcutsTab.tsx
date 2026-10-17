import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import { formatHotkey, invoke, toast } from '../../lib/bridge';
import { Icon } from '../../ui/Icon';
import { Group, HotkeyField, Row, errorMessage, usePatcher } from './common';

type ShortcutKey = keyof Settings['shortcuts'];

interface ShortcutStatus {
  key: ShortcutKey;
  action: string;
  accelerator: string;
  ok: boolean;
  error?: string;
}

const ACTIONS: Array<{ key: ShortcutKey; title: string; desc: string; fallback: string }> = [
  { key: 'togglePanel', title: '显示 / 隐藏面板', desc: '全局唤起或收起主面板', fallback: DEFAULT_SETTINGS.shortcuts.togglePanel },
  { key: 'screenshotRegion', title: '区域截图', desc: '框选屏幕区域并保存', fallback: DEFAULT_SETTINGS.shortcuts.screenshotRegion },
  { key: 'screenshotFull', title: '全屏截图', desc: '截取当前整块屏幕', fallback: DEFAULT_SETTINGS.shortcuts.screenshotFull },
  { key: 'recordToggle', title: '开始 / 停止录制', desc: '一键开始或结束屏幕录制', fallback: DEFAULT_SETTINGS.shortcuts.recordToggle },
  { key: 'memo', title: '打开备忘录', desc: '唤起备忘录并新建一条记录', fallback: DEFAULT_SETTINGS.shortcuts.memo },
];

export function ShortcutsTab({ settings }: { settings: Settings }) {
  const patch = usePatcher();
  const [statuses, setStatuses] = useState<ShortcutStatus[]>([]);
  const [restoring, setRestoring] = useState(false);

  const refreshStatus = useCallback(async (showError = false) => {
    try {
      const list = await invoke<ShortcutStatus[]>('core', 'shortcuts.status');
      setStatuses(Array.isArray(list) ? list : []);
    } catch (err) {
      if (showError) toast(errorMessage(err), 'error');
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const setShortcut = async (key: ShortcutKey, value: string, title: string) => {
    if (value) {
      const duplicated = ACTIONS.find((action) => action.key !== key && settings.shortcuts[action.key].toLowerCase() === value.toLowerCase());
      if (duplicated) {
        toast(`该快捷键已被「${duplicated.title}」使用`, 'error');
        return;
      }
    }
    if (!value) {
      const ok = await patch({ shortcuts: { ...settings.shortcuts, [key]: '' } }, '快捷键已清除');
      if (ok) await refreshStatus();
      return;
    }
    const ok = await patch({ shortcuts: { ...settings.shortcuts, [key]: value } });
    if (!ok) return;
    let list: ShortcutStatus[] = [];
    try {
      list = await invoke<ShortcutStatus[]>('core', 'shortcuts.status');
      setStatuses(Array.isArray(list) ? list : []);
    } catch {
      list = [];
    }
    const current = list.find((item) => item.key === key);
    if (current && !current.ok) {
      toast(`${formatHotkey(value)} 未生效：${current.error ?? '快捷键冲突'}`, 'error');
    } else {
      toast(`「${title}」快捷键已更新`, 'success');
    }
  };

  const restoreDefaults = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const ok = await patch({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts } }, '快捷键已恢复默认');
      if (ok) await refreshStatus(true);
    } finally {
      setRestoring(false);
    }
  };

  const failed = statuses.filter((item) => !item.ok && item.accelerator.trim().length > 0);
  const registered = statuses.filter((item) => item.accelerator.trim().length > 0);
  const allRegistered = statuses.length > 0 && registered.length === statuses.length && failed.length === 0;

  return (
    <>
      <Group
        title="全局快捷键"
        actions={
          <button type="button" className="tk-btn sm ghost" onClick={() => void restoreDefaults()} disabled={restoring}>
            <Icon name="refresh" size={12} />
            恢复默认
          </button>
        }
      >
        {ACTIONS.map((action) => {
          const value = settings.shortcuts[action.key];
          const status = statuses.find((item) => item.key === action.key);
          return (
            <Row
              key={action.key}
              title={action.title}
              desc={action.desc}
              stacked
            >
              <div className="hotkey-row">
                <HotkeyField
                  value={value}
                  label={action.title}
                  onChange={(next) => void setShortcut(action.key, next, action.title)}
                />
                {status ? (
                  status.ok ? (
                    <span className="hotkey-state ok" title="已注册生效">
                      <Icon name="check" size={12} />
                    </span>
                  ) : value ? (
                    <span className="hotkey-state bad" title={status.error ?? '未生效'}>
                      <Icon name="close" size={12} />
                    </span>
                  ) : null
                ) : null}
                {value ? (
                  <button
                    type="button"
                    className="tk-icon-btn hotkey-clear"
                    title="清除快捷键"
                    aria-label={`清除${action.title}快捷键`}
                    onClick={() => void setShortcut(action.key, '', action.title)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                ) : null}
              </div>
            </Row>
          );
        })}
      </Group>

      {failed.length ? (
        <div className="shortcut-alert">
          <div className="shortcut-alert-title">
            <Icon name="info" size={13} />
            以下快捷键未能注册，可能被系统或其他软件占用
          </div>
          <div className="shortcut-alert-body">
            {failed.map((item) => (
              <span key={item.key} className="tk-badge danger" title={item.error}>
                {formatHotkey(item.accelerator)} · {item.error ?? '被占用'}
              </span>
            ))}
          </div>
        </div>
      ) : allRegistered ? (
        <div className="settings-note">
          <Icon name="check" size={12} />
          全部快捷键均已注册生效，点击输入框后直接按下组合键即可修改
        </div>
      ) : (
        <div className="settings-note">点击快捷键输入框，按下 Ctrl / Alt / Shift / Win 加按键组合完成录制</div>
      )}
    </>
  );
}
