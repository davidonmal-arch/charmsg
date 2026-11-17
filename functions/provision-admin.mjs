import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId = process.argv[2];
const password = process.env.CHARMSG_ADMIN_PASSWORD;
if (!projectId || !password || password.length < 16) {
  throw new Error("Укажите ID проекта и новый пароль длиной от 16 символов в CHARMSG_ADMIN_PASSWORD");
}
if (process.env.FIREBASE_AUTH_EMULATOR_HOST && !projectId.startsWith("demo-")) {
  throw new Error("С эмулятором используйте demo-проект");
}
initializeApp({ projectId });
const auth = getAuth();
const uid = "admin_farnaz";
const email = "farnaz@charmsg.invalid";
const existing = await auth.getUser(uid).catch((error) => {
  if (error.code === "auth/user-not-found") return null;
  throw error;
});
if (existing) {
  await auth.updateUser(uid, { email, password });
  await auth.revokeRefreshTokens(uid);
} else {
  await auth.createUser({ uid, email, password });
}
await auth.setCustomUserClaims(uid, { ...existing?.customClaims, admin: true });
console.log("Firebase Auth admin configured");
