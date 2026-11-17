import express from "express";
import { charmsgAction } from "./index.js";

if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.CHARMSG_SERVICE_ACCOUNT) {
  throw new Error("CHARMSG_SERVICE_ACCOUNT is required");
}

const app = express();
app.disable("x-powered-by");
app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
const callablePath = "/charmsgAction";
app.options(callablePath, charmsgAction);
app.post(callablePath, express.json({ limit: "2mb" }), charmsgAction);
app.listen(Number(process.env.PORT) || 5002, "0.0.0.0", () => console.log("CharMsg API is listening"));
