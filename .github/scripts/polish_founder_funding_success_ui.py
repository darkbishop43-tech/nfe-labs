from pathlib import Path

p=Path('market-edge-lab/real/baseline/src/index.js')
s=p.read_text()
old='''      return json({ok:true,state:reconciled?"INDEX2_TRANSFER_RECONCILED":"INDEX2_TRANSFER_ACCEPTED_AWAITING_BALANCE_RECONCILIATION",transfer:{amountUsd:amount,sourceExchangeIndex:0,destinationExchangeIndex:2,pre:{index0Usd:index0,index2Usd:index2,totalUsd:total},post:{index0Usd:post0,index2Usd:post2,totalUsd:postTotal},reconciled},providerWrites:1,ordersSubmitted:0,armChanged:false,disarmChanged:false});'''
new='''      const diagnostic={ok:true,state:reconciled?"INDEX2_TRANSFER_RECONCILED":"INDEX2_TRANSFER_ACCEPTED_AWAITING_BALANCE_RECONCILIATION",transfer:{amountUsd:amount,sourceExchangeIndex:0,destinationExchangeIndex:2,pre:{index0Usd:index0,index2Usd:index2,totalUsd:total},post:{index0Usd:post0,index2Usd:post2,totalUsd:postTotal},reconciled},providerWrites:1,ordersSubmitted:0,armChanged:false,disarmChanged:false};
      const diagnosticHtml=JSON.stringify(diagnostic,null,2).replace(/[&<>]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[ch]));
      const resultTitle=reconciled?"TRANSFER COMPLETE":"TRANSFER ACCEPTED — RECONCILIATION PENDING";
      const resultNote=reconciled?"Balances have been freshly re-read and reconciled.":"Provider accepted the transfer, but the fresh balance read has not yet reconciled to the expected values. Do not submit another transfer.";
      const resultPage=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Founder Funding Result</title><body style="font-family:system-ui;background:#050a11;color:#eef7ff;padding:20px;max-width:720px;margin:auto"><h2>${resultTitle}</h2><div style="border:1px solid ${reconciled?'#2ca36b':'#d3a53a'};background:#0d1724;border-radius:14px;padding:18px"><p>TRANSFERRED: <b>$${amount.toFixed(2)}</b></p><p>INDEX 0: <b>$${post0.toFixed(2)}</b></p><p>INDEX 2: <b>$${post2.toFixed(2)}</b></p><p>TOTAL PREDICTIONS CASH: <b>$${postTotal.toFixed(2)}</b></p><p style="color:#91a6be">${resultNote}</p><a href="/founder-terminal" style="display:block;text-align:center;text-decoration:none;font-size:17px;font-weight:800;padding:13px 16px;border-radius:10px;border:1px solid #2c8ed6;background:#101b29;color:#8fd3ff">RETURN TO MARKET EDGE</a><details style="margin-top:18px;color:#91a6be"><summary>Diagnostic evidence</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#050a11;padding:12px;border-radius:10px;border:1px solid #26384d;color:#b9cbe0">${diagnosticHtml}</pre></details></div></body>`;
      return new Response(resultPage,{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});'''
if old not in s:
    raise SystemExit('success response anchor missing')
s=s.replace(old,new,1)
p.write_text(s)
