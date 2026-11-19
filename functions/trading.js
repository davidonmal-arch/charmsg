import { getFirestore } from "./database.js";

const key = value => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error("Некорректный идентификатор");
  return value;
};
function ids(value) {
  if (!Array.isArray(value) || value.length > 5 || new Set(value).size !== value.length) throw new Error("Выберите до пяти разных NFT");
  return value.map(key);
}
function amount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000
    || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) throw new Error("Сумма должна быть от 0 до 100 000 CR, до двух знаков после запятой");
  return Math.round(value * 100) / 100;
}
const round = value => Math.round(value * 100) / 100;

export async function createOffer(user, input) {
  const giveIds = ids(input?.giveIds), takeIds = ids(input?.takeIds);
  const giveCr = amount(input.giveCr), takeCr = amount(input.takeCr);
  if ((!giveIds.length && !giveCr) || (!takeIds.length && !takeCr)) throw new Error("Укажите, что отдаёте и что хотите получить");
  if (giveIds.some(id => takeIds.includes(id))) throw new Error("NFT не может быть с обеих сторон обмена");
  const db = getFirestore(), ref = db.collection("offers").doc(key(input.requestId));
  await db.runTransaction(async tx => {
    const existing = (await tx.get(ref)).data();
    if (existing) {
      if (existing.creatorUid !== user.uid || existing.giveCr !== giveCr || existing.takeCr !== takeCr
        || JSON.stringify(existing.give.map(nft => nft.id)) !== JSON.stringify(giveIds)
        || JSON.stringify(existing.take.map(nft => nft.id)) !== JSON.stringify(takeIds)) throw new Error("Этот идентификатор уже использован другим оффером");
      return;
    }
    const accountRef = db.doc("users/" + user.uid);
    const account = (await tx.get(accountRef)).data();
    if (!account || account.banned || account.coins < giveCr) throw new Error("Недостаточно CR или аккаунт заблокирован");
    const active = await tx.get(db.collection("offers").where("creatorUid", "==", user.uid).where("status", "==", "open").limit(20));
    if (active.size >= 20) throw new Error("Можно держать до 20 открытых офферов");
    const give = [], take = [];
    for (const id of [...giveIds, ...takeIds]) {
      const nft = (await tx.get(db.doc("nfts/" + id))).data();
      if (!nft || nft.tradeOfferId) throw new Error("NFT не найден или уже зарезервирован");
      const offered = giveIds.includes(id);
      if (offered ? nft.ownerUid !== user.uid : !nft.ownerUid || nft.ownerUid === user.uid) throw new Error("Проверьте владельцев NFT");
      (offered ? give : take).push({ id, name: nft.name || "NFT", ownerUid: nft.ownerUid, number: nft.number ?? null });
    }
    if (new Set(take.map(nft => nft.ownerUid)).size > 1) throw new Error("Запрашиваемые NFT должны принадлежать одному игроку");
    tx.update(accountRef, { coins: round(account.coins - giveCr) });
    for (const id of giveIds) tx.update(db.doc("nfts/" + id), { tradeOfferId: ref.id, forSale: false, price: 0 });
    tx.create(ref, {
      creatorUid: user.uid, creatorNick: account.nick, give, take, giveCr, takeCr,
      status: "open", createdAt: Date.now(), updatedAt: Date.now()
    });
  });
  return ref.id;
}

export async function cancelOffer(user, offerId) {
  const db = getFirestore(), ref = db.doc("offers/" + key(offerId));
  return db.runTransaction(async tx => {
    const offer = (await tx.get(ref)).data();
    if (!offer || (offer.creatorUid !== user.uid && !user.isAdmin)) throw new Error("Нет доступа к офферу");
    if (offer.status !== "open") return { status: offer.status };
    const owner = db.doc("users/" + offer.creatorUid), profile = (await tx.get(owner)).data();
    if (!profile) throw new Error("Профиль автора не найден");
    for (const nft of offer.give) {
      const current = (await tx.get(db.doc("nfts/" + nft.id))).data();
      if (current?.tradeOfferId !== offerId || current.ownerUid !== offer.creatorUid) throw new Error("Резерв NFT повреждён");
    }
    tx.update(owner, { coins: round(profile.coins + offer.giveCr) });
    for (const nft of offer.give) tx.update(db.doc("nfts/" + nft.id), { tradeOfferId: null });
    tx.update(ref, { status: "cancelled", updatedAt: Date.now() });
    return { status: "cancelled" };
  });
}

