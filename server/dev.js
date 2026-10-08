import { spawn } from 'node:child_process';

const api = spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' });
const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' });
const children = [api, web];
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
for (const child of children) {
  child.on('error', (error) => {
    process.stderr.write('Unable to start a development service: ' + error.message + '\n');
    stop();
  });
  child.on('exit', (code) => {
    if (!stopping && code !== 0) stop();
  });
}
