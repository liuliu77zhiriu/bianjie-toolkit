import { useEffect, useState } from 'react';
import type { AudioSource, Settings } from '@shared/types';
import { useAppInfo } from '../../lib/bridge';
import { Icon, type IconName } from '../../ui/Icon';
import { Group, Row, SaveDirRow, Segmented, Slider, usePatcher } from './common';

const AUDIO_OPTIONS: Array<{ value: AudioSource; label: string; hint: string; icon: IconName }> = [
  { value: 'system', label: '系统声音', hint: '录制电脑播放的声音', icon: 'volume' },
  { value: 'mic', label: '麦克风', hint: '录制解说与语音', icon: 'mic' },
  { value: 'system+mic', label: '两者混合', hint: '系统声音 + 麦克风', icon: 'record' },
  { value: 'none', label: '不录制音频', hint: '仅录画面，静音', icon: 'stop' },
];

export function RecorderTab({ settings }: { settings: Settings }) {
  const patch = usePatcher();
  const info = useAppInfo();
  const recorder = settings.recorder;
  const [durationDraft, setDurationDraft] = useState(String(recorder.maxDurationMin));

  useEffect(() => {
    setDurationDraft(String(recorder.maxDurationMin));
  }, [recorder.maxDurationMin]);

  const commitDuration = () => {
    const parsed = Number(durationDraft);
    const next = Number.isFinite(parsed) ? Math.min(240, Math.max(0, Math.round(parsed))) : recorder.maxDurationMin;
    setDurationDraft(String(next));
    if (next === recorder.maxDurationMin) return;
    void patch({ recorder: { maxDurationMin: next } });
  };

  return (
    <>
      <Group title="保存位置">
        <SaveDirRow
          kind="recorder"
          title="录制保存目录"
          desc="留空则使用默认目录，可在「关于」中查看完整路径"
          value={recorder.saveDir}
          fallback={info?.paths.recordings}
          openKind="recordings"
        />
      </Group>

      <Group title="画面">
        <Row title="帧率" desc="帧率越高画面越流畅，文件也越大" stacked>
          <Segmented<number>
            options={[
              { value: 24, label: '24 fps' },
              { value: 30, label: '30 fps' },
              { value: 60, label: '60 fps' },
            ]}
            value={recorder.fps}
            ariaLabel="录制帧率"
            onChange={(next) => void patch({ recorder: { fps: next } }, `帧率已切换为 ${next} fps`)}
          />
        </Row>
        <Row title="画质" desc="影响码率与清晰度，推荐 80% 左右" stacked>
          <Slider
            min={30}
            max={100}
            step={1}
            value={recorder.quality}
            format={(next) => `${Math.round(next)}%`}
            onCommit={(next) => void patch({ recorder: { quality: next } })}
            ariaLabel="录制画质"
            minLabel="省空间"
            maxLabel="高清晰"
          />
        </Row>
        <Row title="录制格式" desc="自动模式优先使用 MP4，兼容性更好" stacked>
          <Segmented<'auto' | 'mp4' | 'webm'>
            options={[
              { value: 'auto', label: '自动' },
              { value: 'mp4', label: 'MP4' },
              { value: 'webm', label: 'WebM' },
            ]}
            value={recorder.format}
            ariaLabel="录制格式"
            onChange={(next) => void patch({ recorder: { format: next } }, `录制格式已切换为 ${next === 'auto' ? '自动' : next.toUpperCase()}`)}
          />
        </Row>
      </Group>

      <Group title="声音">
        <Row title="音频来源" desc="选择录制时捕获的声音来源" stacked>
          <div className="choice-grid">
            {AUDIO_OPTIONS.map((option) => {
              const active = recorder.audio === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`choice-card${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => void patch({ recorder: { audio: option.value } }, `音频来源已设为「${option.label}」`)}
                >
                  <Icon name={option.icon} size={14} />
                  <span className="choice-main">
                    <span className="choice-label">{option.label}</span>
                    <span className="choice-hint">{option.hint}</span>
                  </span>
                  {active ? <Icon name="check" size={12} /> : null}
                </button>
              );
            })}
          </div>
        </Row>
      </Group>

      <Group title="录制流程">
        <Row title="开始倒计时" desc="开始录制前的准备时间" stacked>
          <Segmented<number>
            options={[
              { value: 0, label: '不倒数' },
              { value: 3, label: '3 秒' },
              { value: 5, label: '5 秒' },
            ]}
            value={recorder.countdown}
            ariaLabel="开始倒计时"
            onChange={(next) => void patch({ recorder: { countdown: next } }, next ? `倒计时已设为 ${next} 秒` : '已关闭倒计时')}
          />
        </Row>
        <Row
          title="最长录制时长"
          desc="达到上限后自动停止并保存，0 表示不限制"
          controlWidth="wide"
        >
          <div className="number-field">
            <input
              className="tk-input number-input"
              type="number"
              min={0}
              max={240}
              step={1}
              value={durationDraft}
              aria-label="最长录制时长（分钟）"
              onChange={(event) => setDurationDraft(event.currentTarget.value)}
              onBlur={commitDuration}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDuration();
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="number-unit">分钟</span>
          </div>
        </Row>
      </Group>

      <div className="settings-note">
        录制过程中可再次按下快捷键或点击悬浮球菜单停止，文件会立即落盘保存。
      </div>
    </>
  );
}
