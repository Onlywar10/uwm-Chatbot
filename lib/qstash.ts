import { Client } from "@upstash/qstash";
import { env } from "./env.mjs";

export const qstash = new Client({
	token: env.QSTASH_TOKEN,
	baseUrl: env.QSTASH_URL,
});
