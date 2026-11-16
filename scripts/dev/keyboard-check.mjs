// Keyboard smoke check of the workflow map. node scripts/dev/keyboard-check.mjs <intent-workflow-url>
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(process.argv[2], { waitUntil: "load" });
await p.waitForSelector(".node");
await p.focus(".node");
const label = () => p.evaluate(() => document.activeElement?.getAttribute("aria-label"));
console.log("focus:", await label());
await p.keyboard.press("ArrowRight"); console.log("→", await label());
await p.keyboard.press("End"); console.log("End", await label());
await p.keyboard.press("Enter"); await p.waitForTimeout(400);
console.log("panel:", await p.locator(".stage-panel h2").textContent(), "| url:", p.url().split("#")[1]);
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
console.log("panel after Esc:", await p.locator(".stage-panel").count());
await p.focus('[role="tab"][aria-selected="true"]'); await p.keyboard.press("ArrowRight"); await p.waitForTimeout(400);
console.log("tab after →:", p.url().split("#")[1]);
await b.close();
