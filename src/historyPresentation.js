'use strict';

function codexScopePlsUseViewScope(react, document, window) {
  const content = react.useSyncExternalStore(notify => {
    window.addEventListener('codex-scope-pls-view-change', notify);
    return () => window.removeEventListener('codex-scope-pls-view-change', notify);
  }, () => document.querySelector('meta[name="codex-scope-pls-view"]')?.content ?? '');
  return react.useMemo(() => codexScopePlsReadViewScope({
    querySelector: () => ({ content })
  }), [content]);
}

// Work on derived UI entries only. The source arrays and their objects remain
// available to Codex unchanged, including its own list reconciliation.
function codexScopePlsHistoryEntries(entries, scope) {
  if (!scope) return entries;
  return entries.filter(entry => codexScopePlsVisible({ kind: entry.kind,
    conversationId: entry.conversation?.conversationId ?? entry.conversation?.id,
    cwd: entry.conversation?.cwd ?? entry.pendingThreadStart?.task.cwd ??
      entry.pendingWorktree?.sourceWorkspaceRoot
  }, null, scope));
}

function codexScopePlsHistoryConversations(conversations, scope) {
  if (!scope) return conversations;
  return conversations.filter(conversation =>
    codexScopePlsVisible({ kind: 'local', conversationId: conversation.conversationId ?? conversation.id }, conversation, scope));
}

// Newer headers query progress by host/thread identity instead of returning
// conversation summaries. Resolve cwd from the already loaded display list.
function codexScopePlsHistoryInProgress(keys, conversations, scope) {
  if (!scope) return keys;
  return keys.filter(key => {
    const conversation = conversations.find(item => item.hostId === key.hostId &&
      (item.conversationId ?? item.id) === key.threadId);
    return codexScopePlsVisible({ kind: 'local', conversationId: key.threadId }, conversation, scope);
  });
}

module.exports = { codexScopePlsUseViewScope, codexScopePlsHistoryEntries, codexScopePlsHistoryConversations, codexScopePlsHistoryInProgress };
