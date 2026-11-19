import assert from "node:assert/strict";
import { getFirestore } from "./database.js";

assert.ok(process.env.DATABASE_URL);
const db = getFirestore();
const ref = db.doc("migrationChecks/" + crypto.randomUUID());
try {
  await ref.create({ balance: 100, nested: { a: 1, b: 2 }, tags: ["test"] });
  await ref.set({ nested: { a: 3 } }, { merge: true });
  assert.deepEqual((await ref.get()).data().nested, { a: 3, b: 2 });
  await Promise.all(Array.from({ length: 5 }, () => db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    tx.update(ref, { balance: snap.data().balance - 1 });
  })));
  assert.equal((await ref.get()).data().balance, 95);
  const { clientData } = await import("./client-data.js");
  assert.ok((await db.collection("migrationChecks").where("tags", "array-contains", "test").get()).docs.some(doc => doc.id === ref.id));
  await assert.rejects(db.runTransaction(async tx => { tx.update(ref, { balance: 0 }); throw new Error("rollback"); }));
  assert.equal((await ref.get()).data().balance, 95);
  const player = { uid: "test", nick: "test", banned: false };
  const visible = db.doc("nfts/" + crypto.randomUUID());
  try {
    await visible.create({ name: "Snapshot version test" });
    const first = await clientData(player, "get", { path: visible.path });
    assert.equal(first.data.name, "Snapshot version test");
    assert.deepEqual(await clientData(player, "get", { path: visible.path, version: first.version }), { unchanged: true, version: first.version });
    await visible.update({ name: "Updated" });
    const updated = await clientData(player, "get", { path: visible.path, version: first.version });
    assert.equal(updated.data.name, "Updated");
    assert.notEqual(updated.version, first.version);
  } finally { await visible.delete(); }
  for (const path of ["users/other/private/login", "pushSubscriptions", "moderation/networkBans", "chats/private/messages"]) {
    await assert.rejects(clientData(player, "get", { path, constraints: [] }), error => error.code === "permission-denied");
  }
  await assert.rejects(clientData(player, "update", { path: "users/test", data: { coins: 1000 } }), error => error.code === "permission-denied");
  console.log("PostgreSQL merge, queries, concurrent balances, rollback and access checks passed.");
} finally {
  await ref.delete();
  await db.sql.end();
}
