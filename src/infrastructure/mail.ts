export async function sendMail(
  to: string,
  subject: string,
  text: string,
  key?: string,
) {
  if (
    process.env.MAIL_MODE === "console" &&
    process.env.NODE_ENV === "development"
  ) {
    console.log("[DEV MAIL]", to, subject, text);
    return;
  }
  if (!process.env.MAIL_API_KEY || !process.env.MAIL_FROM)
    throw new Error("Correo no configurado");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MAIL_API_KEY}`,
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("No se pudo enviar el correo");
}