export async function acceptOffer(user, offerId) {
  const db = getFirestore(), ref = db.doc("offers/" + key(offerId));
  return db.runTransaction(async tx => {
    const offer = (await tx.get(ref)).data();
    if (!offer || offer.status !== "open") throw new Error("Оффер уже закрыт");
    if (offer.creatorUid === user.uid) throw new Error("Нельзя принять собственный оффер");
    const creatorRef = db.doc("users/" + offer.creatorUid), takerRef = db.doc("users/" + user.uid);
    const creator = (await tx.get(creatorRef)).data(), taker = (await tx.get(takerRef)).data();
    if (!creator || !taker || creator.banned || taker.banned) throw new Error("Участник обмена заблокирован");
    if (taker.coins < offer.takeCr) throw new Error("Недостаточно CR");
    const items = [];
    for (const nft of [...offer.give, ...offer.take]) {
      const current = (await tx.get(db.doc("nfts/" + nft.id))).data();
      const offered = offer.give.some(item => item.id === nft.id);
      if (!current || current.ownerUid !== (offered ? offer.creatorUid : user.uid)
        || (offered ? current.tradeOfferId !== offerId : !!current.tradeOfferId || current.forSale)) {
        throw new Error("NFT сменил владельца, зарезервирован или выставлен на продажу");
      }
      items.push({ id: nft.id, current, recipient: offered ? taker : creator, recipientUid: offered ? user.uid : offer.creatorUid });
    }
    const now = Date.now();
    tx.update(creatorRef, { coins: round(creator.coins + offer.takeCr), tradeCount: (creator.tradeCount || 0) + 1 });
    tx.update(takerRef, { coins: round(taker.coins - offer.takeCr + offer.giveCr), tradeCount: (taker.tradeCount || 0) + 1 });
    for (const { id, current, recipient, recipientUid } of items) tx.update(db.doc("nfts/" + id), {
      ownerUid: recipientUid, ownerNick: recipient.nick, tradeOfferId: null, forSale: false, price: 0,
      updatedAt: now, history: [...(current.history || []), { uid: recipientUid, nick: recipient.nick, price: 0, ts: now, offerId }].slice(-100)
    });
    tx.update(ref, { status: "accepted", acceptorUid: user.uid, acceptorNick: taker.nick, updatedAt: now });
    return { status: "accepted" };
  });
}

export async function listOffers(user, mode = "open", cursor = null) {
  if (!["open", "mine"].includes(mode) || (cursor !== null && (!Number.isSafeInteger(cursor?.time) || cursor.time < 0))) throw new Error("Некорректный фильтр");
  const values = [mode === "mine" ? user.uid : "open"];
  let condition = mode === "mine" ? "(data->>'creatorUid'=$1 OR data->>'acceptorUid'=$1)" : "data->>'status'=$1";
  if (cursor !== null) { values.push(cursor.time, "offers/" + key(cursor.id)); condition += " AND ((data->>'createdAt')::bigint,path) < ($2::bigint,$3::text)"; }
  const { rows } = await getFirestore().sql.query(
    "SELECT path,data FROM charmsg.documents WHERE parent='offers' AND " + condition + " ORDER BY (data->>'createdAt')::bigint DESC,path DESC LIMIT 51", values);
  const page = rows.slice(0, 50);
  return { offers: page.map(row => ({ ...row.data, id: row.path.split("/").at(-1) })), next: rows.length > 50
    ? { time: page.at(-1).data.createdAt, id: page.at(-1).path.split("/").at(-1) } : null };
}

