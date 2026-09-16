(()=>{
  const url=()=>`https://raw.githubusercontent.com/darkbishop43-tech/nfe-labs/market-edge-sibling-build/market-edge-lab/siblings/state/${encodeURIComponent(C.key)}.json?t=${Date.now()}`;
  async function sync(){
    try{
      const r=await fetch(url(),{cache:'no-store'});
      if(!r.ok)return;
      const s=await r.json();
      if(!s||s.mode!=='PAPER_ONLY'||s.lab!==C.key)return;
      local=s;
      window.SIBLING_CLOUD_ACTIVE=true;
      saveLocal();
      render();
      const cloud=E('cloud');
      if(cloud)cloud.innerHTML='<b class="good">LIVE SHARED MARKET FEED · CLOUD PAPER EXECUTOR · PAPER ONLY</b>';
    }catch{}
  }
  window.SIBLING_CLOUD_SYNC={sync};
  sync();
  setInterval(sync,15000);
})();