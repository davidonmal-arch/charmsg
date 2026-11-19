import { randomInt } from "node:crypto";
import { getFirestore } from "./database.js";
import { NFT_EFFECTS } from "./operations.js";

export async function releaseNfts(user, { name, description, photos, count, price, upgradePrice }) {
  const title = typeof name === "string" ? name.trim() : "";
  if (title.length < 2 || title.length > 60) throw new Error("Название должно содержать 2–60 символов");
  if (!Array.isArray(photos) || photos.length < 2 || photos.length > 20 ||
      photos.some((photo) => typeof photo !== "string" || photo.length > 120_000 ||
        !/^(https:\/\/\S{1,2040}|data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/.test(photo))) {
    throw new Error("Добавьте 2–20 фото. Используйте HTTPS-ссылки или изображения до 120 КБ после сжатия.");
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw new Error("Тираж должен быть от 1 до 50");
  for (const cost of [price, upgradePrice]) {
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > 100_000) throw new Error("Цена должна быть от 1 до 100 000 CR");
  }
  const db = getFirestore();
  const series = db.collection("nftSeries").doc();
  const batch = db.batch();
  batch.create(series, { photos });
  const now = Date.now();
  for (let copy = 0; copy < count; copy++) {
    batch.create(db.collection("nfts").doc(), {
      name: title, description: String(description || "").slice(0, 500), image: photos[0],
      ownerUid: user.uid, ownerNick: user.nick, createdBy: user.uid, createdByNick: user.nick,
      effect: "none", seriesId: series.id, upgradePrice, upgraded: false,
      forSale: true, price, lastPrice: 0, soldAt: 0, history: [], createdAt: now, updatedAt: now
    });
  }
  await batch.commit();
  return { count };
}

export async function enhanceNft(uid, id) {
  const db = getFirestore();
  const nftRef = db.collection("nfts").doc(id);
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const nft = (await tx.get(nftRef)).data();
    const user = (await tx.get(userRef)).data();
    if (!user || user.banned || nft?.ownerUid !== uid) throw new Error("Улучшить NFT может только владелец");
    if (!nft.seriesId || nft.upgraded) throw new Error("Эту копию нельзя улучшить");
    if (nft.tradeOfferId) throw new Error("Сначала отмените оффер с этим NFT");
    const price = nft.upgradePrice;
    if (!Number.isSafeInteger(price) || price < 1 || price > 100_000 || !(user.coins >= price)) {
      throw new Error("Недостаточно CR для улучшения");
    }
    const photos = (await tx.get(db.collection("nftSeries").doc(nft.seriesId))).data()?.photos;
    if (!photos?.length) throw new Error("Варианты этой серии недоступны");
    let number, reservation;
    for (let attempt = 0; attempt < 8; attempt++) {
      number = randomInt(1, 1_000_000_000);
      reservation = db.collection("nftNumbers").doc(String(number));
      if (!(await tx.get(reservation)).exists) break;
      reservation = null;
    }
    if (!reservation) throw new Error("Не удалось выбрать номер. Попробуйте ещё раз.");
    const effect = NFT_EFFECTS[randomInt(1, NFT_EFFECTS.length)].key;
    tx.create(reservation, { nftId: id });
    tx.update(userRef, { coins: Math.round((user.coins - price) * 100) / 100 });
    tx.update(nftRef, {
      upgraded: true, image: photos[randomInt(photos.length)], effect, number,
      forSale: false, price: 0, updatedAt: Date.now()
    });
    return { number, effect, price };
  });
}
