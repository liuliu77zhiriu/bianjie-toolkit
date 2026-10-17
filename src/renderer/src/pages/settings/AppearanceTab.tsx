import type { CSSProperties } from 'react';
import type { AnimationLevel, Settings } from '@shared/types';
import { ACCENT_PRESETS, ANIMATION_OPTIONS } from '@shared/defaults';
import { percent, usePatcher, Group, Row, Segmented, Slider, Switch, type SegmentedOption } from './common';

function accentRgb(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '76, 141, 255';
  const value = parseInt(match[1], 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

const ANIMATION_SEGMENTS: ReadonlyArray<SegmentedOption<AnimationLevel>> = ANIMATION_OPTIONS.map((item) => ({
  value: item.value,
  label: item.label,
  hint: item.hint,
}));

export function AppearanceTab({ settings }: { settings: Settings }) {
  const patch = usePatcher();
  const appearance = settings.appearance;
  const animationHint = ANIMATION_OPTIONS.find((item) => item.value === appearance.animation)?.hint ?? '';

  return (
    <>
      <Group title="主题强调色">
        <Row title="强调色" desc="按钮、开关、选中态与光晕都跟随强调色实时变化" stacked>
          <div className="accent-grid">
            {ACCENT_PRESETS.map((preset) => {
              const active = appearance.accent.toLowerCase() === preset.value.toLowerCase();
              return (
                <button
                  key={preset.value}
                  type="button"
                  className={`accent-swatch${active ? ' active' : ''}`}
                  style={
                    {
                      '--dot': preset.value,
                      '--dot-rgb': accentRgb(preset.value),
                    } as CSSProperties
                  }
                  aria-pressed={active}
                  onClick={() => void patch({ appearance: { accent: preset.value } }, `强调色已切换为「${preset.name}」`)}
                >
                  <span className="accent-dot" />
                  <span className="accent-name">{preset.name}</span>
                </button>
              );
            })}
          </div>
        </Row>
      </Group>

      <Group title="面板质感">
        <Row title="面板不透明度" desc="数值越低越透，配合毛玻璃更通透" stacked>
          <Slider
            min={0.55}
            max={1}
            step={0.01}
            value={appearance.panelOpacity}
            format={percent}
            onCommit={(next) => void patch({ appearance: { panelOpacity: next } })}
            ariaLabel="面板不透明度"
            minLabel="更透"
            maxLabel="更实"
          />
        </Row>
        <Row title="毛玻璃背景" desc="使用 Windows 11 亚克力材质，关闭后为纯色深底">
          <Switch
            checked={appearance.blur}
            onChange={(next) => void patch({ appearance: { blur: next } }, next ? '已开启毛玻璃' : '已关闭毛玻璃')}
            label="毛玻璃背景"
          />
        </Row>
        <Row title="动画强度" desc={animationHint} stacked>
          <Segmented
            options={ANIMATION_SEGMENTS}
            value={appearance.animation}
            ariaLabel="动画强度"
            onChange={(next) => void patch({ appearance: { animation: next } }, '动画强度已更新')}
          />
        </Row>
      </Group>

      <Group title="悬浮球">
        <Row title="悬浮球尺寸" desc="调节桌面悬浮球的直径" stacked>
          <Slider
            min={40}
            max={76}
            step={1}
            value={appearance.ballSize}
            format={(next) => `${Math.round(next)} px`}
            onCommit={(next) => void patch({ appearance: { ballSize: next } })}
            ariaLabel="悬浮球尺寸"
            minLabel="40 px"
            maxLabel="76 px"
          />
        </Row>
        <Row title="悬浮球透明度" desc="数值越低越不干扰视线" stacked>
          <Slider
            min={0.35}
            max={1}
            step={0.01}
            value={appearance.ballOpacity}
            format={percent}
            onCommit={(next) => void patch({ appearance: { ballOpacity: next } })}
            ariaLabel="悬浮球透明度"
            minLabel="半透明"
            maxLabel="不透明"
          />
        </Row>
        <Row title="自动隐藏" desc="鼠标离开后悬浮球自动淡出">
          <Switch
            checked={appearance.ballAutoHide}
            onChange={(next) => void patch({ appearance: { ballAutoHide: next } })}
            label="悬浮球自动隐藏"
          />
        </Row>
        <Row title="贴边吸附" desc="拖动结束后自动吸附到最近的屏幕边缘">
          <Switch
            checked={appearance.ballEdgeSnap}
            onChange={(next) => void patch({ appearance: { ballEdgeSnap: next } })}
            label="悬浮球贴边吸附"
          />
        </Row>
      </Group>

      <Group title="窗口与布局">
        <Row title="窗口置顶" desc="让主面板始终显示在其他窗口之上">
          <Switch
            checked={appearance.alwaysOnTop}
            onChange={(next) => void patch({ appearance: { alwaysOnTop: next } }, next ? '面板已置顶' : '已取消置顶')}
            label="窗口置顶"
          />
        </Row>
        <Row title="显示底部 Dock" desc="在面板底部显示快捷导航栏">
          <Switch
            checked={appearance.showDock}
            onChange={(next) => void patch({ appearance: { showDock: next } })}
            label="显示底部 Dock"
          />
        </Row>
      </Group>
    </>
  );
}
