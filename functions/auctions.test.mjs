import assert from 'node:assert/strict';
import {getFirestore} from './database.js';
import {withActivity} from './activity.js';
import * as auctions from './auctions.js';
assert.ok(process.env.NEON_BRANCH?.startsWith('migration-test-'),'Test branch required');
const db=getFirestore(),suffix=crypto.randomUUID().replaceAll('-',''),paths=[],ids=[];
const seller={uid:'auction_s_'+suffix,nick:'Seller'},a={uid:'auction_a_'+suffix,nick:'A'},b={uid:'auction_b_'+suffix,nick:'B'};
async function seed(path,data){paths.push(path);await db.doc(path).create(data)}
const call=(name,user,...args)=>withActivity(user.uid,name,()=>auctions[name](user,...args));
const balance=async user=>(await db.doc('users/'+user.uid).get()).data().coins;
try{
 for(const user of [seller,a,b])await seed('users/'+user.uid,{...user,coins:100,banned:false});
 const id='auction_n_'+suffix;await seed('nfts/'+id,{name:'Gift',ownerUid:seller.uid,createdBy:'admin_farnaz',lastPrice:20,history:[{price:20}],forSale:false});
 assert.equal(auctions.buybackPrice({createdBy:a.uid,lastPrice:100}),0);
 const result=await call('createAuction',seller,{nftId:id,startPrice:5,hours:1});ids.push(result.id);
 await assert.rejects(()=>call('quickSell',seller,id,10));
 await call('bidAuction',a,result.id,5);assert.equal(await balance(a),95);
 await assert.rejects(()=>call('bidAuction',seller,result.id,6));
 await call('bidAuction',b,result.id,6);assert.equal(await balance(a),100);assert.equal(await balance(b),94);
 await assert.rejects(()=>call('bidAuction',a,result.id,5));
 await db.doc('auctions/'+result.id).update({endsAt:Date.now()-1});
 await auctions.settleAuction(result.id);await auctions.settleAuction(result.id);
 assert.equal(await balance(seller),106);assert.equal((await db.doc('nfts/'+id).get()).data().ownerUid,b.uid);
 const sold=await call('quickSell',b,id,3);assert.equal(sold.price,3);assert.equal(sold.resale,4.5);assert.equal(await balance(b),97);
 assert.equal((await db.doc('nfts/'+id).get()).data().ownerUid,'system_charmsg');
 await assert.rejects(()=>call('quickSell',b,id,3));
 console.log('Auction checks passed: custody, bids, refunds, ownership, exactly-once settlement, buyback and resale.');
}finally{
 for(const id of ids)await db.doc('auctions/'+id).delete();
 const trades=await db.collection('trades').where('nftId','==','auction_n_'+suffix).get();for(const doc of trades.docs)await doc.ref.delete();
 for(const path of paths.reverse())await db.doc(path).delete();await db.terminate();
}
