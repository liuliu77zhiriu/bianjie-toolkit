import { createRoot } from 'react-dom/client';
import { UIEditorApp } from './UIEditorApp';
import '../theme/tokens.css';
import '../theme/shell.css';
import '../theme/glass-borders.css';
import './styles/editor.css';

const container = document.getElementById('root');
if (container) createRoot(container).render(<UIEditorApp />);
