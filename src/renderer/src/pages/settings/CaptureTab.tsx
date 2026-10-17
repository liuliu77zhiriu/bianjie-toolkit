import type { CaptureFormat, Settings } from '@shared/types';
import { useAppInfo } from '../../lib/bridge';
import { Group, Row, SaveDirRow, Segmented, Switch, usePatcher } from './common';

export function CaptureTab({ settings }: { settings: Settings }) {
  const patch = usePatcher();
  const info = useAppInfo();
  const capture = settings.capture;

  return (
    <>
      <Group title="保存位置">
        <SaveDirRow
          kind="capture"
          title="截图保存目录"
          desc="留空则使用默认目录，可在「关于」中查看完整路径"
          value={capture.saveDir}
          fallback={info?.paths.screenshots}
          openKind="screenshots"
        />
      </Group>

      <Group title="截图选项">
        <Row title="图片格式" desc="PNG 无损、JPG 体积更小" stacked>
          <Segmented<CaptureFormat>
            options={[
              { value: 'png', label: 'PNG', hint: '无损，适合文字与界面' },
              { value: 'jpg', label: 'JPG', hint: '有损压缩，文件更小' },
            ]}
            value={capture.format}
            ariaLabel="截图格式"
            onChange={(next) => void patch({ capture: { format: next } }, `截图格式已切换为 ${next.toUpperCase()}`)}
          />
        </Row>
        <Row title="自动复制到剪贴板" desc="截图完成后可直接粘贴到聊天窗口或文档">
          <Switch
            checked={capture.copyToClipboard}
            onChange={(next) => void patch({ capture: { copyToClipboard: next } })}
            label="自动复制到剪贴板"
          />
        </Row>
        <Row title="截图后回到面板" desc="完成截图后自动重新打开工具箱面板">
          <Switch
            checked={capture.showPanelAfter}
            onChange={(next) => void patch({ capture: { showPanelAfter: next } })}
            label="截图后回到面板"
          />
        </Row>
        <Row title="提示音" desc="截图成功时播放一声轻提示">
          <Switch
            checked={capture.playSound}
            onChange={(next) => void patch({ capture: { playSound: next } })}
            label="截图提示音"
          />
        </Row>
      </Group>

      <div className="settings-note">
        区域截图会先隐藏面板，框选完成后自动保存并在右下角提示，文件名按时间生成。
      </div>
    </>
  );
}
