from pathlib import Path
p=Path('market-edge-lab/real/baseline/founder-terminal.html')
s=p.read_text()
needle='<script src="./progress-analytics.js"></script>'
if needle not in s:
    s=s.replace('</body>',needle+'\n</body>',1)
p.write_text(s)
print('PROGRESS_INCLUDE_PATCHED=YES')
