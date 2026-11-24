'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hostDefinition, notificationDefinition, rowDefinition } = require('../src/patch/structuralPoints');
const { transform } = require('../src/patch/integrity');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name));

function hostHarness(bytes, mode = 'workspace') {
  const callbacks = [];
  const disposable = { dispose() {} };
  const vscode = { workspace: {
    workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/a' } }],
    getConfiguration: () => ({ get: (key, fallback) => key === 'mode' ? mode : fallback }),
    onDidChangeConfiguration: callback => { callbacks.push(callback); return disposable; },
    onDidChangeWorkspaceFolders: () => disposable
  } };
  const sandbox = { module: { exports: {} }, process, RS: 'provider', la: ['local'],
    i9e: id => `session:${id}`, a9e: preview => preview, Wge: 'version', Hge: 'session', Gge: 'flavor', Ah: value => value,
    require: name => name === 'vscode' ? vscode : require(name) };
  const definition = hostDefinition(bytes);
  vm.runInNewContext(transform(bytes, definition).toString(), sandbox);
  const host = new sandbox.module.exports();
  host.subscriptions = [];
  return { host, definition, callbacks };
}

test('new native loader filters display rows without coupling to helper name, query or error handling', async () => {
  let source = fixture('refactoredHost.js').toString();
  source = source.replaceAll('loadConversationItems', 'readPickerRows')
    .replace('let r=await this.codexAppServer', 'const untouched=true;let r=await this.codexAppServer');
  const { host, definition } = hostHarness(Buffer.from(source));
  assert.equal(definition.nativeSessionDisplay, 'filtered');
  const rows = Object.freeze([
    Object.freeze({ id: 'own', cwd: '/a', preview: 'own', createdAt: 1 }),
    Object.freeze({ id: 'other', cwd: '/b', preview: 'other', createdAt: 2 })
  ]);
  const response = Object.freeze({ result: Object.freeze({ data: rows }) });
  let requests = 0;
  host.codexAppServer = { request: async (method, params) => {
    requests++; assert.equal(method, 'thread/list'); assert.equal(params.cwd, undefined); return response;
  } };
  const items = await host.provideChatSessionItems(false);
  assert.deepEqual(Array.from(items, row => row.item.id), ['own']);
  assert.equal(requests, 1);
  assert.equal(rows.length, 2);
  host.codexAppServer.request = async () => ({ error: { message: 'native error' } });
  await assert.rejects(host.provideChatSessionItems(false), /native error/);
  host.codexAppServer.request = async () => ({});
  await assert.rejects(host.provideChatSessionItems(false), /No result in response/);
});

test('unknown or ambiguous native pickers remain stock while metadata and live preferences work', async () => {
  const source = Buffer.from('class Host{webviewMetaTags(){const content=this.stock;return content}'+
    'async initializeWebview(view,role,onClose,extra,more){this.started=role;return 7}'+
    'async provideChatSessionItems(){return this.rows}}module.exports=Host;');
  const { host, definition } = hostHarness(source);
  assert.equal(definition.nativeSessionDisplay, 'stock');
  assert.equal(definition.points.length, 2);
  host.stock = '<meta name="stock" content="preserved">';
  assert.ok(host.webviewMetaTags().endsWith(host.stock));
  assert.match(host.webviewMetaTags(), /codex-scope-pls-view/);
  host.stock = undefined;
  assert.equal(host.webviewMetaTags(), undefined);
  let dispose;
  assert.equal(await host.initializeWebview({ postMessage: async () => true }, 'sidebar', callback => {
    dispose = callback; return { dispose() {} };
  }), 7);
  assert.equal(host.started, 'sidebar');
  assert.equal(host.subscriptions.length, 2);
  dispose();
  host.rows = Object.freeze([Object.freeze({ id: 'stock' })]);
  assert.equal(await host.provideChatSessionItems(), host.rows);

  const duplicate = fixture('refactoredHost.js').toString().replace('return this.loadConversationItems(request)',
    'this.alternative(request);return this.loadConversationItems(request)').replace('toChatSessionItem(t){',
    'async alternative(){return data.data.map(row=>({summary:row,item:this.toChatSessionItem(row)}))}toChatSessionItem(t){');
  assert.equal(hostDefinition(Buffer.from(duplicate)).nativeSessionDisplay, 'stock');
});

