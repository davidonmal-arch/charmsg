import { clearQuota, reportQuota } from "./quota.js?v=instant-20261119";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { apiOrigin, firebaseConfig } from "./firebase-config.js?v=instant-20261119";

import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const local = ["localhost", "127.0.0.1"].includes(location.hostname)
  && new URLSearchParams(location.search).has("emulator");
const config = local ? { ...firebaseConfig, projectId: "demo-charmsg", apiKey: "charmsg-emulator" } : firebaseConfig;
const playerApp = initializeApp(config);
const adminApp = initializeApp(config, "administrator");
export const adminAuth = getAuth(adminApp);
const playerAuth = getAuth(playerApp);
export const auth = localStorage.getItem("charmsg_admin_mode") ? adminAuth : playerAuth;
export const app = auth.app;
export const db = Object.freeze({});
const functions = getFunctions(app, local ? undefined : apiOrigin || undefined);
if (local) {
  connectAuthEmulator(playerAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectAuthEmulator(adminAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

const browserId = localStorage.getItem("charmsg_browser_id") || crypto.randomUUID();
localStorage.setItem("charmsg_browser_id", browserId);

const action = httpsCallable(functions, "charmsgAction", { timeout: 105_000 });
const nftChanges = new Set(["buyNft", "giftNft", "createNft", "deleteNft", "setNftSale", "enhanceNft", "releaseNfts", "setFeaturedNft", "createOffer", "acceptOffer", "cancelOffer", "playUpgrade"]);
const accountChanges = new Set(["trade", "claimDailyReward", "claimQuest", "claimEvent", "claimSetupRewards", "manageBusiness", "updateProfile", "setUsername", "changeClan", "spinRoulette", "playChance", "playClicker", "adminBanUser", "adminUnbanUser"]);
export async function runAction(name, ...args) {
  const startedAt = Date.now();
  try {
    const result = (await action({ action: name, args, browserId })).data;
    clearQuota(startedAt);
    let collections = nftChanges.has(name) ? ["nfts", "users", "trades", "casino"]
      : accountChanges.has(name) ? ["users", "market", "trades", "casino"] : [];
    if (name === "adminSetPrice") collections = ["market"];
    if (["quickSell", "createAuction", "bidAuction", "listAuctions"].includes(name)) collections = ["nfts", "users", "trades"];
    if (name === "clientData" && ["set", "update", "delete"].includes(args[0]) && args[1]?.path?.split("/").length === 2) {
      collections = [args[1].path.split("/")[0]];
    }
    if (collections.length) window.dispatchEvent(new CustomEvent("charmsg:data-change", { detail: { collections } }));
    return result;
  } catch (error) {
    reportQuota(error);
    if (error.details?.kind === "network-ban" && name !== "checkAccess") window.dispatchEvent(new Event("charmsg:network-ban"));
    throw error;
  }
}

export { EmailAuthProvider, linkWithCredential, signInAnonymously, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

export { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit, getCountFromServer } from "./client-data.js?v=instant-20261119";
