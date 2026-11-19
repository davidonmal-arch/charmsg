import { auth, runAction } from "./db.js";

const reference = (parent, segments, kind) => ({
  path: [parent?.path, ...segments].filter(Boolean).join("/"),
  kind,
  constraints: []
});
export const collection = (parent, ...segments) => reference(parent, segments, "collection");
export const doc = (parent, ...segments) => reference(parent, segments, "document");
export const where = (field, operator, value) => ({ type: "where", field, operator, value });
export const orderBy = (field, direction = "asc") => ({ type: "orderBy", field, direction });
export const limit = value => ({ type: "limit", value });
export const query = (ref, ...constraints) => ({ ...ref, constraints: [...ref.constraints, ...constraints] });
const cachedReads = new WeakMap();
async function request(operation, ref, extra) {
  const uid = auth.currentUser?.uid;
  const saved = cachedReads.get(ref);
  const previous = operation === "get" && saved?.uid === uid ? saved.value : null;
  const value = await runAction("clientData", operation, {
    path: ref.path, constraints: ref.constraints,
    ...(previous ? { version: previous.version } : {}), ...extra
  });
  if (value?.unchanged) return previous;
  if (operation === "get") cachedReads.set(ref, { uid, value });
  return value;
}
function snapshot(value) {
  const ref = { path: value.path, kind: "document", constraints: [] };
  return { ref, id: value.path.split("/").at(-1), exists: () => value.data !== null,
    data: () => value.data ?? undefined, metadata: { fromCache: false } };
}
export const getDoc = async ref => snapshot(await request("get", ref));
export async function getDocs(ref) {
  const result = await request("get", ref);
  const docs = result.docs.map(snapshot);
  return { docs, size: docs.length, empty: docs.length === 0, forEach: callback => docs.forEach(callback) };
}
export const setDoc = (ref, data, options) => request("set", ref, { data, merge: !!options?.merge });
export const updateDoc = (ref, data) => request("update", ref, { data });
export const deleteDoc = ref => request("delete", ref);
export const getCountFromServer = async ref => {
  const value = await request("count", ref);
  return { data: () => value };
};
export function onSnapshot(ref, ...args) {
  if (typeof args[0] !== "function") args.shift();
  const [callback, onError] = args;
  let stopped = false;
  let timer;
  let previous;
  const poll = async () => {
    try {
      const result = await (ref.kind === "document" ? getDoc(ref) : getDocs(ref));
      const serialized = JSON.stringify(ref.kind === "document" ? result.data() : result.docs.map(doc => [doc.id, doc.data()]));
      if (!stopped && serialized !== previous) {
        previous = serialized;
        callback(result);
      }
    } catch (error) { if (!stopped) onError?.(error); }
    if (!stopped) timer = setTimeout(poll, document.hidden ? 60_000 : 15_000);
  };
  poll();
  return () => { stopped = true; clearTimeout(timer); };
}
