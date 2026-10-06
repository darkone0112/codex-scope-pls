'use strict';

// Read only display preferences and API-provided folders when a view is built.
// This snapshot never reaches an app-server request or Codex storage.
function codexScopePlsViewScope(vscode) {
  const path = require('node:path');
  const config = vscode.workspace.getConfiguration('codexScopePls');
  const roots = (vscode.workspace.workspaceFolders || [])
    .filter(folder => folder.uri.scheme === 'file' && path.isAbsolute(folder.uri.fsPath))
    .map(folder => path.normalize(folder.uri.fsPath));
  return {
    mode: config.get('mode', 'workspace') === 'workspace' ? 'workspace' : 'all',
    roots: [...new Set(roots)],
    platform: process.platform,
    showCloudChats: config.get('showCloudChats', false) === true,
    groupChatsByProject: config.get('groupChatsByProject', false) === true
  };
}

module.exports = { codexScopePlsViewScope };
