import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "./database.js";

assert.ok(process.env.NEON_BRANCH?.startsWith("migration-test-"));
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,"127.0.0.1:9099");
initializeApp({projectId:"demo-charmsg"});
const db=getFirestore(), paths=[], suffix=crypto.randomUUID().replaceAll("-","");
const server=spawn(process.execPath,[fileURLToPath(new URL("./server.js",import.meta.url))],{
  env:{...process.env,PORT:"5013",GCLOUD_PROJECT:"demo-charmsg"},stdio:"inherit"
});
server.unref();
process.on("exit",()=>server.kill());
const headers=token=>({"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})});
async function login(method,body={}){
 const r=await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:"+method+"?key=test",{method:"POST",headers:headers(),body:JSON.stringify({...body,returnSecureToken:true})});
 const result=await r.json();assert.ok(r.ok,"Emulator sign-in failed");return result;
}
async function invoke(session,action,...args){
 const r=await fetch("http://127.0.0.1:5013/charmsgAction",{method:"POST",headers:headers(session.idToken),body:JSON.stringify({data:{action,args}})});
 const result=await r.json();
 if(!r.ok)throw Object.assign(new Error(result.error?.message),{status:result.error?.status});
 return result.result;
}
try{
 for(let i=0;i<50;i++){
  if(await fetch("http://127.0.0.1:5013/healthz").then(r=>r.ok,()=>false))break;
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 const credentials={email:"farnaz@charmsg.invalid",password:"local-series-test-password"};
 await getAuth().createUser({uid:"admin_farnaz",...credentials});
 await getAuth().setCustomUserClaims("admin_farnaz",{admin:true});
 const admin=await login("signInWithPassword",credentials);
 await invoke(admin,"ensureAdminProfile");
 const player=await login("signUp");
 await invoke(player,"createProfile",{nick:"Series"+suffix.slice(0,10)});
 paths.push("users/"+player.localId);
 const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
 const photos=Array.from({length:20},(_,index)=>"data:image/png;base64,"+png+"A".repeat(118000)+Buffer.from(String(index)).toString("base64"));
 const input={name:"Variants"+suffix,description:"Large upload test",photos,count:1,price:1,upgradePrice:1};
 assert.ok(Buffer.byteLength(JSON.stringify(input))>2*1024*1024);
 await assert.rejects(invoke(player,"releaseNfts",input),error=>error.status==="PERMISSION_DENIED");
 const result=await invoke(admin,"releaseNfts",input);
 assert.equal(result.count,1);
 const copies=await db.collection("nfts").where("name","==",input.name).get();
 assert.equal(copies.size,1);
 const ref=copies.docs[0].ref, nft=copies.docs[0].data();
 paths.push(ref.path,"nftSeries/"+nft.seriesId);
 assert.equal((await db.doc("nftSeries/"+nft.seriesId).get()).data().photos.length,20);
 await ref.update({ ownerUid: player.localId, ownerNick: "Series player", lastPrice: 0, forSale: false });
 await assert.rejects(invoke(admin,"enhanceNft",ref.id));

 const improved=await invoke(player,"enhanceNft",ref.id);
 paths.push("nftNumbers/"+improved.number);
 assert.ok(photos.includes((await ref.get()).data().image));
 await assert.rejects(invoke(player,"enhanceNft",ref.id));
 const collection=(await invoke(player,"collectionStatus")).find(item=>item.id===nft.seriesId);
 assert.equal(collection.variants.length,20);
 await assert.rejects(invoke(admin,"releaseNfts",{...input,photos:[...photos,photos[0]]}),error=>error.status==="FAILED_PRECONDITION");
 await assert.rejects(invoke(admin,"releaseNfts",{...input,photos:[photos[0]]}),error=>error.status==="FAILED_PRECONDITION");
 assert.equal((await db.collection("nfts").where("name","==",input.name).get()).size,1);
 console.log("Series API checks passed: 20 variants, upload larger than 2 MiB, zero-purchase-price ownership, owner-only and one-time enhancement, collection progress, 1/21 variant rejection and owner-only release.");
}finally{
 for(const path of paths.reverse())await db.doc(path).delete();
 await db.terminate();server.kill();
}
