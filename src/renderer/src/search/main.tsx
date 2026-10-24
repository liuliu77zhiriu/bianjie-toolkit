/** 流光搜索 · 渲染进程入口 */
import { createRoot } from 'react-dom/client';
import { SearchApp } from './SearchApp';
import './search.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<SearchApp />);
}
