import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(rootDir, 'node_modules/electron/dist/electron.exe');
const artifacts = path.join(rootDir, 'artifacts', 'smoke');
fs.mkdirSync(artifacts, { recursive: true });

console.log('[smoke] building…');
execFileSync(process.execPath, [path.join(rootDir, 'scripts/build.mjs')], { cwd: rootDir, stdio: 'inherit' });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.TK_TEST = '1';
env.TK_TEST_KEEP_OPEN = '0';
env.TK_APP_ROOT = rootDir;

const logPath = path.join(artifacts, 'run.log');
const logStream = fs.createWriteStream(logPath, { flags: 'w' });
const child = spawn(electronBin, ['.'], { cwd: rootDir, env });
let stdout = '';
child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  stdout += text;
  logStream.write(text);
  process.stdout.write(text);
});
child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  stdout += text;
  logStream.write(text);
  process.stderr.write(text);
});

const timeout = setTimeout(() => {
  console.error('[smoke] 超时，强制结束');
  child.kill();
}, 150000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  logStream.end();
  let failed = 0;
  const reportPath = path.join(artifacts, 'report.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    failed = report.results.filter((r) => !r.ok).length;
    console.log('\n[smoke] 结果：');
    for (const item of report.results) {
      console.log(`  ${item.ok ? '✓' : '✗'} ${item.name} (${item.ms}ms)${item.detail ? ' — ' + item.detail : ''}`);
    }
  } else {
    console.error('[smoke] 未生成 report.json');
    failed = 1;
  }
  console.log(`[smoke] 退出码=${code} 失败项=${failed}`);
  process.exit(failed > 0 ? 1 : code ?? 0);
});
