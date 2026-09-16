'use strict';

// This fixed source is also inserted into the reviewed bundle. Keep it standalone:
// no closure state, workspace scans, process environment, or additional file reads.
function codexScopePlsFilter(params, vscode) {
  const mode = vscode.workspace.getConfiguration('codexScopePls').get('mode', 'workspace');
  const folders = vscode.workspace.workspaceFolders || [];
  if (mode === 'all' || folders.length === 0) return params;
  if (mode !== 'workspace') throw new Error('Codex Scope Pls: invalid mode');
  if (vscode.env.remoteName || vscode.workspace.getConfiguration('chatgpt').get('cliExecutable')) {
    throw new Error('Codex Scope Pls: unsupported remote host or custom CLI');
  }
  const path = require('node:path');
  const roots = folders.map(({ uri }) => {
    if (uri.scheme !== 'file' || !path.isAbsolute(uri.fsPath)) {
      throw new Error('Codex Scope Pls: unsupported workspace URI');
    }
    const normalized = path.normalize(uri.fsPath);
    return normalized.length > path.parse(normalized).root.length ? normalized.replace(/\/+$/, '') : normalized;
  });
  // Override a caller's cwd so it cannot broaden the active window's scope.
  // One array request preserves the server's ordering, limit and pagination.
  return { ...params, cwd: [...new Set(roots)] };
}

module.exports = { codexScopePlsFilter };
