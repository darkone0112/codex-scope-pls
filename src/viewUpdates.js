'use strict';

function codexScopePlsSubscribeView(vscode, webview, onDispose) {
  const update = () => {
    void webview.postMessage({ type: 'codex-scope-pls-view-scope',
      scope: codexScopePlsViewScope(vscode) }).then(undefined, () => {});
  };
  const configuration = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('codexScopePls.mode') ||
      event.affectsConfiguration('codexScopePls.showCloudChats') ||
      event.affectsConfiguration('codexScopePls.groupChatsByProject')) update();
  });
  const folders = vscode.workspace.onDidChangeWorkspaceFolders(update);
  const dispose = () => { configuration.dispose(); folders.dispose(); };
  return { dispose, viewDisposal: onDispose(dispose) };
}

module.exports = { codexScopePlsSubscribeView };
