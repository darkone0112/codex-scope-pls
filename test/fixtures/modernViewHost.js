function ch(value) {
  return value.replace(/["<&]/g, character => ({ '"': '&quot;', '<': '&lt;', '&': '&amp;' })[character]);
}
class ViewHost {
  findPanelByWebview() { return null; }
  webviewMetaTags(e){let r=[],n=this.findPanelByWebview(e);
    return r.join('\n');
  }
}
module.exports = ViewHost;
