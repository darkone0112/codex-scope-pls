// Representative direct row calls used by header-5e09211ec02d.js, whose
// inline and dropdown history menus bypass the desktop xmr renderer.
function localHistory(conversationId, readThreadState, document) {
  const n = conversationId;
  const pt = readThreadState(n);
  const mt = pt?.cwd ?? null;
  const t = [], An = n, Ie = mt, Ge = false;
  let Kn;return t[116]!==An||t[117]!==Ie||t[118]!==Ge
    ? (Kn = { conversationId: n, cwd: mt }, t[116] = An, t[117] = Ie, t[118] = Ge, t[119] = Kn)
    : Kn = t[119], Kn;
}
function cloudHistory(task, document) {
  const ht = task, L = undefined, I = [], Me = false;
  let gt=ht;if(L===void 0&&I?.length===0&&!Me)return gt;
  return gt;
}
function pendingHistory(pending, document) {
  const o = pending, t = [], x = o, S = null;
  let C;return t[30]!==x||t[31]!==S?
    (C = x, t[30] = x, t[31] = S, t[32] = C) : C = t[32], C;
}
function worktreeHistory(task, document) {
  const r = task, t = [], L = r, O = null, k = false;
  let he;return t[25]!==L||t[26]!==O||t[27]!==k
    ? (he = r, t[25] = L, t[26] = O, t[27] = k, t[28] = he) : he = t[28], he;
}
function renderHistory(entries, readThreadState, document) {
  return entries.map(entry => {
    if (entry.kind === 'remote') return cloudHistory(entry.task, document);
    if (entry.pendingThreadStart) return pendingHistory(entry.pendingThreadStart, document);
    if (entry.pendingWorktree) return worktreeHistory(entry.pendingWorktree, document);
    return localHistory(entry.conversation.id, readThreadState, document);
  });
}
module.exports.history = renderHistory;
