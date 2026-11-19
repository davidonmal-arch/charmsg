import { randomUUID } from "node:crypto";
import { getFirestore as firebaseDatabase } from "firebase-admin/firestore";
import { Pool, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { activityContext } from "./activity.js";

neonConfig.webSocketConstructor = process.env.HTTPS_PROXY
  ? class extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { agent: new HttpsProxyAgent(process.env.HTTPS_PROXY) });
    }
  } : WebSocket;
let database;
export function getFirestore() {
  if (!process.env.DATABASE_URL) return firebaseDatabase();
  if (!new URL(process.env.DATABASE_URL).hostname.endsWith(".neon.tech")) throw new Error("Expected a Neon database");
  if (!database) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 15000 });
    pool.on("error", error => console.error("Database connection error", error.code || "unknown"));
    database = new Database(connection(pool));
  }
  return database;
}

function connection(sql, inTransaction = false) {
  return {
    query: (text, values) => {
      if (!inTransaction && activityContext.getStore() && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) {
        return connection(sql).transaction(client => client.query(text, values));
      }
      return sql.query(text, values);
    },
    async transaction(callback) {
      const client = await sql.connect();
      const onError = () => {};
      client.on("error", onError);
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '20s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
        const actor = activityContext.getStore();
        if (actor) await client.query("SELECT set_config('charmsg.actor',$1,true), set_config('charmsg.action',$2,true)", [actor.uid, actor.action]);
        const result = await callback(connection(client, true));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.removeListener("error", onError);
        client.release();
      }
    },
    end: () => sql.end()
  };
}

class Snapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = data !== undefined;
    this.value = data;
  }
  data() { return this.value; }
}

class Query {
  constructor(database, path, filters = [], ordering = [], maximum) {
    this.database = database;
    this.path = path;
    this.filters = filters;
    this.ordering = ordering;
    this.maximum = maximum;
  }
  doc(id = randomUUID().replaceAll("-", "")) {
    return this.database.doc(this.path + "/" + id);
  }
  async add(data) {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
  where(field, operator, value) {
    return new Query(this.database, this.path, [...this.filters, [field, operator, value]], this.ordering, this.maximum);
  }
  orderBy(field, direction = "asc") {
    if (!["asc", "desc"].includes(direction)) throw new Error("Invalid direction");
    return new Query(this.database, this.path, this.filters, [...this.ordering, [field, direction]], this.maximum);
  }
  limit(maximum) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error("Invalid limit");
    return new Query(this.database, this.path, this.filters, this.ordering, maximum);
  }
  count() {
    return { get: () => this.get(true) };
  }
  async get(count = false) {
    const values = [this.path];
    const parameter = (value) => { values.push(value); return "$" + values.length; };
    const conditions = ["parent = $1"];
    for (const [field, operator, value] of this.filters) {
      const expression = "data #> " + parameter(field.split(".")) + "::text[]";
      const operand = parameter(JSON.stringify(value)) + "::jsonb";
      if (operator === "array-contains") conditions.push(expression + " @> jsonb_build_array(" + operand + ")");
      else {
        const sqlOperator = { "==": "=", ">": ">", ">=": ">=", "<": "<", "<=": "<=" }[operator];
        if (!sqlOperator) throw new Error("Unsupported query operator");
        conditions.push(expression + " " + sqlOperator + " " + operand);
      }
    }
    const ordering = this.ordering.map(([field, direction]) =>
      "(data #> " + parameter(field.split(".")) + "::text[]) " + direction);
    const sql = "SELECT path, data FROM charmsg.documents WHERE " + conditions.join(" AND ")
      + (ordering.length ? " ORDER BY " + ordering.join(", ") : " ORDER BY path")
      + (this.maximum ? " LIMIT " + parameter(this.maximum) : "");
    const result = await this.database.sql.query(count ? "SELECT count(*)::integer AS count FROM (" + sql + ") matching" : sql, values);
    if (count) return { data: () => ({ count: result.rows[0].count }) };
    const docs = result.rows.map(row => new Snapshot(this.database.doc(row.path), row.data));
    return { docs, size: docs.length, empty: docs.length === 0, forEach: callback => docs.forEach(callback) };
  }
}

