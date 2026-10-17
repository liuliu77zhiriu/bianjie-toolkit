import type { Settings } from '@shared/types';

type FrameEntry = {
  pluginId: string;
  post: (msg: Record<string, unknown>) => void;
  reload: () => void;
};

let activeFrame: FrameEntry | null = null;

export function registerFrame(entry: FrameEntry) {
  activeFrame = entry;
  return () => {
    if (activeFrame === entry) activeFrame = null;
  };
}

export function dispatchPluginEvent(pluginId: string, topic: string, payload?: unknown) {
  if (activeFrame && activeFrame.pluginId === pluginId) {
    activeFrame.post({ kind: 'event', topic, payload });
  }
}

export function reloadPluginFrame(pluginId: string) {
  if (activeFrame && activeFrame.pluginId === pluginId) {
    activeFrame.reload();
  }
}

export function notifyPanelVisibility(visible: boolean) {
  activeFrame?.post({ kind: visible ? 'panel:shown' : 'panel:hidden' });
}

export function pushTheme(settings: Settings) {
  activeFrame?.post({ kind: 'settings', settings });
  activeFrame?.post({
    kind: 'theme',
    theme: { accent: settings.appearance.accent, animation: settings.appearance.animation },
  });
}
