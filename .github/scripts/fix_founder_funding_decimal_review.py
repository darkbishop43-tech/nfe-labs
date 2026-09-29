from pathlib import Path

p=Path('market-edge-lab/real/baseline/src/index.js')
s=p.read_text()
old='''      const form=await request.formData().catch(()=>null);\n      const amount=Number(form?.get("amountUsd"));'''
new='''      const form=await request.formData().catch(()=>null);\n      const amountRaw=String(form?.get("amountUsd")??"").trim();\n      const amountMatch=/^(?:0|[1-9]\\d*)(?:\\.(\\d{1,2}))?$/.exec(amountRaw);\n      const amountCents=amountMatch?(Number(amountRaw.split(".")[0])*100+Number((amountMatch[1]||"").padEnd(2,"0"))):NaN;\n      const amount=Number.isInteger(amountCents)?amountCents/100:NaN;'''
if old not in s: raise SystemExit('review parse anchor missing')
s=s.replace(old,new,1)
old2='''      if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)!==amount*100) return json({ok:false,state:"TRANSFER_AMOUNT_INVALID",providerWrites:0,capitalMovedUsd:0},400);'''
new2='''      if(!Number.isInteger(amountCents)||amountCents<=0) return json({ok:false,state:"TRANSFER_AMOUNT_INVALID",providerWrites:0,capitalMovedUsd:0},400);'''
if old2 not in s: raise SystemExit('review validation anchor missing')
s=s.replace(old2,new2,1)
p.write_text(s)
