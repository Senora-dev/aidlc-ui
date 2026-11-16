import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto(process.argv[2], { waitUntil: "load" }); await p.waitForTimeout(1500);
console.log(await p.evaluate(() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > W + 1).slice(0, 8).map(e => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right)); }));
await b.close();
