import { getAdminSession } from "./store.js";

export const state = {
  uid: null,
  profile: null,
  users: new Map(),
  chats: [],
  market: null,
  trades: [],
  route: "chats",
  admin: false,
  activeChatId: null,
  booted: false,
  listeners: new Set()
};

export function onChange(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

let notifyScheduled = false;
export function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const fn of [...state.listeners]) {
      try {
        fn();
      } catch (err) {
        console.error("state listener failed", err);
      }
    }
  });
}

export function userOf(uid) {
  return state.users.get(uid) || null;
}

export function isAdminView() {
  return !!getAdminSession();
}

export function displayName(uid, fallback) {
  const user = userOf(uid);
  return user?.nick || fallback || "Аноним";
}
