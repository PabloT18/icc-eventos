import type { DB } from "@/infrastructure/db";
import { token, digest } from "@/infrastructure/security";
import { z } from "zod";
export const pilotEnabled = () => process.env.AUTH_MODE === "pilot";
const eligible = `u.active AND (u.global_role='ADMIN' OR EXISTS
 (SELECT 1 FROM event_readers r WHERE r.user_id=u.id AND r.active))`;

export async function issueInvite(db: DB, email: string) {
  const secret = token();
  const r = await db.query(
    `INSERT INTO pilot_invites(user_id,digest,expires_at)
 SELECT u.id,$2,now()+interval '24 hours' FROM users u WHERE u.email=$1 AND ${eligible}
 ON CONFLICT(user_id) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at RETURNING user_id`,
    [email.trim().toLowerCase(), digest(secret)],
  );
  if (!r.rowCount)
    throw new Error(
      "Registre el usuario y asigne acceso antes de generar su enlace",
    );
  return secret;
}
export async function redeemInvite(db: DB, input: unknown) {
  if (!pilotEnabled()) return null;
  const b = z
    .object({ email: z.email(), invite: z.string().regex(/^[a-f0-9]{64}$/) })
    .safeParse(input);
  if (!b.success) return null;
  const session = "pilot-" + token();
  const r = await db.query(
    `WITH used AS (DELETE FROM pilot_invites i USING users u
 WHERE i.user_id=u.id AND u.email=$1 AND i.digest=$2 AND i.expires_at>now() AND ${eligible} RETURNING i.user_id)
 INSERT INTO sessions(digest,user_id,expires_at) SELECT $3,user_id,now()+interval '8 hours' FROM used RETURNING user_id`,
    [b.data.email.toLowerCase(), digest(b.data.invite), digest(session)],
  );
  return r.rowCount ? session : null;
}
