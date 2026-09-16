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
      getConfiguration: () => ({ get: () => showCloudChats, update: async (...args) => { updates.push(args); if (args[0] === 'showCloudChats') showCloudChats = args[1]; } }),
      onDidChangeConfiguration: () => disposable,
      onDidChangeWorkspaceFolders: () => disposable
    },
    extensions: { onDidChange: () => disposable },
    commands: { executeCommand: async (...args) => executed.push(args), registerCommand: (id, callback) => { commands.set(id, callback); return disposable; } }
  };
  const context = { subscriptions, globalState: {
    get: (key, fallback) => state.has(key) ? state.get(key) : fallback,
    update: async (key, value) => state.set(key, value)
  } };
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === 'vscode') return vscode;
    if (name === './codexLocator') return { locate: async () => ({ target: '/fixture', definition: {} }) };
    if (name === './patch/patcher') return { change: async (_target, _definition, action) => { operations.push(action); return { changed: false }; } };
    if (name === './diagnostics') return { safeError: error => error.message };
    throw new Error(`Unexpected import ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8'), sandbox);
  sandbox.module.exports.activate(context);
  await commands.get('codexScopePls.all')();
  assert.deepEqual(operations, ['apply']);
  assert.deepEqual(updates, [['mode', 'all', 2]]);
  await commands.get('codexScopePls.settings')();
  assert.deepEqual(executed, [['workbench.action.openSettings', '@ext:local.codex-scope-pls']]);
  await commands.get('codexScopePls.toggleCloud')();
  assert.deepEqual(updates.at(-1), ['showCloudChats', true, 1]);
  await commands.get('codexScopePls.toggleCloud')();
  assert.deepEqual(updates.at(-1), ['showCloudChats', false, 1]);
  await commands.get('codexScopePls.restore')();
  assert.equal(state.get('autoApply'), false);
  sandbox.module.exports.deactivate();
  sandbox.module.exports.activate(context);
  await commands.get('codexScopePls.workspace')();
  assert.deepEqual(operations, ['apply', 'restore']);
  await commands.get('codexScopePls.reapply')();
  assert.equal(state.get('autoApply'), true);
  assert.deepEqual(operations, ['apply', 'restore', 'apply']);
});
