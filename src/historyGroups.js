'use strict';

// Group only rendered UI rows. Keep source lists, entry identity, row actions,
// preview limits and totals intact. Sections follow their most recent row.
function codexScopePlsGroupHistoryRows(entries, rows, jsx, scope) {
  if (scope?.mode !== 'all' || scope.groupChatsByProject !== true) return rows;
  const groups = new Map();
  entries.forEach((entry, index) => {
    const cwd = entry.conversation?.cwd ?? entry.pendingThreadStart?.task.cwd ??
      entry.pendingWorktree?.sourceWorkspaceRoot ?? entry.cwd;
    let label, key;
    if (entry.kind === 'remote') {
      key = 'remote'; label = 'Cloud chats';
    } else if (typeof cwd !== 'string' || cwd.length === 0) {
      key = 'unknown'; label = 'Other local chats';
    } else {
      const slashes = scope.platform === 'win32' ? cwd.replace(/\\/g, '/') : cwd;
      label = slashes === '/' || /^[A-Za-z]:\/$/.test(slashes) ? slashes : slashes.replace(/\/+$/, '');
      key = `folder:${label}`;
    }
    if (!groups.has(key)) groups.set(key, { label, rows: [] });
    groups.get(key).rows.push(rows[index]);
  });
  return Array.from(groups, ([key, group]) => jsx.jsxs('section', {
    'aria-label': group.label,
    children: [jsx.jsx('h3', {
      className: 'mx-2 mt-2 mb-1 truncate text-xs text-tertiary',
      title: group.label,
      children: group.label
    }), ...group.rows]
  }, `codex-scope-pls-group:${key}`));
}

module.exports = { codexScopePlsGroupHistoryRows };
