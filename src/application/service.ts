import { z } from "zod";
import type { DB } from "@/infrastructure/db";
import { canManual, type Role } from "@/domain/policy";
import { digest, token, code, otpHash } from "@/infrastructure/security";
import { sendMail } from "@/infrastructure/mail";
import { studentSchema, validateQr } from "@/infrastructure/qr";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type Actor = { id: string; email: string; global_role: string };
const uuid = z.uuid();
export async function audit(
  db: DB,
  actor: string,
  action: string,
  id: string,
  detail: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4)",
    [actor, action, id, JSON.stringify(detail)],
  );
}
export async function current(db: DB, session: string): Promise<Actor> {
  if (session.startsWith("pilot-") && process.env.AUTH_MODE !== "pilot")
    throw new AppError("Inicie sesión", 401);
  const r = await db.query(
    "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=$1 AND s.expires_at>now() AND u.active",
    [digest(session)],
  );
  if (!r.rowCount) throw new AppError("Inicie sesión", 401);
  return r.rows[0];
}
export function admin(a: Actor) {
  if (a.global_role !== "ADMIN") throw new AppError("No autorizado", 403);
}
export async function access(
  db: DB,
  a: Actor,
  id: string,
  active = false,
): Promise<Role> {
  uuid.parse(id);
  const e = await db.query("SELECT * FROM events WHERE id=$1 FOR SHARE", [id]);
  if (!e.rowCount) throw new AppError("Evento no encontrado", 404);
  if (active && e.rows[0].status !== "ACTIVE")
    throw new AppError("El evento no está activo");
  if (a.global_role === "ADMIN") return "ADMIN";
  const r = await db.query(
    "SELECT role FROM event_readers WHERE event_id=$1 AND user_id=$2 AND active FOR SHARE",
    [id, a.id],
  );
  if (!r.rowCount) throw new AppError("Sin acceso al evento", 403);
  return r.rows[0].role;
}
export async function throttle(
  db: DB,
  key: string,
  max: number,
  seconds: number,
) {
  const r = await db.query(
    `INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+$2*interval '1 second' ELSE rate_limits.reset_at END RETURNING count`,
    [key, seconds],
  );
  return r.rows[0].count <= max;
}
export async function requestOtp(db: DB, input: unknown, ip: string) {
  const email = z.email().max(254).parse(input).trim().toLowerCase();
  const allowed = await throttle(db, "otp-ip:" + digest(ip), 20, 900);
  const allowedEmail = await throttle(db, "otp-email:" + email, 1, 60);
  if (!allowed || !allowedEmail) return;
  const u = await db.query(
    `SELECT id FROM users WHERE email=$1 AND active AND (global_role='ADMIN' OR EXISTS(SELECT 1 FROM event_readers r WHERE r.user_id=users.id AND r.active))`,
    [email],
  );
  if (!u.rowCount) return;
  const c = code();
  await db.query(
    `INSERT INTO otp_challenges(email,digest,expires_at) VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT(email) DO UPDATE SET digest=$2,expires_at=now()+interval '5 minutes',attempts=0,sent_at=now()`,
    [email, otpHash(email, c)],
  );
  await sendMail(
    email,
    "Código de acceso · Campus Eventos",
    `Su código es ${c}. Caduca en 5 minutos.`,
  );
}
export async function verifyOtp(db: DB, input: unknown) {
  const b = z
    .object({
      email: z.email().transform((v) => v.toLowerCase()),
      code: z.string().regex(/^\d{6}$/),
    })
    .parse(input);
  const r = await db.query(
    "SELECT * FROM otp_challenges WHERE email=$1 FOR UPDATE",
    [b.email],
  );
  const row = r.rows[0];
  if (
    !row ||
    row.attempts >= 5 ||
    new Date(row.expires_at).getTime() < Date.now()
  )
    return null;
  await db.query(
    "UPDATE otp_challenges SET attempts=attempts+1 WHERE email=$1",
    [b.email],
  );
  if (row.digest !== otpHash(b.email, b.code)) return null;
  const u = await db.query(
    `SELECT * FROM users WHERE email=$1 AND active AND (global_role='ADMIN' OR EXISTS(SELECT 1 FROM event_readers r WHERE r.user_id=users.id AND r.active))`,
    [b.email],
  );
  if (!u.rowCount) return null;
  await db.query("DELETE FROM otp_challenges WHERE email=$1", [b.email]);
  const s = token();
  await db.query(
    `INSERT INTO sessions(digest,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')`,
    [digest(s), u.rows[0].id],
  );
  return s;
}
export async function execute(
  db: DB,
  a: Actor,
  action: string,
  input: unknown,
) {
  const b = z.record(z.string(), z.unknown()).parse(input);
  if (action === "event-save") {
    admin(a);
    const e = z
      .object({
        id: uuid.optional(),
        name: z.string().trim().min(3).max(150),
        item: z.string().trim().min(2).max(100),
        period: z.string().max(40).default(""),
        status: z.enum(["DRAFT", "ACTIVE", "CLOSED"]),
        email_enabled: z.boolean().default(false),
      })
      .parse(b);
    const r = e.id
      ? await db.query(
          "UPDATE events SET name=$2,item=$3,period=$4,status=$5,email_enabled=$6 WHERE id=$1 RETURNING id",
          [e.id, e.name, e.item, e.period, e.status, e.email_enabled],
        )
      : await db.query(
          "INSERT INTO events(name,item,period,status,email_enabled,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [e.name, e.item, e.period, e.status, e.email_enabled, a.id],
        );
    if (!r.rowCount) throw new AppError("Evento no encontrado", 404);
    await audit(db, a.id, action, r.rows[0].id, e);
    return r.rows[0];
  }
  if (action === "reader-save") {
    admin(a);
    const v = z
      .object({
        event_id: uuid,
        email: z.email().transform((v) => v.toLowerCase()),
        role: z.enum(["LECTOR", "LECTOR_SUPER"]),
        active: z.boolean(),
      })
      .parse(b);
    const u = await db.query(
      "INSERT INTO users(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id",
      [v.email],
    );
    await db.query(
      "INSERT INTO event_readers(event_id,user_id,role,active) VALUES($1,$2,$3,$4) ON CONFLICT(event_id,user_id) DO UPDATE SET role=$3,active=$4",
      [v.event_id, u.rows[0].id, v.role, v.active],
    );
    await audit(db, a.id, action, v.event_id, v);
    return { ok: true };
  }
  if (action === "scan") {
    const v = z
      .object({ event_id: uuid, qr_content: z.string().min(1).max(8192) })
      .parse(b);
    await access(db, a, v.event_id, true);
    if (!(await throttle(db, "scan:" + a.id, 60, 60)))
      return { error: "Demasiadas lecturas", status: 429 };
    let result;
    try {
      result = await validateQr(v.qr_content);
    } catch {
      throw new AppError(
        "No se pudo consultar el servicio. Intente nuevamente.",
        503,
      );
    }
    await db.query(
      "INSERT INTO scan_attempts(event_id,actor_id,valid,reason) VALUES($1,$2,$3,$4)",
      [v.event_id, a.id, result.valid, result.valid ? null : result.reason],
    );
    if (!result.valid)
      return {
        valid: false,
        message: "No se pudo validar el QR. Acérquese al administrador.",
      };
    const prior = await db.query(
      "SELECT d.delivered_at,u.email AS responsible FROM deliveries d JOIN users u ON u.id=d.actor_id WHERE event_id=$1 AND student_code=$2 AND status='CONFIRMED'",
      [v.event_id, result.student.code],
    );
    if (prior.rowCount)
      return { valid: true, student: result.student, duplicate: prior.rows[0] };
    const r = await db.query(
      "INSERT INTO qr_validations(event_id,actor_id,student,expires_at) VALUES($1,$2,$3,now()+interval '3 minutes') RETURNING id",
      [v.event_id, a.id, JSON.stringify(result.student)],
    );
    return {
      valid: true,
      student: result.student,
      validation_id: r.rows[0].id,
    };
  }
  if (action === "deliver") {
    const v = z
      .object({
        event_id: uuid,
        request_id: uuid,
        method: z.enum(["QR", "MANUAL"]),
        validation_id: uuid.optional(),
        student: studentSchema.optional(),
        observation: z.string().trim().max(1000).default(""),
      })
      .parse(b);
    const role = await access(db, a, v.event_id, true);
    const old = await db.query(
      "SELECT id,event_id,actor_id FROM deliveries WHERE request_id=$1",
      [v.request_id],
    );
    if (old.rowCount) {
      if (old.rows[0].actor_id !== a.id || old.rows[0].event_id !== v.event_id)
        throw new AppError("Solicitud conflictiva", 409);
      return { id: old.rows[0].id };
    }
    let student = v.student;
    if (v.method === "MANUAL") {
      if (!canManual(role))
        throw new AppError("Registro manual no autorizado", 403);
      if (v.observation.length < 5 || !student)
        throw new AppError("Complete estudiante y observación");
    } else {
      const r = await db.query(
        "UPDATE qr_validations SET consumed=true WHERE id=$1 AND event_id=$2 AND actor_id=$3 AND NOT consumed AND expires_at>now() RETURNING student",
        [v.validation_id, v.event_id, a.id],
      );
      if (!r.rowCount) throw new AppError("Validación vencida o utilizada");
      student = studentSchema.parse(r.rows[0].student);
    }
    const s = student!;
    const r = await db.query(
      "INSERT INTO deliveries(event_id,student_code,student_name,student_email,actor_id,method,observation,validation_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,delivered_at",
      [
        v.event_id,
        s.code,
        s.name,
        s.email,
        a.id,
        v.method,
        v.observation,
        v.method === "QR" ? v.validation_id : null,
        v.request_id,
      ],
    );
    const id = r.rows[0].id;
    await audit(db, a.id, "delivery", id, { method: v.method });
    const event = (
      await db.query("SELECT * FROM events WHERE id=$1", [v.event_id])
    ).rows[0];
    if (process.env.DELIVERY_EMAIL_ENABLED === "true" && event.email_enabled)
      await db.query(
        "INSERT INTO email_outbox(delivery_id,recipient,body) VALUES($1,$2,$3)",
        [
          id,
          s.email,
          `Entrega: ${event.item}\nEvento: ${event.name}\nEstudiante: ${s.name} (${s.email})\nResponsable: ${a.email}\nFecha: ${new Date(r.rows[0].delivered_at).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}\nComprobante: ${id}`,
        ],
      );
    return { id };
  }
  if (action === "cancel") {
    admin(a);
    const v = z
      .object({ id: uuid, reason: z.string().trim().min(5).max(1000) })
      .parse(b);
    const r = await db.query(
      "UPDATE deliveries SET status='CANCELLED',cancelled_by=$2,cancelled_at=now(),cancellation_reason=$3 WHERE id=$1 AND status='CONFIRMED' RETURNING id",
      [v.id, a.id, v.reason],
    );
    if (!r.rowCount) throw new AppError("Entrega no disponible");
    await audit(db, a.id, action, v.id, { reason: v.reason });
    return { ok: true };
  }
  throw new AppError("Operación no encontrada", 404);
}
