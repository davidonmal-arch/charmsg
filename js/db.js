import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
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
export const db = getFirestore(app);
const functions = getFunctions(app);
if (local) {
  connectAuthEmulator(playerAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectAuthEmulator(adminAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

const action = httpsCallable(functions, "charmsgAction");
export async function runAction(name, ...args) {
  return (await action({ action: name, args })).data;
}

export { EmailAuthProvider, linkWithCredential, signInAnonymously, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  runTransaction,
  writeBatch,
  increment,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
