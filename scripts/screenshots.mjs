#!/usr/bin/env node
// Capture UI screenshots with a locally installed Chrome (playwright-core, no browser download).
//   node scripts/screenshots.mjs <base-url> <out-dir> [--routes routes.json] [--scheme dark|light]
// Routes are hash routes relative to <base-url>. Each is captured at desktop and narrow widths.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const [base, out, ...rest] = process.argv.slice(2);
if (!base || !out) {
  console.error("usage: screenshots.mjs <base-url> <out-dir> [--routes file.json] [--scheme dark|light] [--only desktop|narrow]");
  process.exit(2);
}
const opt = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const routes = opt("--routes") ? JSON.parse(readFileSync(opt("--routes"), "utf8")) : [{ name: "home", hash: "#/" }];
const schemes = opt("--scheme") ? [opt("--scheme")] : ["light", "dark"];
const sizes = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "narrow", width: 390, height: 844 },
].filter((s) => !opt("--only") || s.id === opt("--only"));

const candidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error("No Chrome/Chromium found. Set CHROME_PATH.");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const problems = [];
for (const scheme of schemes) {
  for (const size of sizes) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, deviceScaleFactor: 2, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("console", (m) => m.type() === "error" && problems.push(`[console] ${m.text()}`));
    page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
    for (const r of routes) {
      await page.goto(new URL(r.hash, base).toString(), { waitUntil: "load" });
      await page.waitForTimeout(r.wait ?? 1200);
      for (const step of r.steps ?? []) {
        if (step.click) await page.click(step.click);
        if (step.press) await page.keyboard.press(step.press);
        await page.waitForTimeout(step.wait ?? 300);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      // Horizontal overflow check (a frequent narrow-width bug).
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`[overflow] ${r.name} ${size.id} ${scheme}: ${overflow}px horizontal scroll`);
      const file = path.join(out, `${r.name}-${size.id}-${scheme}.png`);
      await page.screenshot({ path: file, fullPage: r.fullPage ?? size.id === "desktop" });
      console.log(file);
    }
    await ctx.close();
  }
}
await browser.close();
if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log("  " + p);
}
