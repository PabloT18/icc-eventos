import { pilotEnabled, redeemInvite } from "@/application/pilot";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { transaction } from "@/infrastructure/db";
import { digest } from "@/infrastructure/security";
import { sendMail } from "@/infrastructure/mail";
import {
  current,
  admin,
  access,
  execute,
  requestOtp,
  verifyOtp,
  AppError,
} from "@/application/service";
import { csvCell } from "@/domain/policy";
export const dynamic = "force-dynamic";
// ACA puede tardar hasta 15 s; deja margen para DB y respuesta HTTP en Vercel.
export const maxDuration = 30;
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "no-store" } });
async function handle(req: NextRequest) {
  const path = req.nextUrl.pathname.replace("/api/", "");
  try {
    if (req.method === "POST") {
      if (req.headers.get("origin") !== process.env.APP_BASE_URL)
        throw new AppError("Origen no autorizado", 403);
      if (!req.headers.get("content-type")?.includes("application/json"))
        throw new AppError("Formato inválido", 415);
      const raw = await req.text();
      if (raw.length > 16384)
        throw new AppError("Solicitud demasiado grande", 413);
      const body = JSON.parse(raw);
      if (path === "auth/request") {
        if (pilotEnabled())
          return json({ error: "Utilice su enlace de invitación" }, 403);
        await transaction((db) =>
          requestOtp(
            db,
            body.email,
            req.headers.get("cf-connecting-ip") || "local",
          ),
        );
        return json({
          message: "Si su correo está autorizado, recibirá un código.",
        });
      }
      if (path === "auth/verify" || path === "auth/pilot") {
        if ((path === "auth/pilot") !== pilotEnabled())
          return json({ error: "Método de acceso deshabilitado" }, 403);
        const s = await transaction((db) =>
          pilotEnabled() ? redeemInvite(db, body) : verifyOtp(db, body),
        );
        if (!s)
          return json(
            {
              error: pilotEnabled()
                ? "Enlace inválido, vencido o ya utilizado"
                : "Código inválido o vencido",
            },
            400,
          );
        const res = json({ ok: true });
        res.cookies.set("session", s, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          maxAge: 28800,
        });
        return res;
      }
      if (path === "auth/logout") {
        await transaction((db) =>
          db.query("DELETE FROM sessions WHERE digest=$1", [
            digest(req.cookies.get("session")?.value || ""),
          ]),
        );
        const r = json({ ok: true });
        r.cookies.delete("session");
        return r;
      }
      return json(
        await transaction(async (db) =>
          execute(
            db,
            await current(db, req.cookies.get("session")?.value || ""),
            path,
            body,
          ),
        ),
      );
    }
    if (path === "auth/mode") return json({ pilot: pilotEnabled() });
    if (path === "jobs/mail") {
      if (process.env.DELIVERY_EMAIL_ENABLED !== "true")
        return json({ processed: 0 });
      if (
        !process.env.CRON_SECRET ||
        req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
      )
        throw new AppError("No autorizado", 401);
      const result = await transaction(async (db) => {
        const rows = await db.query(
          `SELECT o.* FROM email_outbox o JOIN deliveries d ON d.id=o.delivery_id WHERE o.sent_at IS NULL AND o.available_at<now() AND o.attempts<5 AND d.status='CONFIRMED' ORDER BY o.available_at LIMIT 5 FOR UPDATE OF o SKIP LOCKED`,
        );
        for (const row of rows.rows) {
          try {
            await sendMail(
              row.recipient,
              "Comprobante de entrega",
              row.body,
              row.id,
            );
            await db.query(
              "UPDATE email_outbox SET sent_at=now(),attempts=attempts+1 WHERE id=$1",
              [row.id],
            );
          } catch {
            await db.query(
              "UPDATE email_outbox SET attempts=attempts+1,available_at=now()+interval '10 minutes' WHERE id=$1",
              [row.id],
            );
          }
        }
        await db.query("DELETE FROM sessions WHERE expires_at<now()");
        await db.query("DELETE FROM otp_challenges WHERE expires_at<now()");
        await db.query("DELETE FROM rate_limits WHERE reset_at<now()");
        return { processed: rows.rowCount };
      });
      return json(result);
    }
    return await transaction(async (db) => {
      const a = await current(db, req.cookies.get("session")?.value || "");
      if (path === "me") return json(a);
      if (path === "events")
        return json(
          (
            await db.query(
              `SELECT e.*,CASE WHEN $2='ADMIN' THEN 'ADMIN' ELSE r.role END AS role FROM events e LEFT JOIN event_readers r ON r.event_id=e.id AND r.user_id=$1 AND r.active WHERE $2='ADMIN' OR r.user_id IS NOT NULL ORDER BY e.created_at DESC`,
              [a.id, a.global_role],
            )
          ).rows,
        );
      const event = req.nextUrl.searchParams.get("event");
      if (path === "readers") {
        admin(a);
        return json(
          (
            await db.query(
              "SELECT r.*,u.email FROM event_readers r JOIN users u ON u.id=r.user_id WHERE event_id=$1",
              [z.uuid().parse(event)],
            )
          ).rows,
        );
      }
      if (path === "scans") {
        admin(a);
        return json(
          (
            await db.query(
              "SELECT s.*,u.email FROM scan_attempts s JOIN users u ON u.id=s.actor_id WHERE event_id=$1 ORDER BY created_at DESC LIMIT 200",
              [z.uuid().parse(event)],
            )
          ).rows,
        );
      }
      if (path === "report" || path === "export") {
        admin(a);
        await access(db, a, z.uuid().parse(event));
        const rows = (
          await db.query(
            `SELECT d.id,d.student_code,d.student_name,d.student_email,d.student_type,u.email AS responsible,d.method,d.observation,d.status,d.delivered_at,d.cancellation_reason,d.cancelled_at,o.sent_at AS email_sent_at,o.attempts AS email_attempts FROM deliveries d JOIN users u ON u.id=d.actor_id LEFT JOIN email_outbox o ON o.delivery_id=d.id WHERE d.event_id=$1 ORDER BY d.delivered_at DESC`,
            [event],
          )
        ).rows;
        if (path === "report") return json(rows);
        const keys = [
          "id",
          "student_code",
          "student_name",
          "student_email",
          "student_type",
          "responsible",
          "method",
          "observation",
          "status",
          "delivered_at",
          "cancellation_reason",
          "email_sent_at",
          "email_attempts",
        ];
        const csv =
          "\ufeff" +
          [
            keys.map(csvCell).join(","),
            ...rows.map((r) =>
              keys
                .map((k) =>
                  csvCell(
                    k.endsWith("_at") && r[k]
                      ? new Date(r[k]).toLocaleString("es-EC", {
                          timeZone: "America/Guayaquil",
                        })
                      : r[k],
                  ),
                )
                .join(","),
            ),
          ].join("\r\n");
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="entregas.csv"',
            "Cache-Control": "no-store",
          },
        });
      }
      throw new AppError("No encontrado", 404);
    });
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json({ error: "Revise los datos ingresados" }, 400);
    if ((e as { code?: string }).code === "23505")
      return json(
        {
          error:
            "La entrega ya está registrada o la solicitud ya fue procesada",
        },
        409,
      );
    console.error("API error", e instanceof Error ? e.name : "Unknown");
    return json(
      {
        error:
          "No se pudo completar la operación. Revise la configuración o reintente.",
      },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
