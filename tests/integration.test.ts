import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  execute,
  verifyOtp,
  access,
  type Actor,
} from "../src/application/service";
import { otpHash } from "../src/infrastructure/security";
import type { DB } from "../src/infrastructure/db";
test("integración PostgreSQL: roles, duplicados, anulaciones, QR y OTP", async () => {
  const pg = new PGlite();
  await pg.exec(readFileSync("migrations/001_initial.sql", "utf8"));
  const db = {
    query: async (q: string, p?: unknown[]) => {
      const r = await pg.query(q, p);
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    },
  } as unknown as DB;
  const actor = (
    await db.query("SELECT * FROM users WHERE global_role='ADMIN'")
  ).rows[0] as Actor;
  const e = (await execute(db, actor, "event-save", {
    name: "Cuadernos P69",
    item: "Cuaderno",
    status: "ACTIVE",
  })) as { id: string };
  await execute(db, actor, "reader-save", {
    event_id: e.id,
    email: "reader@example.com",
    role: "LECTOR",
    active: true,
  });
  const reader = (
    await db.query("SELECT * FROM users WHERE email='reader@example.com'")
  ).rows[0] as Actor;
  const manual = {
    event_id: e.id,
    method: "MANUAL",
    request_id: crypto.randomUUID(),
    student: {
      code: "S01",
      name: "Estudiante Prueba",
      email: "student@example.com",
    },
    observation: "Identidad verificada",
  };
  await assert.rejects(
    () => execute(db, reader, "deliver", manual),
    /no autorizado/,
  );
  await execute(db, actor, "reader-save", {
    event_id: e.id,
    email: reader.email,
    role: "LECTOR_SUPER",
    active: true,
  });
  const first = (await execute(db, reader, "deliver", manual)) as {
    id: string;
  };
  assert.equal(
    ((await execute(db, reader, "deliver", manual)) as { id: string }).id,
    first.id,
  );
  await assert.rejects(
    () =>
      execute(db, reader, "deliver", {
        ...manual,
        request_id: crypto.randomUUID(),
      }),
    /unique/,
  );
  await assert.rejects(
    () => execute(db, reader, "cancel", { id: first.id, reason: "Corrección" }),
    /No autorizado/,
  );
  await execute(db, actor, "cancel", {
    id: first.id,
    reason: "Entrega anulada de prueba",
  });
  await execute(db, reader, "deliver", {
    ...manual,
    request_id: crypto.randomUUID(),
  });
  await execute(db, actor, "reader-save", {
    event_id: e.id,
    email: reader.email,
    role: "LECTOR_SUPER",
    active: false,
  });
  await assert.rejects(() => access(db, reader, e.id), /Sin acceso/);
  Object.assign(process.env, {
    NODE_ENV: "development",
    QR_MODE: "mock",
    OTP_HMAC_SECRET: "test-secret-must-have-at-least-32-characters",
  });
  const scan = (await execute(db, actor, "scan", {
    event_id: e.id,
    qr_content: "DEMO-VALID",
  })) as { validation_id: string };
  await execute(db, actor, "deliver", {
    event_id: e.id,
    method: "QR",
    validation_id: scan.validation_id,
    request_id: crypto.randomUUID(),
  });
  await assert.rejects(
    () =>
      execute(db, actor, "deliver", {
        event_id: e.id,
        method: "QR",
        validation_id: scan.validation_id,
        request_id: crypto.randomUUID(),
      }),
    /vencida o utilizada/,
  );
  await db.query(
    "INSERT INTO otp_challenges(email,digest,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
    [actor.email, otpHash(actor.email, "123456")],
  );
  assert.equal(
    await verifyOtp(db, { email: actor.email, code: "000000" }),
    null,
  );
  assert.equal(
    (
      await db.query("SELECT attempts FROM otp_challenges WHERE email=$1", [
        actor.email,
      ])
    ).rows[0].attempts,
    1,
  );
  assert.ok(await verifyOtp(db, { email: actor.email, code: "123456" }));
  assert.equal(
    await verifyOtp(db, { email: actor.email, code: "123456" }),
    null,
  );
  await pg.close();
});
