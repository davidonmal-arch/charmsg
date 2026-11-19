import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
const source=await readFile(new URL("../js/app.js",import.meta.url),"utf8");
const render=source.match(/function renderRoute\(\) \{[\s\S]*?\r?\n\}/)?.[0];
assert.ok(render);
let mounts=0;
const mount=()=>{mounts++;return()=>{};};
const context={
 state:{route:"nfts",profile:{banned:false}},location:{hash:"#/nfts?filter=mine"},
 renderedHash:"#/nfts",cleanupView:()=>{},routes:{nfts:mount,offers:mount,chats:mount},
 currentRoute:()=>context.location.hash.replace(/^#\//,"").split("?")[0],
 updateNav(){},notify(){},viewEl:{innerHTML:""},window:{scrollTo(){}},URLSearchParams,console
};
runInNewContext(render+"\nrenderRoute(); renderRoute();",context);
assert.equal(mounts,1);
context.location.hash="#/offers?offer=first";
runInNewContext("renderRoute()",context);
context.location.hash="#/offers?offer=second";
runInNewContext("renderRoute()",context);
assert.equal(mounts,3);
context.state.route="chats";context.location.hash="#/chats?chat=next";
runInNewContext("renderRoute()",context);
assert.equal(mounts,3);
assert.equal(context.state.activeChatId,"next");
console.log("Navigation checks passed: NFT filters and offer links update within the same section; chat selection preserves its view.");
