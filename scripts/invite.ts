import { transaction } from "../src/infrastructure/db";
import { issueInvite } from "../src/application/pilot";
const email = process.argv[2];
if (!email || process.env.AUTH_MODE !== "pilot")
  throw new Error("Configure AUTH_MODE=pilot e indique un correo");
const url = new URL(process.env.APP_BASE_URL!);
const secret = await transaction((db) => issueInvite(db, email));
url.hash = "invite=" + secret;
console.log(url.href);
