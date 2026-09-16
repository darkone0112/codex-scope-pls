'use strict';

// Static source inserted only at the reviewed HTTP task-list boundary.
// Do not inspect headers, credentials, task details, or responses.
function codexScopePlsHideCloudList(request, vscode) {
  if (request.method !== 'GET' || typeof request.url !== 'string') return false;
  const endpoint = request.url.split('?')[0];
  if (![
    '/wham/tasks/list',
    'wham/tasks/list',
    'https://chatgpt.com/backend-api/wham/tasks/list'
  ].includes(endpoint)) return false;
  return vscode.workspace.getConfiguration('codexScopePls').get('showCloudChats', false) !== true;
}

module.exports = { codexScopePlsHideCloudList };
