import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:3000";
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
  { name: "wide", width: 1920, height: 1080 },
];
// Tabs in the dashboard nav.
const TABS = ["management", "workload", "projects", "monitoring", "inspections", "cleaning", "entry", "audit"];

const browser = await chromium.launch();
let problems = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });

  for (const tab of TABS) {
    // Click the nav button whose text loosely matches the tab.
    const btn = page.getByRole("button").filter({ hasText: new RegExp(tab, "i") }).first();
    if (await btn.count()) { try { await btn.click({ timeout: 1500 }); } catch {} }
    await page.waitForTimeout(250);

    const res = await page.evaluate(() => {
      const de = document.documentElement;
      const docOverflow = de.scrollWidth - de.clientWidth;
      const vw = window.innerWidth;
      const offenders = [];
      for (const el of document.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // element extends past the right edge of the viewport
        if (r.right > vw + 1) {
          const sw = el.scrollWidth, cw = el.clientWidth;
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className && el.className.toString().slice(0, 40)) || "",
            right: Math.round(r.right),
            overflowsContent: sw > cw + 1,
            text: (el.textContent || "").trim().slice(0, 40),
          });
        }
      }
      // de-dup by tag+cls, keep widest
      const seen = new Map();
      for (const o of offenders) {
        const k = o.tag + "|" + o.cls;
        if (!seen.has(k) || o.right > seen.get(k).right) seen.set(k, o);
      }
      return { docOverflow, vw, offenders: [...seen.values()].sort((a, b) => b.right - a.right).slice(0, 8) };
    });

    const flag = res.docOverflow > 1;
    if (flag) problems++;
    console.log(`[${vp.name} ${vp.width}px] tab=${tab} docScrollOverflow=${res.docOverflow}px ${flag ? "⚠ HORIZONTAL SCROLL" : "ok"}`);
    if (flag || res.offenders.length) {
      for (const o of res.offenders) {
        console.log(`    <${o.tag} class="${o.cls}"> right=${o.right} (vw=${res.vw}) contentClipped=${o.overflowsContent} "${o.text}"`);
      }
    }
  }
  await ctx.close();
}

await browser.close();
console.log(problems ? `\nFAIL: ${problems} viewport/tab combos overflow horizontally` : "\nPASS: no page-level horizontal overflow on any tab/viewport");
