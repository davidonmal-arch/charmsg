import { clearQuota, reportQuota } from "./quota.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { apiOrigin, firebaseConfig } from "./firebase-config.js";

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
export async function runAction(name, ...args) {
  const startedAt = Date.now();
  try {
    const result = (await action({ action: name, args, browserId })).data;
    clearQuota(startedAt);
    return result;
  } catch (error) {
    reportQuota(error);
    if (error.details?.kind === "network-ban" && name !== "checkAccess") window.dispatchEvent(new Event("charmsg:network-ban"));
    throw error;
  }
}

export { EmailAuthProvider, linkWithCredential, signInAnonymously, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

export { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit, getCountFromServer } from "./client-data.js";
