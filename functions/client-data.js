import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "./database.js";
import { createHash } from "node:crypto";

const denied = () => { throw new HttpsError("permission-denied", "Нет доступа"); };
const validPath = path => typeof path === "string" && /^(?:[a-zA-Z0-9_-]{1,160}\/)*[a-zA-Z0-9_-]{1,160}$/.test(path);

export async function clientData(user, operation, input) {
  if (!input || !validPath(input.path)) throw new HttpsError("invalid-argument", "Некорректный путь");
  const parts = input.path.split("/");
  const isDocument = parts.length % 2 === 0;
  const ownPreferences = input.path === `users/${user.uid}/preferences/seen`;
  const ownProfile = input.path === `users/${user.uid}`;
  const active = !user.banned && !!user.nick;
  const readable = (parts[0] === "users" && parts.length <= 2 && (active || ownProfile))
    || (ownPreferences && ["get", "set"].includes(operation))
    || (active && ["market", "nfts", "trades", "casino"].includes(parts[0]) && parts.length <= 2)
    || (active && input.path === "community/event");
  const adminReadable = user.isAdmin && (
    readable || (["users", "chats"].includes(parts[0]) && parts.length <= 2)
    || (parts[0] === "chats" && parts[2] === "messages" && parts.length <= 4));
  if (!readable && !adminReadable) denied();
  const db = getFirestore();
  const response = payload => {
    const version = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    return input.version === version ? { unchanged: true, version } : { ...payload, version };
  };
  const ref = isDocument ? db.doc(input.path) : db.collection(input.path);
  if (operation === "get") {
    if (isDocument) {
      const snap = await ref.get();
      return response({ path: ref.path, data: snap.data() ?? null });
    }
    let query = ref;
    if (!Array.isArray(input.constraints) || input.constraints.length > 8) denied();
    let maximum = 200;
    for (const constraint of input.constraints) {
      if (constraint.type === "where") {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(constraint.field ?? "")) denied();
        if (!["==", ">", ">=", "<", "<=", "array-contains"].includes(constraint.operator)) denied();
        query = query.where(constraint.field, constraint.operator, constraint.value);
      } else if (constraint.type === "orderBy") {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(constraint.field ?? "") || !["asc", "desc"].includes(constraint.direction)) denied();
        query = query.orderBy(constraint.field, constraint.direction);
      } else if (constraint.type === "limit") {
        if (!Number.isInteger(constraint.value) || constraint.value < 1 || constraint.value > 1000) denied();
        maximum = constraint.value;
      } else denied();
    }
    const snap = await query.limit(maximum).get();
    return response({ docs: snap.docs.map(doc => ({ path: doc.ref.path, data: doc.data() })) });
  }
  if (operation === "count" && !isDocument && user.isAdmin) {
    return (await ref.count().get()).data();
  }
  if (!isDocument) denied();
  if (operation === "set" && ownPreferences && active) {
    if (!input.data || Object.keys(input.data).some(key => key !== "chats")
      || !input.data.chats || Array.isArray(input.data.chats) || typeof input.data.chats !== "object") denied();
    await db.runTransaction(async tx => {
      const saved = (await tx.get(ref)).data() ?? {};
      const chats = input.merge ? { ...saved.chats, ...input.data.chats } : input.data.chats;
      if (Object.keys(chats).length > 500 || Object.values(chats).some(value => !Number.isFinite(value))) denied();
      tx.set(ref, { chats });
    });
    return null;
  }
  if (!user.isAdmin) denied();
  if (operation === "delete") {
    if (input.path === "users/admin_farnaz" || !["users", "chats"].includes(parts[0])) denied();
    if (parts[0] === "users") {
      await db.runTransaction(async tx => {
        const auctions = db.collection("auctions").where("status", "==", "open");
        const selling = await tx.get(auctions.where("sellerUid", "==", parts[1]).limit(1));
        const bidding = await tx.get(auctions.where("bidderUid", "==", parts[1]).limit(1));
        if (!selling.empty || !bidding.empty) throw new HttpsError("failed-precondition", "Сначала завершите аукционы пользователя");
        tx.delete(ref);
      });
      return null;
    }
    await ref.delete();
  } else if (operation === "update" && parts[0] === "users" && parts.length === 2) {
    if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) denied();
    const entries = Object.entries(input.data);
    if (entries.length !== 1) denied();
    const [field, value] = entries[0];
    if (field === "rank" && (!Number.isInteger(value) || value < 0 || value > 5)) denied();
    else if (field === "verified" && typeof value !== "boolean") denied();
    else if (field === "nickGradient" && !["", "sunset", "ocean", "aurora", "gold", "candy", "rainbow"].includes(value)) denied();
    else if (!["rank", "verified", "nickGradient"].includes(field)) denied();
    await ref.update(input.data);
  } else if (["set", "update"].includes(operation) && parts[0] === "market" && parts.length === 2) {
    if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) denied();
    if (operation === "set") await ref.set(input.data, { merge: !!input.merge });
    else await ref.update(input.data);
  } else denied();
  return null;
}