class Document {
  constructor(database, path) {
    this.database = database;
    this.path = path;
    this.id = path.split("/").at(-1);
  }
  collection(name) { return this.database.collection(this.path + "/" + name); }
  async get() {
    const { rows } = await this.database.sql.query("SELECT data FROM charmsg.documents WHERE path = $1", [this.path]);
    return new Snapshot(this, rows[0]?.data);
  }
  async set(data, options) {
    const payload = JSON.stringify(data);
    const expression = options?.merge ? "charmsg.merge_json(documents.data, EXCLUDED.data)" : "EXCLUDED.data";
    await this.database.sql.query(
      "INSERT INTO charmsg.documents(path, parent, data) VALUES ($1, $2, $3::jsonb) "
      + "ON CONFLICT(path) DO UPDATE SET data = " + expression,
      [this.path, this.path.split("/").slice(0, -1).join("/"), payload]);
  }
  async create(data) {
    await this.database.sql.query("INSERT INTO charmsg.documents(path,parent,data) VALUES ($1,$2,$3::jsonb)",
      [this.path, this.path.split("/").slice(0, -1).join("/"), JSON.stringify(data)]);
  }
  async update(patch) {
    const keys = Object.keys(patch);
    let expression = "data";
    const values = [this.path];
    for (const key of keys) {
      values.push(key.split("."), JSON.stringify(patch[key]));
      expression = "jsonb_set(" + expression + ", $" + (values.length - 1) + "::text[], $" + values.length + "::jsonb, true)";
    }
    const result = await this.database.sql.query("UPDATE charmsg.documents SET data = " + expression + " WHERE path = $1", values);
    if (!result.rowCount) throw new Error("Document does not exist");
  }
  async delete() {
    await this.database.sql.query("DELETE FROM charmsg.documents WHERE path = $1", [this.path]);
  }
}

class Database {
  constructor(sql) { this.sql = sql; }
  terminate() { return this.sql.end(); }
  doc(path) { return new Document(this, path); }
  collection(path) { return new Query(this, path); }
  async recursiveDelete(ref) {
    await this.sql.query("DELETE FROM charmsg.documents WHERE path = $1 OR starts_with(path,$2)", [ref.path, ref.path + "/"]);
  }
  async runTransaction(callback) {
    return this.sql.transaction(async client => {
      // Serialize game mutations so balances and inventory remain consistent across API instances.
      await client.query("LOCK TABLE charmsg.documents IN SHARE ROW EXCLUSIVE MODE");
      const db = new Database(client);
      const writes = [];
      const transaction = {
        get: ref => ref instanceof Document ? db.doc(ref.path).get()
          : new Query(db, ref.path, ref.filters, ref.ordering, ref.maximum).get(),
        set: (ref, ...args) => { writes.push(() => db.doc(ref.path).set(...args)); return transaction; },
        create: (ref, ...args) => { writes.push(() => db.doc(ref.path).create(...args)); return transaction; },
        update: (ref, ...args) => { writes.push(() => db.doc(ref.path).update(...args)); return transaction; },
        delete: ref => { writes.push(() => db.doc(ref.path).delete()); return transaction; }
      };
      const result = await callback(transaction);
      for (const write of writes) await write();
      return result;
    });
  }
  batch() {
    const writes = [];
    const batch = {};
    for (const method of ["set", "create", "update", "delete"]) {
      batch[method] = (ref, ...args) => { writes.push([method, ref, args]); return batch; };
    }
    batch.commit = () => this.runTransaction(tx => { for (const [method, ref, args] of writes) tx[method](ref, ...args); });
    return batch;
  }
}
