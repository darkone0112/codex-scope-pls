'use strict';

// Pure presentation predicate. Do not mutate entries, summaries or shared lists.
function codexScopePlsVisible(entry, summary, scope) {
  if (!scope) return true;
  if (entry.kind === 'remote') return scope.showCloudChats === true;
  if (scope.mode !== 'workspace' || scope.roots.length === 0) return true;
  const cwd = summary?.cwd ?? entry.summary?.cwd ?? entry.cwd;
  // A new provisional row can precede its thread summary. Keep it usable.
  if (typeof cwd !== 'string') return entry.conversationId == null;
  const normalize = value => {
    const slashes = scope.platform === 'win32' ? value.replace(/\\/g, '/') : value;
    return slashes === '/' || /^[A-Za-z]:\/$/.test(slashes) ? slashes : slashes.replace(/\/+$/, '');
  };
  return scope.roots.some(root => normalize(root) === normalize(cwd));
}

function codexScopePlsReadViewScope(document) {
  const content = document.querySelector('meta[name="codex-scope-pls-view"]')?.content;
  if (!content) return null;
  try {
    const scope = JSON.parse(content);
    if (!scope || !['workspace', 'all'].includes(scope.mode) ||
      !Array.isArray(scope.roots) || !scope.roots.every(root => typeof root === 'string') ||
      typeof scope.platform !== 'string' || typeof scope.showCloudChats !== 'boolean' ||
      (scope.groupChatsByProject !== undefined && typeof scope.groupChatsByProject !== 'boolean')) return null;
    return scope;
  } catch {
    // An absent/malformed presentation snapshot must not break the official UI.
    return null;
  }
}

module.exports = { codexScopePlsVisible, codexScopePlsReadViewScope };
