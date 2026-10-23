/**
 * UI 编辑器 · 左侧面板（宽约 240px）
 *
 * 五个标签页：图层 / 组件 / 模板 / 页面 / 资源。
 * 标签状态存放在 editorStore（用于与工具栏 / 快捷键同步）。
 */
import type { JSX } from 'react';
import { editorStore, useEditorSnapshot, type LeftTab } from '../store';
import { TabBar, type TabItem } from './controls';
import { LayerTree } from './LayerTree';
import { ComponentLibrary } from './ComponentLibrary';
import { TemplateGallery } from './TemplateGallery';
import { ScreenPanel } from './ScreenPanel';
import { AssetPanel } from './AssetPanel';
import './panels.css';

const LEFT_TABS: Array<TabItem<LeftTab>> = [
  { id: 'layers', label: '图层', icon: 'layers', title: '图层树' },
  { id: 'components', label: '组件', icon: 'component', title: '组件库' },
  { id: 'templates', label: '模板', icon: 'template', title: '页面模板' },
  { id: 'screens', label: '页面', icon: 'screen', title: '页面管理' },
  { id: 'assets', label: '资源', icon: 'asset', title: '本地图片资源' },
];

export function LeftPanel({ onApplyTemplate }: { onApplyTemplate: (templateId: string) => void }): JSX.Element {
  const snapshot = useEditorSnapshot();
  const tab = snapshot.leftTab;
  const activeScreen =
    snapshot.project.screens.find((screen) => screen.id === snapshot.activeScreenId) ?? null;

  return (
    <aside className="up-panel up-left" aria-label="设计面板">
      <TabBar
        tabs={LEFT_TABS}
        value={tab}
        onChange={(next) => editorStore.setLeftTab(next)}
        ariaLabel="左侧面板标签"
      />
      <div className="up-panel-body">
        {tab === 'layers' ? <LayerTree snapshot={snapshot} /> : null}
        {tab === 'components' ? <ComponentLibrary /> : null}
        {tab === 'templates' ? <TemplateGallery onApplyTemplate={onApplyTemplate} /> : null}
        {tab === 'screens' ? <ScreenPanel snapshot={snapshot} /> : null}
        {tab === 'assets' ? <AssetPanel /> : null}
      </div>
      <div className="up-panel-foot" title={activeScreen?.name}>
        <span className="up-foot-dot" aria-hidden="true" />
        <span className="up-foot-text">{activeScreen?.name ?? '未选择页面'}</span>
      </div>
    </aside>
  );
}
