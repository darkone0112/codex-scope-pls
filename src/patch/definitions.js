'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Copy only checked-in static JavaScript. Nothing is evaluated by the patcher.
const scopeSource = fs.readFileSync(path.join(__dirname, '../workspaceScope.js'), 'utf8');
const suffix = '\nmodule.exports = { codexScopePlsFilter };\n';
if (!scopeSource.endsWith(suffix)) throw new Error('Invalid packaged scope source');
const insertion = '\n/* codex-scope-pls:1 */\nif(n==="thread/list"){\n' +
  scopeSource.slice(0, -suffix.length) + '\no=codexScopePlsFilter(o,require("vscode"));\n}\n';
const before = 'sendProviderRequest(e,r,n,o,i,s){let a=`${e}:${r}`;s&&oG(n)&&this.providers.get(e)?.onRequestDelivery!=null&&this.pendingRequests.set(a,{providerName:e,requestId:r,method:n}),i&&this.pendingPrewarmedThreadStartRequestIds.add(a);let c={id:a,method:n,params:o};';
const after = before.replace('{let a=', '{' + insertion + 'let a=');
const cloudSource = fs.readFileSync(path.join(__dirname, '../cloudScope.js'), 'utf8');
const cloudSuffix = '\nmodule.exports = { codexScopePlsHideCloudList };\n';
if (!cloudSource.endsWith(cloudSuffix)) throw new Error('Invalid packaged cloud source');
const cloudBefore = 'async fetchHttp(e,r,n){try{let o=pPe(r.url),';
const cloudAfter = 'async fetchHttp(e,r,n){\n/* codex-scope-pls:cloud:1 */\n' +
  cloudSource.slice(0, -cloudSuffix.length) +
  '\nif(codexScopePlsHideCloudList(r,require("vscode")))return{response:new Response(JSON.stringify({items:[],cursor:null}),{status:200,headers:{"content-type":"application/json"}})};\ntry{let o=pPe(r.url),';
// Official platform VSIX bundles were compared byte-for-byte; see docs/compatibility.md.
// Keep explicit pairs: an unknown platform/architecture must still fail closed.
// Each entry names a host where this exact original bundle was verified.
// Version is intentionally not a gate: the whole-file SHA-256 is the gate.
const platforms = [
  ['linux', 'x64'],
  ['linux', 'arm64'],
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['win32', 'x64'],
  ['win32', 'arm64']
];

module.exports = platforms.map(([platform, arch]) => ({
  platform, arch,
  reviewedVersions: ['26.908.31748', '26.908.40401'],
  relativePath: 'out/extension.js',
  originalHash: '820691c93be40e73f0929b633cddc694b41775050cd72283faba283e53941f4f',
  currentPatchedHashes: ['588f20d88043b33d18ac0e70da4795c3b82b56c0e815985bfdf7a6f164558042'],
  previousPatchedHashes: ['b7b9d97fc118e2d6947ec90178c4623afecbd1d5c0b6037e21574ba22b98d33f'],
  points: [
    { name: 'local app-server provider request boundary', before, after },
    { name: 'cloud task-list HTTP boundary', before: cloudBefore, after: cloudAfter }
  ]
}));
