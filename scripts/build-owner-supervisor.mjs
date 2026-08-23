import { spawnSync } from 'node:child_process';
import process from 'node:process';

const command =
  process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'scripts\\build-owner-supervisor-win.bat']]
    : process.platform === 'darwin'
      ? ['bash', ['scripts/build-owner-supervisor-mac.sh']]
      : process.platform === 'linux'
        ? ['bash', ['scripts/build-owner-supervisor-linux.sh']]
        : null;

if (!command) {
  throw new Error(
    `Native owner supervision is not supported on ${process.platform}.`
  );
}

const result = spawnSync(command[0], command[1], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
