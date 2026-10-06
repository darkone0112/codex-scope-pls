'use strict';
const { inspect } = require('./patch/patcher');
const { locate, installationTargets } = require('./codexLocator');
const { readRegular } = require('./patch/backup');
const { sha256, count } = require('./patch/integrity');
async function diagnostics(vscode, context, lastResult) {
  const config = vscode.workspace.getConfiguration('codexScopePls');
  const modeValues = config.inspect('mode');
  const result = {
    extensionVersion: context.extension.packageJSON.version,
    codexVersion: vscode.extensions.getExtension('openai.chatgpt')?.packageJSON.version || 'not installed',
    workspaceRoots: (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath),
    mode: config.get('mode', 'workspace'),
    modeSettings: { user: modeValues?.globalValue, workspace: modeValues?.workspaceValue },
    showCloudChats: config.get('showCloudChats', false),
    groupChatsByProject: config.get('groupChatsByProject', false),
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
    result.filterBoundary = definition.presentation ? 'GUI presentation only' : 'legacy backend patch (restore only)';
    result.displayTargets = [];
    for (const item of await installationTargets(target, definition, true)) {
      const inspected = await inspect(item.target, item.definition);
      result.displayTargets.push({ target: item.target, originalSHA256: item.definition.originalHash,
        currentSHA256: inspected.hash, patched: inspected.isPatched });
    }

  } catch (error) { result.compatibility = safeError(error); }
  return result;
}
function safeError(error) {
  // Node errors may include paths. All custom errors contain operational text only.
  return error.code ? `File operation failed (${error.code})` : error.message;
}
module.exports = { diagnostics, safeError };
