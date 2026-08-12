#!/usr/bin/env node
// Abandoned-match self-test: `npm run verify:abandon-selftest`.
//
// One player closes the match mid-draft. The other must be TOLD, and must
// have a working way out.
//
// This is the scenario that produced the worst version of the online
// experience: cancel_match deletes the match row outright (nothing worth
// keeping is recorded until simulate-match writes a result), so to the
// remaining player's poll an opponent walking away looked identical to a
// network failure. They were shown "Lost contact with the match - it'll pick
// back up on its own" and left staring at a draft screen for a match that no
// longer existed.
//
// Runs against the local fake backend, so it costs nothing and can run on
// every build.

import { createServer } from "node:http"; import { readFile } from "node:fs/promises";
import path from "node:path"; import { chromium } from "playwright";
import { createFakeBackend } from "./fake-server.mjs";
const ROOT="/home/user/Gamebuild", SITE=8981, API=8982;
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"};
const site=createServer(async(req,res)=>{try{let r=decodeURIComponent(new URL(req.url,"http://x").pathname);
if(r.endsWith("/"))r+="index.html";const b=await readFile(path.join(ROOT,r));
res.writeHead(200,{"Content-Type":MIME[path.extname(r)]||"application/octet-stream"});res.end(b);}catch{res.writeHead(404).end("nf")}});
await new Promise(r=>site.listen(SITE,r));
const backend=createFakeBackend(); await backend.listen(API);
const apiUrl=`http://127.0.0.1:${API}/`;
const stub=await readFile(path.join(ROOT,"scripts/selftest/online-stub.js"),"utf8");
const accts=[{u:"LeaveA",id:"31111111-1111-4111-8111-111111111111"},{u:"LeaveB",id:"42222222-2222-4222-8222-222222222222"}];
for(const a of accts) await fetch(apiUrl,{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({kind:"register",userId:a.id,username:a.u})});
const br=await chromium.launch({headless:true});
const pages=[];
for(const a of accts){
  const ctx=await br.newContext({viewport:{width:1280,height:900}});
  await ctx.addInitScript(`window.__BK_API=${JSON.stringify(apiUrl)};window.__BK_USER_ID=${JSON.stringify(a.id)};window.__BK_USERNAME=${JSON.stringify(a.u)};`);
  await ctx.route("**/esm.sh/**",r=>r.fulfill({status:200,contentType:"text/javascript",body:stub}));
  const p=await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto(`http://127.0.0.1:${SITE}/`,{waitUntil:"domcontentloaded"});
  await p.locator("#screen-home:not(.hidden)").waitFor({timeout:20000});
  pages.push({p,ctx,errs});
}
// both queue -> matched with each other.
// The home screen is a SPORT HUB: the mode toggle only exists once a sport is
// chosen, so this sat on the hub clicking at a button that was not on the page
// yet and timed out. verify-browser hit the same thing and was fixed; this file
// was missed, and because it is not part of `npm run verify` nothing said so.
for(const {p} of pages){
  const sportRow = p.locator('[data-sport="nba"]').first();
  if(await sportRow.count()) await sportRow.click();
  await p.locator('#mode-toggle [data-mode="online"]').waitFor({state:"visible",timeout:15000});
  await p.locator('#mode-toggle [data-mode="online"]').click();
}
await Promise.all(pages.map(({p})=>p.locator("#btn-start-draft").click()));
await Promise.all(pages.map(({p})=>p.locator("#screen-draft:not(.hidden)").waitFor({timeout:60000})));
console.log("PASS  both players reached the draft");
// player B leaves
await pages[1].p.locator("#btn-leave-match").click();
await pages[1].p.locator("#screen-home:not(.hidden)").waitFor({timeout:15000});
console.log("PASS  leaver returned home");
// player A must be told, within a few poll ticks
const banner=pages[0].p.locator("#draft-turn-banner");
const told=await banner.filter({hasText:/opponent left/i}).waitFor({timeout:20000}).then(()=>true).catch(()=>false);
console.log((told?"PASS":"FAIL")+"  remaining player told the opponent left ->", (await banner.textContent()).trim());
const btn=pages[0].p.locator("#btn-leave-match");
console.log("      button label:", (await btn.textContent()).trim());
await btn.click();
const home=await pages[0].p.locator("#screen-home:not(.hidden)").waitFor({timeout:15000}).then(()=>true).catch(()=>false);
console.log((home?"PASS":"FAIL")+"  remaining player can get back home");
const allErrs=pages.flatMap(x=>x.errs);
console.log((allErrs.length?"FAIL":"PASS")+"  no JS errors", allErrs.join(" | "));
await br.close(); site.close(); backend.close();
process.exit(told&&home&&!allErrs.length?0:1);
