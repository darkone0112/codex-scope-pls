'use strict';
const vscode = require('vscode');
const { locate } = require('./codexLocator');
const { change } = require('./patch/patcher');
const { diagnostics, safeError } = require('./diagnostics');

function activate(context) {
  const output = vscode.window.createOutputChannel('Codex Scope Pls');
  context.subscriptions.push(output);
  let lastResult = 'Not checked';
  let queue = Promise.resolve();
  function serial(task) {
    queue = queue.then(task).catch(error => {
      lastResult = safeError(error);
      output.appendLine(lastResult);
      void vscode.window.showWarningMessage(`Codex Scope Pls: ${lastResult}. See Show Diagnostics.`);
    });
    return queue;
  }
  async function reloadNotice(message) {
    const choice = await vscode.window.showInformationMessage(message, 'Reload Window');
    if (choice === 'Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
  async function patch(action) {
    const { target, definition } = await locate(vscode, action === 'restore');
    const result = await change(target, definition, action);
    lastResult = `${action}: ${result.changed ? 'file replaced' : 'already in requested state'}`;
    output.appendLine(lastResult);
    if (result.changed) void reloadNotice('Codex Scope Pls: reload every window using this Codex installation to load the changed bundle.');
  }
  function command(name, task) {
    context.subscriptions.push(vscode.commands.registerCommand(`codexScopePls.${name}`, () => serial(task)));
  }
  for (const mode of ['workspace', 'all']) command(mode, async () => {
    const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('codexScopePls').update('mode', mode, target);
  });
  command('settings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local.codex-scope-pls'));
  command('toggleCloud', async () => {
    const config = vscode.workspace.getConfiguration('codexScopePls');
    await config.update('showCloudChats', !config.get('showCloudChats', false), vscode.ConfigurationTarget.Global);
  });
  command('reapply', async () => {
    await patch('apply');
    await context.globalState.update('autoApply', true);
  });
  command('restore', async () => {
    // Persist before restoration so next startup does not undo this explicit action.
    await context.globalState.update('autoApply', false);
    await patch('restore');
  });
  command('diagnostics', async () => {
    output.clear();
    output.appendLine(JSON.stringify(await diagnostics(vscode, context, lastResult), null, 2));
    output.show();
  });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('codexScopePls.mode') || event.affectsConfiguration('codexScopePls.showCloudChats')) {
      void reloadNotice('Codex Scope Pls: settings changed. Reload to clear cached Codex lists and pagination.');
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void reloadNotice('Codex Scope Pls: workspace roots changed. Reload to clear cached Codex lists and pagination.');
  }));
  context.subscriptions.push(vscode.extensions.onDidChange(() => {
    if (context.globalState.get('autoApply', true)) void serial(() => patch('apply'));
  }));
  if (context.globalState.get('autoApply', true)) void serial(() => patch('apply'));
}
// Shared bundle: restoring on ordinary deactivation would affect other windows.
function deactivate() {}
module.exports = { activate, deactivate };
