const { chromium } = require('playwright'); const fs=require('fs');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
 for (const f of process.argv.slice(2)) { const html = fs.readFileSync(f,'utf8').replace(/<aside>[\s\S]*<\/aside>/,'');
  await p.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400..900&family=Bitter:wght@400..800&display=swap" rel="stylesheet"><style>*{margin:0;box-sizing:border-box}section{width:1920px;height:1080px;position:relative;overflow:hidden}</style></head><body>${html}</body></html>`,{waitUntil:'networkidle'}).catch(()=>{});
  const fam = await p.evaluate(()=>document.fonts.check('24px "Golos Text"'));
  await p.screenshot({ path: 'shots/' + f.replace(/\//g,'_') + '.png' }); console.log(f, 'golos', fam); }
 await b.close(); })();
