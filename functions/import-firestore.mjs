import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { getFirestore } from "./database.js";

const filename = process.argv[2];
if (!filename || !process.env.DATABASE_URL) {
  throw new Error("A backup file and DATABASE_URL are required");
}
const records = (await readFile(filename, "utf8")).trim().split("\n").map(JSON.parse);
const header = records.shift();
assert.equal(header.project, process.env.GCLOUD_PROJECT);

function value(field) {
  if ("nullValue" in field) return null;
  if ("booleanValue" in field) return field.booleanValue;
  if ("integerValue" in field) {
    const number = Number(field.integerValue);
    assert.ok(Number.isSafeInteger(number), "Integer precision would be lost");
    return number;
  }
  if ("doubleValue" in field) {
    assert.ok(Number.isFinite(field.doubleValue));
    return field.doubleValue;
  }
  if ("stringValue" in field) return field.stringValue;
  if ("arrayValue" in field) return (field.arrayValue.values ?? []).map(value);
  if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields ?? {}).map(([key, entry]) => [key, value(entry)]));
  throw new Error("Unsupported Firestore value type");
}
const db = getFirestore();
try {
  await db.sql.query(await readFile(new URL("./postgres.sql", import.meta.url), "utf8"));
  const documents = records.map(record => {
    const prefix = `projects/${header.project}/databases/(default)/documents/`;
    assert.ok(record.name.startsWith(prefix));
    return { path: record.name.slice(prefix.length), data: value({ mapValue: { fields: record.fields } }) };
  });
  assert.equal(new Set(documents.map(doc => doc.path)).size, documents.length);
  await db.sql.query(
    "INSERT INTO charmsg.documents(path,parent,data) SELECT path, regexp_replace(path, '/[^/]+$', ''), data FROM jsonb_to_recordset($1::jsonb) AS docs(path text,data jsonb)",
    [JSON.stringify(documents)]);
  const imported = await db.sql.query("SELECT path,data FROM charmsg.documents WHERE path = ANY($1::text[])", [documents.map(doc => doc.path)]);
  const byPath = new Map(imported.rows.map(doc => [doc.path, doc.data]));
  for (const expected of documents) assert.deepEqual(byPath.get(expected.path), expected.data);
  console.log(`Imported and verified ${documents.length} documents.`);
} finally { await db.sql.end(); }