const quests = [
  { id: "username", title: "Выбери юзернейм", description: "Установи юзернейм в профиле.", reward: 20 },
  { id: "collector", title: "Первый NFT", description: "Получи хотя бы один NFT.", reward: 30 },
  { id: "trader", title: "Первый обмен", description: "Заверши обмен через офферы.", reward: 50 }
];
export async function questStatus(user) {
  const db = getFirestore();
  const profile = (await db.doc("users/" + user.uid).get()).data();
  const owned = await db.collection("nfts").where("ownerUid", "==", user.uid).limit(1).get();
  const saved = (await db.doc("users/" + user.uid + "/private/quests").get()).data() || {};
  const ready = { username: !!profile.username, collector: !owned.empty, trader: profile.tradeCount > 0 };
  return quests.map(quest => ({ ...quest, ready: ready[quest.id], claimed: !!saved[quest.id] }));
}
export async function claimQuest(user, questId) {
  const quest = quests.find(quest => quest.id === questId);
  if (!quest) throw new Error("Квест не найден");
  const db = getFirestore();
  return db.runTransaction(async tx => {
    const ref = db.doc("users/" + user.uid), savedRef = db.doc("users/" + user.uid + "/private/quests");
    const profile = (await tx.get(ref)).data(), saved = (await tx.get(savedRef)).data() || {};
    if (saved[questId]) return { alreadyClaimed: true };
    let ready = questId === "username" ? !!profile.username : profile.tradeCount > 0;
    if (questId === "collector") ready = !(await tx.get(db.collection("nfts").where("ownerUid", "==", user.uid).limit(1))).empty;
    if (!ready || profile.banned) throw new Error("Условия квеста ещё не выполнены");
    tx.update(ref, { coins: round(profile.coins + quest.reward) });
    tx.set(savedRef, { [questId]: Date.now() }, { merge: true });
    return { reward: quest.reward };
  });
}

export async function listActivity(user, admin = false, cursor = null) {
  if (typeof admin !== "boolean" || (admin && !user.isAdmin)) throw new Error("Нет доступа к журналу администрации");
  if (cursor !== null && (typeof cursor !== "string" || !/^\d{1,20}$/.test(cursor))) throw new Error("Некорректная страница");
  const values = [], conditions = [];
  if (!admin) {
    values.push(user.uid, "users/" + user.uid);
    conditions.push("(actor_uid=$1 OR document_path=$2 OR old_value->>'ownerUid'=$1 OR new_value->>'ownerUid'=$1)");
  }
  if (cursor !== null) { values.push(cursor); conditions.push("id < $" + values.length + "::bigint"); }
  const { rows } = await getFirestore().sql.query(
    "SELECT id, extract(epoch FROM created_at)*1000 AS ts, actor_uid, action, document_path, old_value, new_value FROM charmsg.activity"
    + (conditions.length ? " WHERE " + conditions.join(" AND ") : "") + " ORDER BY id DESC LIMIT 51", values);
  return { entries: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null };
}

export async function collectionStatus(user) {
  const db = getFirestore(), owned = await db.collection("nfts").where("ownerUid", "==", user.uid).get();
  const series = await db.collection("nftSeries").get();
  const previews = await db.sql.query("SELECT data->>'seriesId' AS series_id, min(data->>'name') AS name FROM charmsg.documents WHERE parent='nfts' AND data ? 'seriesId' GROUP BY data->>'seriesId'");
  return series.docs.map(group => {
    const definition = group.data(), item = previews.rows.find(row => row.series_id === group.id);
    const mine = owned.docs.map(doc => doc.data()).filter(nft => nft.seriesId === group.id);
    const photos = Array.isArray(definition.photos) ? definition.photos : [];
    return { id: group.id, name: item?.name || "Коллекция NFT", copies: mine.length, variants: photos.map((image, index) => ({
      index: index + 1, image, owned: mine.some(nft => nft.image === image && nft.upgraded)
    })) };
  });
}
