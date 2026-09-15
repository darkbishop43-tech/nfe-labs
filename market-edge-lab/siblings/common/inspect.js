(()=>{
  const boot=()=>{
    const oppRoot=document.getElementById('opps');
    const modal=document.getElementById('modal');
    const modalTitle=document.getElementById('modalTitle');
    const modalBody=document.getElementById('modalBody');
    if(!oppRoot||!modal||!modalTitle||!modalBody)return;
    if(oppRoot.dataset.inspectReady==='1')return;
    oppRoot.dataset.inspectReady='1';

    const safe=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const row=(a,b)=>`<div class="detail"><span>${safe(a)}</span><b>${safe(b)}</b></div>`;
    const percent=v=>(Number(v||0)*100).toFixed(3)+'%';
    const cents=v=>(Number(v||0)*100).toFixed(1)+'¢';

    const enhance=()=>{
      oppRoot.querySelectorAll('.opp').forEach(card=>{
        card.style.cursor='pointer';
        card.setAttribute('tabindex','0');
        card.setAttribute('role','button');
        card.setAttribute('aria-label','Inspect potential trade');
        if(!card.querySelector('.inspectHint')){
          const h=document.createElement('div');
          h.className='m inspectHint';
          h.style.marginTop='8px';
          h.style.fontWeight='700';
          h.textContent='CLICK TO INSPECT POTENTIAL TRADE';
          card.appendChild(h);
        }
      });
    };

    const openCard=card=>{
      const cards=[...oppRoot.querySelectorAll('.opp')];
      const i=cards.indexOf(card);
      if(i<0||typeof opportunities!=='function')return;
      const list=opportunities().slice(0,20),o=list[i];
      if(!o)return;
      const sd=typeof side==='function'?side(o):(o.side||'UNKNOWN');
      const out=o.positionOutcome||'YES';
      const sc=typeof score==='function'?score(o):Number(o.score||0);
      const ed=typeof edge==='function'?edge(o):Number(o.edge||0);
      const mv=typeof move==='function'?move(o):Number(o.move||0);
      const q=typeof question==='function'?question(o):(o.question||'Unknown market');
      const as=typeof asset==='function'?asset(o):(o.asset||'—');
      const pr=typeof price==='function'?price(o):Number(o.positionPrice||o.yes||0);
      const id=typeof marketId==='function'?marketId(o):(o.id||o.marketId||'—');
      const analysis=(window.SIBLING_CONFIG&&window.SIBLING_CONFIG.analyze)?window.SIBLING_CONFIG.analyze(o,list,i):null;
      modalTitle.textContent=(sd==='BELOW'?'Downside':'Above')+' Potential Trade';
      modalBody.innerHTML=`<div class="q"><span class="sideBadge ${sd==='BELOW'?'below':'above'}">${safe(sd==='BELOW'?'DOWNSIDE':'ABOVE')}</span>${safe(q)}</div><div class="detail-grid">${row('System',window.SIBLING_CONFIG?.title||'Sibling')}${row('Asset',as)}${row('Direction',sd)}${row('Position side',out)}${row('Current quote',cents(pr))}${row('Score',sc.toFixed(3))}${row('Edge',percent(ed))}${row('Underlying move',percent(mv))}${row('Heuristic fair',cents(Number(o.fair||0)))}${row('YES quote',cents(Number(o.yes||0)))}${row('NO quote',cents(Number(o.no||0)))}${row('Market ID / source identity',id)}${row('Source',o.source||'—')}${row('Ends',o.endDate||'—')}</div>${analysis?.html?`<div class="note"><b>${safe(window.SIBLING_CONFIG?.decisionLabel||'Sibling view')}: ${safe(analysis.label||'—')}</b><br>${analysis.html}</div>`:''}<div class="note">Potential paper trade only — no order is submitted. Direction and quoted side are shown exactly as supplied by the validated sibling opportunity universe.</div>`;
      modal.classList.add('open');
    };

    oppRoot.addEventListener('click',e=>{const card=e.target.closest('.opp');if(card&&oppRoot.contains(card))openCard(card)});
    oppRoot.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const card=e.target.closest('.opp');if(card&&oppRoot.contains(card)){e.preventDefault();openCard(card)}});
    new MutationObserver(enhance).observe(oppRoot,{childList:true,subtree:false});
    enhance();
  };

  // The dashboard is the proven shared engine. If the cached branch URL failed to
  // execute, reload that same engine under a fresh cache key, then attach inspection.
  if(typeof opportunities==='function'){
    boot();
  }else{
    const s=document.createElement('script');
    s.src='../common/dashboard.js?v=bootstrap-repair-20260915';
    s.onload=boot;
    s.onerror=()=>{
      const cloud=document.getElementById('cloud');
      if(cloud)cloud.innerHTML='<b class="bad">SHARED DASHBOARD LOAD ERROR</b>';
    };
    document.body.appendChild(s);
  }
})();
