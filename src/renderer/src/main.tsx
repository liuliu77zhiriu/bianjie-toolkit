import { createRoot } from 'react-dom/client';
import App from './shell/App';
import './theme/tokens.css';
import './theme/shell.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
