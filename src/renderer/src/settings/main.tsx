import { createRoot } from 'react-dom/client';
import { SettingsApp } from './SettingsApp';
import '../theme/tokens.css';
import '../theme/shell.css';
import '../theme/glass-borders.css';
import '../pages/settings/settings.css';
import '../theme/settings-window.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<SettingsApp />);
}
