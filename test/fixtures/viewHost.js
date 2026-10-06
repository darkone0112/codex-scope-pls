class ViewHost {
async initializeWebview(e,r,n,o){let i=Ge.Uri.joinPath(this.extensionUri,"webview");
return i;
}
webviewMetaTags(e){let r=[],n=this.findPanelByWebview(e);
return r.join('\n');
}
async provideChatSessionItems(e,r){return(await this.requestThreadList(e)).data.map(o=>{
return o;
});
}
sendProviderRequest(e,r,n,o,i,s){return {id:r,method:n,params:o};}
async fetchHttp(e,r,n){return {forwarded:r};}
}
module.exports = ViewHost;
