'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { codexScopePlsHideCloudList: hide } = require('../src/cloudScope');
const definitions = require('../src/patch/definitions');
const { sha256, transform } = require('../src/patch/integrity');
const api = (showCloudChats = false) => ({ workspace: {
  getConfiguration: section => {
    assert.equal(section, 'codexScopePls');
    return { get: (key, fallback) => { assert.equal(key, 'showCloudChats'); assert.equal(fallback, false); return showCloudChats; } };
  }
} });

test('cloud listing is hidden by default for reviewed relative and absolute URLs', () => {
  for (const url of ['/wham/tasks/list', 'wham/tasks/list?limit=20', 'https://chatgpt.com/backend-api/wham/tasks/list?task_filter=current']) {
    assert.equal(hide({ method: 'GET', url }, api()), true);
    assert.equal(hide({ method: 'GET', url }, api(true)), false);
  }
});
test('cloud filter never inspects headers/body or intercepts details, mutations, or other origins', () => {
  const request = { method: 'GET', url: '/wham/tasks/list',
    get headers() { assert.fail('headers must not be read'); }, get body() { assert.fail('body must not be read'); } };
  assert.equal(hide(request, api()), true);
  const unreachableApi = { get workspace() { assert.fail('unrelated request must not read settings'); } };
  for (const url of ['/wham/tasks/task-id', '/wham/tasks/task-id/turns', '/wham/tasks/list/extra', '/wham/tasks/listing', 'https://example.com/backend-api/wham/tasks/list', 'https://chatgpt.com.evil.invalid/backend-api/wham/tasks/list', '/account/info']) {
    assert.equal(hide({ method: 'GET', url }, unreachableApi), false);
  }
  for (const method of ['POST', 'DELETE', 'PUT', 'PATCH']) assert.equal(hide({ method, url: '/wham/tasks/list' }, unreachableApi), false);
});
test('patched HTTP boundary returns empty items without entering stock transport; opt-in passes through', async () => {
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  const definition = { ...definitions[0], originalHash: sha256(original) };
  let show = false;
  let forwarded = 0;
  const context = { module: { exports: {} }, Response,
    pPe: url => { forwarded++; return url; },
    require: name => { assert.equal(name, 'vscode'); return api(show); } };
  vm.runInNewContext(transform(original, definition).toString(), context);
  const provider = new context.module.exports();
  const request = { method: 'GET', url: '/wham/tasks/list?limit=20' };
  const result = await provider.fetchHttp('request-id', request, null);
  assert.equal(result.response.status, 200);
  assert.deepEqual(await result.response.json(), { items: [], cursor: null });
  assert.equal(forwarded, 0);
  show = true;
  assert.equal((await provider.fetchHttp('request-id', request, null)).forwarded, request);
  assert.equal(forwarded, 1);
  show = false;
  const detail = { method: 'GET', url: '/wham/tasks/task-id' };
  assert.equal((await provider.fetchHttp('request-id', detail, null)).forwarded, detail);
});
test('cloud preference is application-scoped, defaults off, and sidebar uses supported menus', () => {
  const manifest = require('../package.json');
  const setting = manifest.contributes.configuration.properties['codexScopePls.showCloudChats'];
  assert.equal(setting.scope, 'application');
  assert.equal(setting.default, false);
  const menus = manifest.contributes.menus['view/title'];
  assert.ok(menus.some(item => item.command === 'codexScopePls.settings' && item.group.startsWith('navigation')));
  for (const item of menus) {
    assert.equal(item.when, 'view == chatgpt.sidebarView || view == chatgpt.sidebarSecondaryView');
    assert.ok(manifest.contributes.commands.some(command => command.command === item.command));
  }
});
