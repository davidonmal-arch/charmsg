import express from "express";
import { charmsgAction } from "./index.js";
import { getFirestore } from "./database.js";
import { notificationImage } from "./push.js";

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST && !process.env.CHARMSG_SERVICE_ACCOUNT) {
  throw new Error("CHARMSG_SERVICE_ACCOUNT is required");
}

const app = express();
app.disable("x-powered-by");
app.get("/notification-image/:nftId", async (request, response) => {
  try {
    const image = await notificationImage(request.params.nftId, request.query.expires, request.query.signature);
    if (!image) return response.sendStatus(404);
    response.set("Cache-Control", "private, max-age=300").set("X-Content-Type-Options", "nosniff").type(image.type).send(image.bytes);
  } catch { response.sendStatus(404); }
});
app.get("/healthz", async (_request, response) => {
  try {
    if (process.env.DATABASE_URL) await getFirestore().sql.query("SELECT 1");
    response.json({ status: "ok", database: process.env.DATABASE_URL ? "neon" : "firestore" });
  } catch {
    response.status(503).json({ status: "database-unavailable" });
  }
});
const callablePath = "/charmsgAction";
app.options(callablePath, charmsgAction);
app.post(callablePath, express.json({ limit: "2mb" }), charmsgAction);
app.listen(Number(process.env.PORT) || 5002, "0.0.0.0", () => console.log("CharMsg API is listening"));
