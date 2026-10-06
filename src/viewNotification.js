'use strict';

function codexScopePlsAcceptViewScope(message, document, window) {
  if (message?.type !== 'codex-scope-pls-view-scope') return false;
  let content;
  try { content = JSON.stringify(message.scope); } catch { return true; }
  const scope = codexScopePlsReadViewScope({ querySelector: () => ({ content }) });
  if (!scope) return true;
  const tag = document.querySelector('meta[name="codex-scope-pls-view"]');
  if (tag && tag.content !== content) {
    tag.content = content;
    window.dispatchEvent(new window.Event('codex-scope-pls-view-change'));
  }
  return true;
}

module.exports = { codexScopePlsAcceptViewScope };