test('notification additions run after native validation and independently require same-origin messages', () => {
  const bytes = fixture('refactoredMessage.js');
  const tag = { content: '' }, events = [], acknowledgements = [];
  const window = { location: { origin: 'vscode-test' }, Event: class { constructor(type) { this.type = type; } },
    dispatchEvent: event => events.push(event.type) };
  const state = { valid: true, chunkType: 'passthrough' };
  const scope = { mode: 'workspace', roots: ['/a'], platform: 'linux', showCloudChats: false };
  const data = Object.freeze({ type: 'codex-scope-pls-view-scope', scope });
  const sandbox = { module: { exports: {} }, document: { querySelector: () => tag },
    Ylt: value => value?.chunk === true, Jlt: () => state.valid,
    qlt: () => ({ receive: packet => ({ type: state.chunkType, message: packet.message, acknowledgement: { transferId: 'x', sequence: 1 } }) }),
    bg: { postMessage: message => acknowledgements.push(message) } };
  vm.runInNewContext(transform(bytes, notificationDefinition(bytes)).toString(), sandbox);
  const parser = sandbox.module.exports;
  const event = payload => ({ origin: 'vscode-test', data: payload });
  state.valid = false;
  assert.equal(parser(event(data), window), null);
  assert.equal(tag.content, '');
  state.valid = true;
  state.chunkType = 'pending';
  assert.equal(parser(event({ chunk: true, message: data }), window), null);
  assert.equal(tag.content, '');
  assert.equal(acknowledgements.length, 1);
  state.chunkType = 'complete';
  assert.equal(parser(event({ chunk: true, message: data }), window), null);
  assert.equal(tag.content, JSON.stringify(scope));
  assert.deepEqual(events, ['codex-scope-pls-view-change']);
  const stock = Object.freeze({ type: 'stock' });
  assert.equal(parser(event(stock), window), stock);
  assert.equal(parser({ origin: 'foreign', data }, window), null);

  // Even a future widened native origin check cannot feed our preferences.
  const widened = Buffer.from(bytes.toString().replace('e.origin===n', 'e.origin!==n'));
  sandbox.module = { exports: {} }; tag.content = '';
  vm.runInNewContext(transform(widened, notificationDefinition(widened)).toString(), sandbox);
  assert.equal(sandbox.module.exports({ origin: 'foreign', data }, window), data);
  assert.equal(tag.content, '');
});

test('row summary resolution follows rendered data when a selector is removed', () => {
  const source = fixture('localOnlyRow.js').toString().replace(',Ne=store(selector,key)??Ce', '')
    .replace('let pt=render;', 'let pt=function(item){let displayed=item.summary??null;return render({threadSummary:displayed,conversationId:item.conversationId})};');
  const definition = rowDefinition(Buffer.from(source));
  const sandbox = { module: { exports: {} }, Compiler: { c: n => Array(n) }, hooks() {}, render: value => value,
    document: { querySelector: () => ({ content: JSON.stringify({ mode: 'workspace', roots: ['/a'], platform: 'linux', showCloudChats: false }) }) } };
  vm.runInNewContext(transform(Buffer.from(source), definition).toString(), sandbox);
  assert.equal(sandbox.module.exports({ entry: { conversationId: 'other', summary: { cwd: '/b' } } }), null);
  assert.equal(sandbox.module.exports({ entry: { conversationId: 'own', summary: { cwd: '/a' } } }).conversationId, 'own');
});
