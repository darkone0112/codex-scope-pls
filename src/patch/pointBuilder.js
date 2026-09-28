'use strict';
const fs = require('node:fs');
const path = require('node:path');
const scopeSource = fs.readFileSync(path.join(__dirname, '../workspaceScope.js'), 'utf8');
const scopeSuffix = '\nmodule.exports = { codexScopePlsFilter };\n';
if (!scopeSource.endsWith(scopeSuffix)) throw new Error('Invalid packaged scope source');
const localInsertion = '\n/* codex-scope-pls:1 */\nif(n==="thread/list"){\n' +
  scopeSource.slice(0, -scopeSuffix.length) + '\no=codexScopePlsFilter(o,require("vscode"));\n}\n';
const cloudSource = fs.readFileSync(path.join(__dirname, '../cloudScope.js'), 'utf8');
const cloudSuffix = '\nmodule.exports = { codexScopePlsHideCloudList };\n';
if (!cloudSource.endsWith(cloudSuffix)) throw new Error('Invalid packaged cloud source');
const cloudInsertion = '\n/* codex-scope-pls:cloud:1 */\n' + cloudSource.slice(0, -cloudSuffix.length) +
  '\nif(codexScopePlsHideCloudList(r,require("vscode")))return{response:new Response(JSON.stringify({items:[],cursor:null}),{status:200,headers:{"content-type":"application/json"}})};\n';
function buildPoints(localBefore, cloudBefore) {
  const localBrace = localBefore.indexOf('{');
  const cloudBoundary = cloudBefore.indexOf('{try{');
  if (localBrace < 0 || cloudBoundary < 0 || cloudBefore.indexOf('{try{', cloudBoundary + 1) !== -1) {
    throw new Error('Invalid compatibility point data');
  }
  return [
    { name: 'local app-server provider request boundary', before: localBefore,
      after: localBefore.slice(0, localBrace + 1) + localInsertion + localBefore.slice(localBrace + 1) },
    { name: 'cloud task-list HTTP boundary', before: cloudBefore,
      after: cloudBefore.slice(0, cloudBoundary + 1) + cloudInsertion + 'try{' + cloudBefore.slice(cloudBoundary + 5) }
  ];
}
module.exports = { buildPoints };
