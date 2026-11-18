import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateVAPIDKeys } from "web-push";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const project = "demo-charmsg";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
initializeApp({ projectId: project });
const db = getFirestore();
const auth = getAuth();
const authBase = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:";
const callable = "http://127.0.0.1:5002/charmsgAction";
const origin = "https://davidonmal-arch.github.io";
const server = spawn(process.execPath, [fileURLToPath(new URL("./server.js", import.meta.url))], {
  env: { ...process.env, GCLOUD_PROJECT: project, PORT: "5002", CHARMSG_WEB_ORIGIN: origin, CHARMSG_VAPID: JSON.stringify(generateVAPIDKeys()) },
  stdio: "inherit"
});
server.unref();
process.on("exit", () => server.kill());
for (let attempt = 0; attempt < 40; attempt++) {
  if (await fetch("http://127.0.0.1:5002/healthz").then((response) => response.ok, () => false)) break;
  assert.equal(server.exitCode, null, "Standalone API exited");
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const preflight = await fetch(callable, {
  method: "OPTIONS",
  headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" }
});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
const headers = (token) => ({ "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) });
const uid = (session) => session.localId;

async function login(method, body = {}) {
  const result = await fetch(authBase + method + "?key=local", {
    method: "POST", headers: headers(), body: JSON.stringify({ ...body, returnSecureToken: true })
  });
  const json = await result.json();
  assert.ok(result.ok, JSON.stringify(json));
  return json;
}

async function invoke(session, action, ...args) {
  const response = await fetch(callable, {
    method: "POST", headers: headers(session?.idToken), body: JSON.stringify({ data: { action, args } })
  });
  const json = await response.json();
  if (!response.ok) throw Object.assign(new Error(json.error?.message), { status: json.error?.status });
  return json.result;
}

async function direct(session, path, method = "GET", fields) {
  return fetch("http://127.0.0.1:8080/v1/projects/" + project + "/databases/(default)/documents/" + path, {
    method, headers: headers(session?.idToken), body: fields ? JSON.stringify({ fields }) : undefined
  });
}

const users = db.collection("users");
const nfts = db.collection("nfts");
const profile = (session) => users.doc(uid(session)).get().then((snap) => snap.data());
const reject = (promise, status) => assert.rejects(promise, (error) => error.status === status);
const alice = await login("signUp");
const bob = await login("signUp");
const suffix = Date.now().toString(36);
await invoke(alice, "createProfile", { nick: "Alice" + suffix });
await invoke(bob, "createProfile", { nick: "Bob" + suffix });
await reject(invoke(alice, "createProfile", { nick: "New" + suffix }), "ALREADY_EXISTS");
await reject(invoke(null, "listPastes"), "UNAUTHENTICATED");

const credentials = { email: "farnaz@charmsg.invalid", password: "emulator-only-password" };
await auth.createUser({ uid: "admin_farnaz", ...credentials });
await auth.setCustomUserClaims("admin_farnaz", { admin: true });
const admin = await login("signInWithPassword", credentials);
await invoke(admin, "ensureAdminProfile");
await reject(invoke(alice, "ensureAdminProfile"), "PERMISSION_DENIED");
assert.equal((await direct(alice, "users/" + uid(alice), "PATCH", { rank: { integerValue: "5" } })).status, 403);
assert.equal((await direct(alice, "users/" + uid(bob), "PATCH", { coins: { integerValue: "999" } })).status, 403);
assert.equal((await direct(alice, "config/admin")).status, 403);

const elevated = await direct(admin, "users/" + uid(alice) + "?updateMask.fieldPaths=rank", "PATCH", { rank: { integerValue: "3" } });
assert.equal(elevated.status, 200);
const paste = await invoke(alice, "createPaste", { title: "Rank check", minRank: 5, published: true });
assert.equal((await db.collection("pastes").doc(paste).get()).data().minRank, 3);
assert.ok(!(await invoke(bob, "listPastes")).some((item) => item.id === paste));
assert.equal((await direct(bob, "pastes/" + paste)).status, 403);
await reject(invoke(bob, "savePaste", paste, { title: "Changed" }), "PERMISSION_DENIED");
await invoke(alice, "setPasteEditors", paste, [uid(bob)]);
await reject(invoke(bob, "setPastePublished", paste, false), "PERMISSION_DENIED");
await invoke(bob, "savePaste", paste, { title: "Editor updated", minRank: 0, published: false });
const edited = (await db.collection("pastes").doc(paste).get()).data();
assert.equal(edited.minRank, 3);
assert.equal(edited.published, true);
assert.equal(edited.title, "Editor updated");

const dm = await invoke(alice, "openDM", uid(bob));
const message = await invoke(alice, "sendMessage", dm, "Only participants");
assert.equal((await invoke(bob, "listMessages", dm))[0].text, "Only participants");
const charlie = await login("signUp");
await invoke(charlie, "createProfile", { nick: "Cat" + suffix });
await reject(invoke(charlie, "listMessages", dm), "PERMISSION_DENIED");
assert.equal((await direct(charlie, "chats/" + dm + "/messages/" + message.id)).status, 403);
await db.collection("chats").doc(dm).collection("messages").doc(message.id).update({ expiresAt: Date.now() - 1 });
assert.deepEqual(await invoke(bob, "listMessages", dm), []);
const club = await invoke(admin, "createPublicChat", { name: "Club" });
await db.collection("chats").doc(club).update({ verifiedOnly: true });
await reject(invoke(bob, "listMessages", club), "PERMISSION_DENIED");
await users.doc(uid(bob)).update({ verified: true });
await invoke(bob, "sendMessage", club, "Verified");

for (const [betType, betValue, multiplier] of [["red", null, 2], ["black", null, 2], ["number", 0, 36]]) {
  const before = (await profile(alice)).coins;
  const result = await invoke(alice, "spinRoulette", { betType, betValue, amount: 1, result: 0, payout: 1000 });
  assert.ok(result.result >= 0 && result.result <= 36);
  assert.equal(result.win, betType === "number" ? result.result === betValue : result.color === betType);
  assert.equal(result.payout, result.win ? multiplier : 0);
  assert.equal((await profile(alice)).coins, before - 1 + result.payout);
}
await reject(invoke(alice, "spinRoulette", { betType: "number", betValue: 37, amount: 1 }), "FAILED_PRECONDITION");
await reject(invoke(alice, "playUpgrade", { stakeType: "cr", stakeAmount: 1, targetType: "cr", targetAmount: 100 }), "FAILED_PRECONDITION");

for (const stakeType of ["cr", "nft"]) {
  for (const targetType of ["cr", "nft"]) {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const stakeNftId = stakeType === "nft" ? await invoke(alice, "createNft", { name: "Stake", image, price: 500 }) : "";
    const targetNftId = targetType === "nft" ? await invoke(admin, "createNft", { name: "Target", image, price: 2 }) : "";
    const before = (await profile(alice)).coins;
    const result = await invoke(alice, "playUpgrade", { stakeType, stakeNftId, stakeAmount: 1, targetType, targetNftId, targetAmount: 2 });
    assert.equal(result.chance, 0.5);
    assert.equal((await profile(alice)).coins, before - Number(stakeType === "cr") + (targetType === "cr" && result.win ? 2 : 0));
    if (stakeNftId) assert.equal((await nfts.doc(stakeNftId).get()).data().ownerUid, "system_charmsg");
    if (targetNftId) assert.equal((await nfts.doc(targetNftId).get()).data().ownerUid, result.win ? uid(alice) : uid(admin));
  }
}

const mintImage = "data:image/png;base64,iVBORw0KGgo=";
const adminStake = await invoke(admin, "createNft", { name: "Admin valuation", image: mintImage, adminStakeCr: 25 });
assert.equal((await nfts.doc(adminStake).get()).data().adminStakeCr, 25);
const customUpgrade = await invoke(admin, "playUpgrade", { stakeType: "nft", stakeNftId: adminStake, targetType: "cr", targetAmount: 500 });
assert.equal(customUpgrade.stakeValue, 25);
assert.equal(customUpgrade.chance, 0.05);
const regularStake = await invoke(alice, "createNft", { name: "Regular valuation", image: mintImage, adminStakeCr: 25 });
assert.equal((await nfts.doc(regularStake).get()).data().adminStakeCr, undefined);
await reject(invoke(alice, "playUpgrade", { stakeType: "nft", stakeNftId: regularStake, targetType: "cr", targetAmount: 51 }), "FAILED_PRECONDITION");

const numbered = await invoke(alice, "createNft", { name: "Numbered", image: mintImage, number: 42, effect: "rainbow", price: 1 });
const numberedDoc = (await nfts.doc(numbered).get()).data();
assert.equal(numberedDoc.number, 42);
assert.equal(numberedDoc.effect, "rainbow");
await reject(invoke(admin, "createNft", { name: "Duplicate", image: mintImage, number: 42 }), "FAILED_PRECONDITION");
await reject(invoke(bob, "setFeaturedNft", numbered), "PERMISSION_DENIED");
await invoke(alice, "setFeaturedNft", numbered);
assert.equal((await profile(alice)).featuredNftId, numbered);
await invoke(bob, "buyNft", numbered);
await reject(invoke(alice, "setFeaturedNft", numbered), "PERMISSION_DENIED");
await invoke(bob, "setFeaturedNft", numbered);
assert.equal((await profile(bob)).featuredNftId, numbered);
await invoke(bob, "setFeaturedNft", null);
assert.equal((await profile(bob)).featuredNftId, null);

const endpoint = "https://fcm.googleapis.com/fcm/send/test-device";
const keys = { auth: "a".repeat(22), p256dh: "a".repeat(87) };
assert.equal((await invoke(bob, "pushPublicKey")).length, 87);
await reject(invoke(bob, "subscribeToPush", { endpoint: "https://localhost/path", keys }), "INVALID_ARGUMENT");
await invoke(bob, "subscribeToPush", { endpoint, keys });
const registered = await db.collection("pushSubscriptions").where("uid", "==", uid(bob)).get();
assert.equal(registered.size, 1);
assert.equal((await direct(bob, "pushSubscriptions/" + registered.docs[0].id)).status, 403);
await invoke(alice, "unsubscribeFromPush", endpoint);
assert.ok((await registered.docs[0].ref.get()).exists);
await invoke(bob, "unsubscribeFromPush", endpoint);
assert.ok(!(await registered.docs[0].ref.get()).exists);

const reason = "Manual moderation";
const image = "data:image/png;base64,iVBORw0KGgo=";
await reject(invoke(alice, "adminBanUser", uid(bob), { reason, duration: 1, unit: "minutes", image }), "PERMISSION_DENIED");
const ban = await invoke(admin, "adminBanUser", uid(bob), { reason, duration: 1, unit: "minutes", image });
assert.equal(ban.banUntil - ban.banAt, 60_000);
assert.equal((await profile(bob)).banReason, reason);
assert.equal((await profile(bob)).banImage, image);
assert.equal(await invoke(bob, "expireBanIfNeeded"), false);
await reject(invoke(bob, "listPastes"), "PERMISSION_DENIED");
await reject(invoke(bob, "spinRoulette", { betType: "red", amount: 1 }), "PERMISSION_DENIED");
await users.doc(uid(bob)).update({ banUntil: Date.now() - 1 });
assert.equal(await invoke(bob, "expireBanIfNeeded"), true);
assert.ok(Array.isArray(await invoke(bob, "listPastes")));
console.log("Integration checks passed: identity, roles, paste visibility, chats, roulette, all upgrade combinations, and manual bans.");

await db.terminate();
server.kill();
