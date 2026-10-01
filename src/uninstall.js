'use strict';
// VS Code runs this hook after this extension is removed and restarted. It has
// no VS Code API, so it only inspects sibling OpenAI extension directories.
const fs = require('node:fs/promises');
const path = require('node:path');
const definitions = require('./patch/definitions');
const { selectDefinition, selectBundle, sha256 } = require('./patch/integrity');
const { readRegular } = require('./patch/backup');
const { change } = require('./patch/patcher');

async function readDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Refusing symlinked extensions directory');
  return fs.readdir(directory, { withFileTypes: true });
}

async function patchedTargets(extensionsDirectory, profiles = definitions) {
  const entries = await readDirectory(extensionsDirectory);
  const targets = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith('openai.chatgpt-')) continue;
    const root = path.join(extensionsDirectory, entry.name);
    const manifest = JSON.parse((await readRegular(path.join(root, 'package.json'))).toString('utf8'));
    if (manifest.name !== 'chatgpt' || manifest.publisher !== 'openai') continue;
    const profile = selectDefinition(manifest.version, process.platform, process.arch, profiles);
    const target = path.join(root, profile.relativePath);
    const hash = sha256(await readRegular(target));
    const definition = selectBundle(profile, hash);
    if (hash !== definition.originalHash) targets.push({ target, definition });
  }
  return targets;
}

async function restoreInstalled(extensionsDirectory, profiles = definitions) {
  const targets = await patchedTargets(extensionsDirectory, profiles);
  const results = [];
  for (const { target, definition } of targets) results.push(await change(target, definition, 'restore'));
  return results;
}

async function main() {
  // The packaged hook lives in <extensions>/local.codex-scope-pls-*/src/.
  const extensionsDirectory = path.dirname(path.dirname(__dirname));
  const results = await restoreInstalled(extensionsDirectory);
  console.log(`Codex Scope Pls: restored ${results.filter(result => result.changed).length} Codex bundle(s).`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Codex Scope Pls: uninstall cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
module.exports = { patchedTargets, restoreInstalled };
