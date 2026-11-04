const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const d of fs.readdirSync('out').sort()) {
    const dir = path.join('out', d, 'project', 'slides');
    for (const f of fs.readdirSync(dir).sort()) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8').replace(/<aside>[\s\S]*<\/aside>/, '');
      await p.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400..900&family=Bitter:wght@400..800&display=swap" rel="stylesheet"><style>*{margin:0;box-sizing:border-box}section{width:1920px;height:1080px;position:relative;overflow:hidden}</style></head><body>${html}</body></html>`, { waitUntil: 'load' }).catch(()=>{});
      const r = await p.evaluate(() => {
        const s = document.querySelector('section'); const out = [];
        for (const el of s.querySelectorAll('div,table,h2,h1,p,ul')) {
          if (getComputedStyle(el).position === 'absolute') continue;
          if (el.scrollHeight > el.clientHeight + 2 && el.tagName === 'DIV') out.push('overflow ' + (el.querySelector('h3')?.textContent || el.tagName));
          const bt = el.getBoundingClientRect().bottom; if (bt > 935) out.push('bottom ' + Math.round(bt) + ' ' + (el.querySelector('h3')?.textContent || el.tagName));
        }
        return [...new Set(out)].slice(0, 3);
      });
      if (r.length) console.log(d, f, r.join(' | '));
    }
  }
  await b.close();
})();
