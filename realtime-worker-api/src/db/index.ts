import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type { Env } from "../env";

export const getDb = (env: { DB: D1Database }) => {
  return drizzle(env.DB, { schema });
};
