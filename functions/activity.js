import { AsyncLocalStorage } from "node:async_hooks";

export const activityContext = new AsyncLocalStorage();
export const withActivity = (uid, action, callback) => activityContext.run({ uid, action }, callback);
