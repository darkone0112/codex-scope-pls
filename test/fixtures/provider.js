class Provider {
sendProviderRequest(e,r,n,o,i,s){let a=`${e}:${r}`;s&&oG(n)&&this.providers.get(e)?.onRequestDelivery!=null&&this.pendingRequests.set(a,{providerName:e,requestId:r,method:n}),i&&this.pendingPrewarmedThreadStartRequestIds.add(a);let c={id:a,method:n,params:o};
return c;
}
async fetchHttp(e,r,n){try{let o=pPe(r.url),unused=null;return {forwarded:r};}catch(error){throw error}
}
}
module.exports = Provider;
