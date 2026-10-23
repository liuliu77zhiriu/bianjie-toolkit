/**
 * UI 编辑器 · 右侧面板（宽约 300px）
 *
 * 三个标签页：属性 / 设计 / 交互。标签状态存放在 editorStore。
 */
import type { JSX } from 'react';
import { editorStore, useEditorSnapshot, type RightTab } from '../store';
import { TabBar, type TabItem } from './controls';
import { Inspector } from './Inspector';
import { DesignTokens } from './DesignTokens';
import { Interactions } from './Interactions';
import './panels.css';

const RIGHT_TABS: Array<TabItem<RightTab>> = [
  { id: 'inspector', label: '属性', icon: 'sliders', title: '节点 / 画板属性' },
  { id: 'tokens', label: '设计', icon: 'palette', title: '设计令牌' },
  { id: 'interactions', label: '交互', icon: 'bolt', title: '交互与状态样式' },
];

export function RightPanel(): JSX.Element {
  const snapshot = useEditorSnapshot();
  const tab = snapshot.rightTab;

  return (
    <aside className="up-panel up-right" aria-label="属性面板">
      <TabBar
        tabs={RIGHT_TABS}
        value={tab}
        onChange={(next) => editorStore.setRightTab(next)}
        ariaLabel="右侧面板标签"
      />
      <div className="up-panel-body">
        {tab === 'inspector' ? <Inspector snapshot={snapshot} /> : null}
        {tab === 'tokens' ? <DesignTokens snapshot={snapshot} /> : null}
        {tab === 'interactions' ? <Interactions snapshot={snapshot} /> : null}
      </div>
    </aside>
  );
}
