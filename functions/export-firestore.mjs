import { open, unlink } from "node:fs/promises";
import { applicationDefault, cert } from "firebase-admin/app";

const [project, destination] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]+$/.test(project ?? "") || !destination) {
  throw new Error("Usage: node functions/export-firestore.mjs <project> <new-backup-file>");
}

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const account = process.env.CHARMSG_SERVICE_ACCOUNT;
const credentials = account ? JSON.parse(account) : null;
if (credentials && credentials.project_id !== project) throw new Error("Firebase project mismatch");
const accessToken = emulator ? null : process.env.CHARMSG_FIRESTORE_ACCESS_TOKEN;
const credential = emulator || accessToken ? null : credentials ? cert(credentials) : applicationDefault();
const origin = emulator ? `http://${emulator}` : "https://firestore.googleapis.com";
const root = `projects/${project}/databases/(default)/documents`;
// shortcut: Firestore permits historical reads for one hour, so use a managed snapshot if export outgrows that window.
const readTime = new Date(Date.now() - 3000).toISOString();

async function request(path, query, body) {
  const url = new URL(`/v1/${path}`, origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const headers = { "Content-Type": "application/json" };
  if (accessToken || credential) {
    headers.Authorization = `Bearer ${accessToken || (await credential.getAccessToken()).access_token}`;
  }
  const response = await fetch(url, {
    headers,
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Firestore export failed: HTTP ${response.status} ${result.error?.status ?? ""}`);
  return result;
}

async function* pages(fetchPage, field) {
  let pageToken;
  do {
    const page = await fetchPage(pageToken);
    yield* page[field] ?? [];
    pageToken = page.nextPageToken;
  } while (pageToken);
}

async function* documents(parent) {
  const collections = pages((pageToken) =>
    request(`${parent}:listCollectionIds`, null, { pageSize: 100, pageToken, readTime }), "collectionIds");
  for await (const collection of collections) {
    const entries = pages((pageToken) =>
      request(`${parent}/${encodeURIComponent(collection)}`, { pageSize: 100, pageToken, readTime, showMissing: true }), "documents");
    for await (const entry of entries) {
      if (entry.updateTime) yield entry;
      const child = entry.name.split("/").map(encodeURIComponent).join("/");
      yield* documents(child);
    }
  }
}

const output = await open(destination, "wx", 0o600);
let count = 0;
try {
  await output.writeFile(JSON.stringify({ project, readTime }) + "\n");
  for await (const document of documents(root)) {
    await output.writeFile(JSON.stringify(document) + "\n");
    count++;
  }
  await output.sync();
} catch (error) {
  await output.close();
  await unlink(destination);
  throw error;
}
await output.close();
console.log(`Exported ${count} documents at ${readTime}`);
