'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('activation, mode commands, persistent restore and explicit reapply', async () => {
  const commands = new Map();
  const state = new Map();
  const operations = [];
  const updates = [];
  const subscriptions = [];
  const executed = [];
  let extensionChange;
  let configurationChange;
  let workspaceChange;
  let selfExtensionPresent = true;
  let showCloudChats = false;
  const disposable = { dispose() {} };
  const vscode = {
    ConfigurationTarget: { Workspace: 2, Global: 1 },
    window: {
      createOutputChannel: () => ({ ...disposable, appendLine() {}, clear() {}, show() {} }),
      showInformationMessage: async () => undefined,
      showWarningMessage: async message => assert.fail(message)
    },
    workspace: {
      workspaceFolders: [{}],
      getConfiguration: section => {
        assert.equal(section, 'codexScopePls');
        return { get: () => showCloudChats, update: async (...args) => { updates.push(args); if (args[0] === 'showCloudChats') showCloudChats = args[1]; } };
      },
      onDidChangeConfiguration: callback => { configurationChange = callback; return disposable; },
      onDidChangeWorkspaceFolders: callback => { workspaceChange = callback; return disposable; }
    },
    extensions: {
      getExtension: id => id === 'local.codex-scope-pls' && selfExtensionPresent ? {} : undefined,
      onDidChange: callback => { extensionChange = callback; return disposable; }
    },
    commands: { executeCommand: async (...args) => executed.push(args), registerCommand: (id, callback) => { commands.set(id, callback); return disposable; } }
  };
  const context = { subscriptions, globalState: {
    get: (key, fallback) => { assert.equal(key, 'autoApply'); return state.has(key) ? state.get(key) : fallback; },
    update: async (key, value) => { assert.equal(key, 'autoApply'); state.set(key, value); }
  }, get workspaceState() { assert.fail('must not read or restore conversation state'); } };
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === 'vscode') return vscode;
    if (name === './codexLocator') return { locate: async () => ({ target: '/fixture', definition: {} }),
      installationTargets: async (target, definition) => [{ target, definition }] };
    if (name === './patch/patcher') return { changeAll: async (_targets, action) => { operations.push(action); return [{ changed: false }]; } };
    if (name === './diagnostics') return { safeError: error => error.message };
    throw new Error(`Unexpected import ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8'), sandbox);
  sandbox.module.exports.activate(context);
  await commands.get('codexScopePls.all')();
  assert.deepEqual(operations, ['apply']);
  assert.deepEqual(updates, [['mode', 'all', 2]]);
  await commands.get('codexScopePls.settings')();
  assert.deepEqual(executed, [['workbench.action.openWorkspaceSettings', '@ext:local.codex-scope-pls']]);
  await commands.get('codexScopePls.toggleCloud')();
  assert.deepEqual(updates.at(-1), ['showCloudChats', true, 1]);
  await commands.get('codexScopePls.toggleCloud')();
  assert.deepEqual(updates.at(-1), ['showCloudChats', false, 1]);
  assert.equal(configurationChange, undefined, 'settings must no longer prompt for reload');
  assert.equal(workspaceChange, undefined, 'folder changes update display preferences through Codex');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(executed, [['workbench.action.openWorkspaceSettings', '@ext:local.codex-scope-pls']],
    'dismissed reload notices must not execute commands or switch threads');
  await commands.get('codexScopePls.restore')();
  assert.equal(state.get('autoApply'), false);
  sandbox.module.exports.deactivate();
  sandbox.module.exports.activate(context);
  await commands.get('codexScopePls.workspace')();
  assert.deepEqual(operations, ['apply', 'restore']);
  await commands.get('codexScopePls.reapply')();
  assert.equal(state.get('autoApply'), true);
  assert.deepEqual(operations, ['apply', 'restore', 'apply']);
  selfExtensionPresent = false;
  extensionChange();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(operations, ['apply', 'restore', 'apply', 'restore']);
  assert.deepEqual(executed.at(-1), ['workbench.action.reloadWindow']);
});

test('workspace modes override the User default until explicitly returned to global mode', async () => {
  const { codexScopePlsViewScope } = require('../src/viewScope');
  const { codexScopePlsVisible } = require('../src/viewVisibility');
  const commands = new Map(), executed = [], updates = [];
  const values = { user: 'workspace', workspace: 'workspace' };
  const disposable = { dispose() {} };
  const vscode = {
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/project' } }],
      getConfiguration: () => ({
        get: (key, fallback) => key === 'mode' ? values.workspace ?? values.user : fallback,
        update: async (key, value, target) => {
          assert.equal(key, 'mode'); updates.push([key, value, target]);
          values[target === 2 ? 'workspace' : 'user'] = value;
        }
      })
    },
    window: { createOutputChannel: () => ({ ...disposable, appendLine() {} }), showWarningMessage: message => assert.fail(message) },
    extensions: { onDidChange: () => disposable },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return disposable; },
      executeCommand: async (...args) => executed.push(args) }
  };
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === 'vscode') return vscode;
    if (name === './diagnostics') return { safeError: error => error.message };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8'), sandbox);
  sandbox.module.exports.activate({ subscriptions: [], globalState: { get: () => false } });
  const otherChat = { kind: 'local', conversationId: 'other', cwd: '/another-project' };
  const visible = () => codexScopePlsVisible(otherChat, null, codexScopePlsViewScope(vscode));
  values.user = 'all';
  assert.equal(visible(), false, 'Workspace setting overrides a change in User settings');
  await commands.get('codexScopePls.settings')();
  assert.deepEqual(executed.at(-1), ['workbench.action.openWorkspaceSettings', '@ext:local.codex-scope-pls']);
  await commands.get('codexScopePls.all')();
  assert.equal(visible(), true);
  await commands.get('codexScopePls.workspace')();
  assert.equal(visible(), false);
  await commands.get('codexScopePls.useGlobalMode')();
  assert.deepEqual(updates.at(-1), ['mode', undefined, 2]);
  assert.equal(visible(), true, 'removing only our workspace override reveals the User all setting');
  values.user = 'workspace';
  assert.equal(visible(), false);
  await commands.get('codexScopePls.globalSettings')();
  assert.deepEqual(executed.at(-1), ['workbench.action.openSettings', '@ext:local.codex-scope-pls']);
  vscode.workspace.workspaceFolders = [];
  await commands.get('codexScopePls.all')();
  assert.deepEqual(updates.at(-1), ['mode', 'all', 1]);
  await commands.get('codexScopePls.settings')();
  assert.deepEqual(executed.at(-1), ['workbench.action.openSettings', '@ext:local.codex-scope-pls']);
});
