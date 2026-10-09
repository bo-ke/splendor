const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 760, height: 760 } });
await p.goto('file://' + process.argv[2]); await p.screenshot({ path: process.argv[3], fullPage: true }); await b.close(); })();
