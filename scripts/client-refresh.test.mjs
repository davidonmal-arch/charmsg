import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
const code=(await readFile(new URL("../js/client-data.js",import.meta.url),"utf8")).replace(/^import[^\n]*\n/,"").replace(/^export /gm,"");
const target=new EventTarget(), timers=new Map();
let calls=0, resolveFirst, nextTimer=0, values=[];
const first=new Promise(resolve=>{resolveFirst=resolve;});
const sandbox={
 auth:{currentUser:{uid:"player"}},window:target,document:{hidden:false},console,
 setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},
 clearTimeout(id){timers.delete(id);},
 runAction:async()=>{calls++;return calls===1?first:{docs:[{path:"nfts/one",data:{ownerUid:"player"}}],version:"new"};}
};
runInNewContext(code+"\nglobalThis.api={collection,onSnapshot};",sandbox);
const stop=sandbox.api.onSnapshot(sandbox.api.collection({},"nfts"),snapshot=>values.push(snapshot.docs[0]?.data().ownerUid));
function invalidate(collection){const event=new Event("charmsg:data-change");event.detail={collections:[collection]};target.dispatchEvent(event);}
invalidate("nfts");invalidate("nfts");
assert.equal(calls,1);
resolveFirst({docs:[{path:"nfts/one",data:{ownerUid:"other"}}],version:"old"});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls,2);
assert.deepEqual(values,["other","player"]);
invalidate("users");
assert.equal(calls,2);
stop();
invalidate("nfts");
assert.equal(calls,2);
assert.equal(timers.size,0);
sandbox.auth.currentUser = null;
const initial = [];
const initialErrors = [];
const stopInitial = sandbox.api.onSnapshot(sandbox.api.collection({}, "nfts"), snapshot => initial.push(snapshot.size), error => initialErrors.push(error));
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(initial, [1]);
assert.equal(initialErrors.length, 0);
stopInitial();
assert.equal(timers.size, 0);
console.log("Immediate refresh checks passed: scoped updates, serialized requests, coalesced invalidations and unsubscribe cleanup.");
