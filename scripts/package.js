'use strict';
// Development/release packaging only. The installed extension never runs this.
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');
const output = `codex-scope-pls-${pkg.version}.vsix`;
const result = spawnSync('npx', ['--yes', '@vscode/vsce@3.6.2', 'package', '--no-dependencies',
  '--allow-missing-repository', '--out', output], { stdio: 'inherit' });
process.exitCode = result.status === null ? 1 : result.status;
