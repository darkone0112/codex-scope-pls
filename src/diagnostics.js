'use strict';
const { inspect } = require('./patch/patcher');
const { locate } = require('./codexLocator');
const { readRegular } = require('./patch/backup');
const { sha256, count } = require('./patch/integrity');
async function diagnostics(vscode, context, lastResult) {
  const result = {
    extensionVersion: context.extension.packageJSON.version,
    codexVersion: vscode.extensions.getExtension('openai.chatgpt')?.packageJSON.version || 'not installed',
    workspaceRoots: (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath),
    mode: vscode.workspace.getConfiguration('codexScopePls').get('mode', 'workspace'),
    showCloudChats: vscode.workspace.getConfiguration('codexScopePls').get('showCloudChats', false),
    autoApply: context.globalState.get('autoApply', true), lastResult
  };
  try {
    const { target, definition } = await locate(vscode, true);
    result.target = target;
    result.bundleCompatibility = 'exact SHA-256 match';
    result.versionRecognition = definition.knownVersion ? 'reviewed version' : 'unlisted version with reviewed bundle';
    result.originalSHA256 = definition.originalHash;
    const candidate = await readRegular(target);
    result.currentSHA256 = sha256(candidate);
    result.patched = 'unverified';
    result.patchPoints = definition.points.map(point => ({
      name: point.name, originalMatches: count(candidate.toString('utf8'), point.before),
      patchedMatches: count(candidate.toString('utf8'), point.after)
    }));
    const state = await inspect(target, definition);
    result.currentSHA256 = state.hash;
    result.patched = state.isPatched;
    result.patchRevision = state.isPreviousPatch ? 'previous (upgrade available)' : state.isCurrentPatch ? 'current' : 'original';

  } catch (error) { result.compatibility = safeError(error); }
  return result;
}
function safeError(error) {
  // Node errors may include paths. All custom errors contain operational text only.
  return error.code ? `File operation failed (${error.code})` : error.message;
}
module.exports = { diagnostics, safeError };
