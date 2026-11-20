import { getFirestore } from "./database.js";
import { nftResaleLimit, ADMIN_UID } from "./operations.js";
const cents = value => {
  if (!Number.isFinite(value) || value < 1 || value > 1e9 || Math.round(value*100)/100 !== value) throw new Error("Цена: от 1 CR, максимум два знака после запятой");
  return Math.round(value*100);
};
const key = value => { if(typeof value!=="string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value))throw new Error("Некорректный идентификатор");return value; };
export function buybackPrice(nft) {
  if(nft.createdBy!==ADMIN_UID || !(nft.lastPrice>0))return 0;
  return Math.floor(Math.min(nft.lastPrice, nft.history?.find(item=>item.price>0)?.price || nft.lastPrice,100)*50)/100;
}
export async function quickSell(user,id,expectedPrice){
 const db=getFirestore();id=key(id);
 return db.runTransaction(async tx=>{
  const ref=db.doc("nfts/"+id),profile=db.doc("users/"+user.uid);
  const nft=(await tx.get(ref)).data(),account=(await tx.get(profile)).data();
  if(!account||account.banned||nft?.ownerUid!==user.uid||nft.tradeOfferId||nft.auctionId)throw new Error("Подарок недоступен для продажи");
  const price=buybackPrice(nft);if(!price||price!==expectedPrice)throw new Error("Цена выкупа изменилась или выкуп недоступен");
  const now=Date.now(),resale=Math.round(price*150)/100;
  tx.update(profile,{coins:Math.round((account.coins+price)*100)/100,...(account.featuredNftId===id?{featuredNftId:null}:{})});
  tx.update(ref,{ownerUid:"system_charmsg",ownerNick:"CharMsg",forSale:true,price:resale,lastPrice:price,updatedAt:now,
    history:[...(nft.history||[]).slice(-99),{uid:"system_charmsg",nick:"CharMsg",price,ts:now,via:"buyback"}]});
  tx.create(db.collection("trades").doc(),{uid:user.uid,nick:user.nick,isNft:true,nftId:id,nftName:nft.name,side:"sell",amountCr:price,amountChr:0,price,ts:now,via:"buyback"});
  return {price,resale};
 });
}
export async function createAuction(user,input){
 const db=getFirestore(),id=key(input?.nftId),start=cents(input.startPrice);
 if(![1,6,24].includes(input.hours))throw new Error("Выберите 1, 6 или 24 часа");
 const auction=db.collection("auctions").doc();
 return db.runTransaction(async tx=>{
  const ref=db.doc("nfts/"+id),nft=(await tx.get(ref)).data();
  if(nft?.ownerUid!==user.uid||nft.tradeOfferId||nft.auctionId)throw new Error("Подарок уже занят или принадлежит другому игроку");
  if(start>nftResaleLimit(nft)*100)throw new Error("Начальная цена выше лимита 3×");
  const now=Date.now();
  tx.create(auction,{sellerUid:user.uid,sellerNick:user.nick,nftId:id,name:nft.name,image:nft.image,effect:nft.effect,status:"open",startCents:start,bidCents:0,bidderUid:null,capCents:Math.round(nftResaleLimit(nft)*100),endsAt:now+input.hours*3600000,createdAt:now});
  tx.update(ref,{auctionId:auction.id,ownerUid:"auction_escrow",ownerNick:"На аукционе",forSale:false,price:0});
  return {id:auction.id};
 });
}
export async function bidAuction(user,id,amount){
 const db=getFirestore();id=key(id);const bid=cents(amount);
 return db.runTransaction(async tx=>{
  const ref=db.doc("auctions/"+id),a=(await tx.get(ref)).data(),buyerRef=db.doc("users/"+user.uid),buyer=(await tx.get(buyerRef)).data();
  if(!a||a.status!=="open"||a.endsAt<=Date.now())throw new Error("Аукцион завершён. Обновите список");
  if(a.sellerUid===user.uid||a.bidderUid===user.uid)throw new Error("Нельзя перебивать собственную ставку");
  if(bid<Math.max(a.startCents,a.bidCents+100)||bid>a.capCents)throw new Error("Ставка должна быть выше текущей минимум на 1 CR и не превышать лимит 3×");
  if(!buyer||buyer.banned||Math.round(buyer.coins*100)<bid)throw new Error("Недостаточно CR");
  const previous=a.bidderUid?db.doc("users/"+a.bidderUid):null,previousData=previous?(await tx.get(previous)).data():null;
  if(previous&&!previousData)throw new Error("Профиль предыдущего участника недоступен");
  tx.update(buyerRef,{coins:Math.round((buyer.coins-bid/100)*100)/100});
  if(previous)tx.update(previous,{coins:Math.round((previousData.coins+a.bidCents/100)*100)/100});
  tx.update(ref,{bidCents:bid,bidderUid:user.uid,bidderNick:user.nick});
  return {ok:true};
 });
}
export async function settleAuction(id){
 const db=getFirestore();return db.runTransaction(async tx=>{
  const ref=db.doc("auctions/"+key(id)),a=(await tx.get(ref)).data();if(!a||a.status!=="open"||a.endsAt>Date.now())return;
  const nftRef=db.doc("nfts/"+a.nftId),nft=(await tx.get(nftRef)).data(),sellerRef=db.doc("users/"+a.sellerUid),seller=(await tx.get(sellerRef)).data();
  if(!nft||nft.auctionId!==id||!seller)throw new Error("Не удалось завершить аукцион: обратитесь к администратору");
  const buyer=a.bidderUid?(await tx.get(db.doc("users/"+a.bidderUid))).data():null;
  if(a.bidderUid&&!buyer)throw new Error("Профиль победителя недоступен");
  const now=Date.now(),price=a.bidCents/100;
  if(buyer)tx.update(sellerRef,{coins:Math.round((seller.coins+price)*100)/100});
  tx.update(nftRef,{auctionId:null,ownerUid:a.bidderUid||a.sellerUid,ownerNick:buyer?.nick||seller.nick,forSale:false,price:0,
   ...(buyer?{lastPrice:price,soldAt:now,history:[...(nft.history||[]).slice(-99),{uid:a.bidderUid,nick:buyer.nick,price,ts:now,via:"auction"}]}:{}),updatedAt:now});
  tx.update(ref,{status:buyer?"sold":"expired",settledAt:now});
 });
}
export async function listAuctions(){
 const db=getFirestore(),expired=await db.collection("auctions").where("status","==","open").where("endsAt","<=",Date.now()).limit(50).get();
 for(const doc of expired.docs)await settleAuction(doc.id);
 const rows=await db.collection("auctions").orderBy("createdAt","desc").limit(100).get();
 return rows.docs.map(doc=>({id:doc.id,...doc.data()}));
}
