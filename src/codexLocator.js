'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const definitions = require('./patch/definitions');
const { selectDefinition, sha256 } = require('./patch/integrity');
const { readRegular } = require('./patch/backup');
function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
async function locate(vscode, restoration = false, profiles = definitions) {
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  if (!extension) throw new Error('OpenAI Codex extension is not installed in this host');
  const definition = selectDefinition(extension.packageJSON.version, process.platform, process.arch, profiles);
  if (!restoration && (vscode.env.remoteName || vscode.workspace.workspaceFolders?.some(f => f.uri.scheme !== 'file'))) {
    throw new Error('Only local file workspaces are supported by this compatibility definition');
  }
  if (!restoration && vscode.workspace.getConfiguration('chatgpt').get('cliExecutable')) {
    throw new Error('Custom Codex CLI is not supported by this compatibility definition');
  }
  const root = await fs.realpath(extension.extensionPath);
  const target = path.join(root, definition.relativePath);
  if (!samePath(await fs.realpath(path.dirname(target)), path.dirname(target))) throw new Error('Refusing symlinked bundle directory');
  const current = await readRegular(target);
  const currentHash = sha256(current);
  const acceptedHashes = [definition.originalHash, ...definition.currentPatchedHashes, ...definition.previousPatchedHashes];
  if (!acceptedHashes.includes(currentHash)) throw new Error('Unsupported Codex bundle SHA-256');
  return { target, definition, currentHash };
}
module.exports = { locate };
