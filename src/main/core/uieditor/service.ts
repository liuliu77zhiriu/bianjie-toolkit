import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import type { UIEditorProjectSummary, UIProject } from '../../../shared/uieditor';
import { createProject as blankProject, projectSummary, structuredCloneSafe, touchProject } from '../../../shared/uieditor-kit';
import { findTemplate } from '../../../shared/uieditor-templates';
import type { AppPaths } from '../../../shared/types';
import type { Logger } from '../logger';
import { exportProjectJson, exportReactComponent, exportStandaloneHtml } from './export';

export interface UIEditorServiceDeps {
  paths: AppPaths;
  logger: Logger;
  getParentWindow: () => BrowserWindow | null;
  /** 发布为插件后刷新插件列表 */
  reloadPlugins?: () => Promise<void> | void;
}

interface StoredProjectFile {
  schemaVersion?: number;
}

/**
 * UI 编辑器工程存储 + 导出/发布。
 * 工程保存在 userData/uieditor/projects/*.json，导出物默认写到 userData/uieditor/exports。
 */
export class UIEditorService {
  private readonly rootDir: string;
  private readonly projectsDir: string;
  private readonly exportsDir: string;

  constructor(private deps: UIEditorServiceDeps) {
    this.rootDir = path.join(deps.paths.userData, 'uieditor');
    this.projectsDir = path.join(this.rootDir, 'projects');
    this.exportsDir = path.join(this.rootDir, 'exports');
    for (const dir of [this.rootDir, this.projectsDir, this.exportsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  get pathsInfo() {
    return {
      root: this.rootDir,
      projects: this.projectsDir,
      exports: this.exportsDir,
    };
  }

  private projectFile(id: string): string {
    if (!/^[a-z0-9_-]{1,80}$/i.test(id)) throw new Error(`非法工程 ID：${id}`);
    return path.join(this.projectsDir, `${id}.json`);
  }

  private atomicWrite(file: string, content: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, content, 'utf8');
    fs.renameSync(temp, file);
  }

  private sanitizeProject(project: UIProject): UIProject {
    if (!project || project.schemaVersion !== 1) throw new Error('工程格式不受支持');
    if (!project.id || !Array.isArray(project.screens) || !project.nodes) throw new Error('工程数据不完整');
    if (!project.screens.length) throw new Error('工程至少需要一个页面');
    return project;
  }

  async list(): Promise<UIEditorProjectSummary[]> {
    const entries = await fs.promises.readdir(this.projectsDir, { withFileTypes: true }).catch(() => []);
    const summaries: UIEditorProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = await fs.promises.readFile(path.join(this.projectsDir, entry.name), 'utf8');
        const parsed = JSON.parse(raw) as UIProject & StoredProjectFile;
        if (parsed.schemaVersion !== 1) continue;
        summaries.push(projectSummary(parsed));
      } catch {
        /* 单个损坏工程不影响列表 */
      }
    }
    return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async load(id: string): Promise<UIProject> {
    const raw = await fs.promises.readFile(this.projectFile(id), 'utf8');
    const project = JSON.parse(raw) as UIProject;
    return this.sanitizeProject(project);
  }

  async save(project: UIProject): Promise<UIProject> {
    const safe = this.sanitizeProject(project);
    touchProject(safe);
    this.atomicWrite(this.projectFile(safe.id), JSON.stringify(safe));
    return safe;
  }

  async create(options: { templateId?: string; name?: string; width?: number; height?: number } = {}): Promise<UIProject> {
    const template = options.templateId ? findTemplate(options.templateId) : undefined;
    const project = template
      ? template.create()
      : blankProject(options.name || '未命名设计', options.width ?? 960, options.height ?? 640);
    project.id = `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    project.createdAt = new Date().toISOString();
    if (options.name?.trim()) project.name = options.name.trim();
    for (const node of Object.values(project.nodes)) {
      if (!node.id) throw new Error('模板节点缺少 id');
    }
    return this.save(project);
  }

  async defaultProject(): Promise<UIProject> {
    const summaries = await this.list();
    if (summaries.length) {
      try {
        return await this.load(summaries[0].id);
      } catch (err) {
        this.deps.logger.warn('[uieditor] 加载最近工程失败', err);
      }
    }
    return this.create({ templateId: 'blank', name: '未命名设计' });
  }

  async duplicate(id: string): Promise<UIProject> {
    const source = await this.load(id);
    const copy = structuredCloneSafe(source);
    copy.id = `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    copy.name = `${source.name} 副本`;
    copy.createdAt = new Date().toISOString();
    return this.save(copy);
  }

  async remove(id: string): Promise<boolean> {
    await fs.promises.unlink(this.projectFile(id)).catch(() => undefined);
    return true;
  }

  async importProject(): Promise<UIProject | null> {
    const parent = this.deps.getParentWindow() ?? undefined;
    const result = await dialog.showOpenDialog(parent as BrowserWindow, {
      title: '导入 UI 工程',
      filters: [{ name: 'UI 工程', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const raw = await fs.promises.readFile(result.filePaths[0], 'utf8');
    const imported = JSON.parse(raw) as UIProject;
    this.sanitizeProject(imported);
    const copy = structuredCloneSafe(imported);
    copy.id = `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    copy.name = imported.name || '导入的设计';
    copy.createdAt = new Date().toISOString();
    return this.save(copy);
  }

  private defaultExportPath(name: string, extension: string): string {
    const safeName = name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'ui-design';
    return path.join(this.exportsDir, `${safeName}.${extension}`);
  }

  private async chooseSavePath(project: UIProject, extension: string, label: string): Promise<string | null> {
    const parent = this.deps.getParentWindow() ?? undefined;
    const result = await dialog.showSaveDialog(parent as BrowserWindow, {
      title: '导出 UI 设计',
      defaultPath: this.defaultExportPath(project.name, extension),
      filters: [{ name: label, extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  }

  async exportHtml(project: UIProject, options: { screenIds?: string[] } = {}): Promise<string | null> {
    const target = await this.chooseSavePath(project, 'html', 'HTML');
    if (!target) return null;
    const html = exportStandaloneHtml(project, { ...options, title: project.name });
    this.atomicWrite(target, html);
    return target;
  }

  async exportJson(project: UIProject): Promise<string | null> {
    const target = await this.chooseSavePath(project, 'json', 'UI 工程 JSON');
    if (!target) return null;
    this.atomicWrite(target, exportProjectJson(project));
    return target;
  }

  async exportReact(project: UIProject): Promise<string | null> {
    const parent = this.deps.getParentWindow() ?? undefined;
    const result = await dialog.showOpenDialog(parent as BrowserWindow, {
      title: '选择 React 组件导出目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const targetDir = result.filePaths[0];
    const { tsx, css } = exportReactComponent(project);
    fs.mkdirSync(targetDir, { recursive: true });
    const name = (project.name || 'UIScreen').replace(/[^\w\u4e00-\u9fa5]/g, '') || 'UIScreen';
    this.atomicWrite(path.join(targetDir, 'index.tsx'), tsx);
    this.atomicWrite(path.join(targetDir, 'styles.css'), css);
    this.atomicWrite(
      path.join(targetDir, 'README.md'),
      `# ${project.name}\n\n由便捷工具 UI 编辑器导出。\n\n- index.tsx：React 组件\n- styles.css：样式\n\n将两个文件放入你的 React 项目即可使用。\n`
    );
    void name;
    return targetDir;
  }

  /** 发布为便捷工具插件，可在主面板工具列表直接打开 */
  async publishPlugin(project: UIProject): Promise<{ ok: boolean; pluginId?: string; path?: string; error?: string }> {
    try {
      const slug = (project.name || 'ui-design')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24);
      const pluginId = `ui-${slug || 'design'}-${Date.now().toString(36).slice(-4)}`;
      const target = path.join(this.deps.paths.plugins, pluginId);
      fs.mkdirSync(target, { recursive: true });
      const manifest = {
        id: pluginId,
        name: project.name || 'UI 设计',
        description: project.description || '由便捷工具 UI 编辑器发布的设计',
        version: '1.0.0',
        icon: 'icon.svg',
        ui: 'index.html',
        builtin: false,
      };
      this.atomicWrite(path.join(target, 'plugin.json'), JSON.stringify(manifest, null, 2));
      this.atomicWrite(
        path.join(target, 'main.js'),
        `/** 由 UI 编辑器发布的插件，仅作为静态 UI */\nexport default {\n  activate() {},\n  deactivate() {},\n};\n`
      );
      this.atomicWrite(path.join(target, 'index.html'), exportStandaloneHtml(project, { title: project.name }));
      this.atomicWrite(
        path.join(target, 'icon.svg'),
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0b1020"/><rect x="14" y="14" width="16" height="16" rx="4" fill="#4C8DFF"/><rect x="34" y="14" width="16" height="16" rx="4" fill="#7FB0FF" opacity=".7"/><rect x="14" y="34" width="16" height="16" rx="4" fill="#7FB0FF" opacity=".55"/><rect x="34" y="34" width="16" height="16" rx="4" fill="#4C8DFF"/></svg>`
      );
      this.atomicWrite(
        path.join(target, 'README.md'),
        `# ${project.name}\n\n由便捷工具 UI 编辑器发布。\n\n- 在 设置 → 扩展 中可启用/编辑此插件\n- 工程源文件可在 UI 编辑器中重新导入并继续编辑\n`
      );
      await this.deps.reloadPlugins?.();
      return { ok: true, pluginId, path: target };
    } catch (err) {
      this.deps.logger.error('[uieditor] 发布插件失败', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async openFolder(): Promise<string> {
    await shell.openPath(this.rootDir);
    return this.rootDir;
  }

  async cleanupExports(): Promise<void> {
    const entries = await fs.promises.readdir(this.exportsDir).catch(() => []);
    const now = Date.now();
    for (const entry of entries) {
      try {
        const stat = await fs.promises.stat(path.join(this.exportsDir, entry));
        if (now - stat.mtimeMs > 7 * 24 * 3600 * 1000) {
          await fs.promises.unlink(path.join(this.exportsDir, entry));
        }
      } catch {
        /* ignore */
      }
    }
  }
}

