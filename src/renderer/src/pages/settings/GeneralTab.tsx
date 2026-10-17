import { useState } from 'react';
import type { Settings } from '@shared/types';
import { invoke, toast } from '../../lib/bridge';
import { Icon } from '../../ui/Icon';
import { Group, Row, Switch, errorMessage, useConfirm, usePatcher } from './common';

export function GeneralTab({ settings }: { settings: Settings }) {
  const patch = usePatcher();
  const confirm = useConfirm();
  const [resetting, setResetting] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);

  const setLaunchAtLogin = async (enabled: boolean) => {
    if (launchBusy) return;
    setLaunchBusy(true);
    try {
      const ok = await patch({ general: { launchAtLogin: enabled } }, enabled ? '已开启开机自启' : '已关闭开机自启');
      if (ok) await invoke('core', 'app.setLoginItem', { enabled });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setLaunchBusy(false);
    }
  };

  const setShowBall = async (visible: boolean) => {
    const ok = await patch({ general: { showBall: visible } }, visible ? '悬浮球已显示' : '悬浮球已隐藏');
    if (!ok) return;
    try {
      await invoke('core', 'ball.setVisible', { visible });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const resetAll = async () => {
    const ok = await confirm({
      title: '恢复默认设置',
      message: '所有设置项（外观、快捷键、截图、录制等）都会恢复为出厂默认值，已自定义的插件代码不受影响。',
      confirmText: '恢复默认',
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      await invoke('core', 'settings.reset');
      toast('已恢复默认设置', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <Group title="启动与常驻">
        <Row title="开机自启" desc="登录 Windows 后在后台启动便捷工具">
          <Switch
            checked={settings.general.launchAtLogin}
            disabled={launchBusy}
            onChange={(next) => void setLaunchAtLogin(next)}
            label="开机自启"
          />
        </Row>
        <Row title="显示悬浮球" desc="在桌面边缘常驻一个小球，点击即可唤起面板">
          <Switch checked={settings.general.showBall} onChange={(next) => void setShowBall(next)} label="显示悬浮球" />
        </Row>
      </Group>

      <Group title="面板行为">
        <Row title="失焦自动关闭" desc="点击面板以外的区域时自动收起，减少打扰">
          <Switch
            checked={settings.general.closePanelOnBlur}
            onChange={(next) => void patch({ general: { closePanelOnBlur: next } }, next ? '已开启失焦自动关闭' : '已关闭失焦自动关闭')}
            label="失焦自动关闭"
          />
        </Row>
        <Row title="记住面板尺寸" desc="下次打开时沿用上次调整的窗口大小">
          <Switch
            checked={settings.general.rememberPanelSize}
            onChange={(next) => void patch({ general: { rememberPanelSize: next } })}
            label="记住面板尺寸"
          />
        </Row>
      </Group>

      <Group title="数据与重置">
        <Row
          title="恢复默认设置"
          desc="将全部设置项恢复为出厂默认值，操作会立即生效"
          controlWidth="wide"
        >
          <button type="button" className="tk-btn sm" onClick={() => void resetAll()} disabled={resetting}>
            <Icon name="refresh" size={13} />
            {resetting ? '正在恢复…' : '恢复默认'}
          </button>
        </Row>
      </Group>
    </>
  );
}
