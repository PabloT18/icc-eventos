import { z } from "zod";
export const studentSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(3).max(200),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
});
const response = z.discriminatedUnion("valid", [
  z.object({ valid: z.literal(true), student: studentSchema }),
  z.object({
    valid: z.literal(false),
    reason: z.string().max(1000).optional(),
  }),
]);
export async function validateQr(content: string) {
  if (process.env.QR_MODE === "mock" && process.env.NODE_ENV === "development")
    return content === "DEMO-VALID"
      ? {
          valid: true as const,
          student: {
            code: "DEMO-001",
            name: "Estudiante de demostración",
            email: "demo@example.com",
          },
        }
      : { valid: false as const, reason: "QR de demostración inválido" };
  const url = process.env.QR_VALIDATOR_URL;
  if (!url || !url.startsWith("https://") || !process.env.QR_VALIDATOR_TOKEN)
    throw new Error("Validador no configurado");
  const result = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.QR_VALIDATOR_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      qr_content: content,
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    cache: "no-store",
  });
  if (!result.ok) throw new Error("Servicio QR no disponible");
  return response.parse(await result.json());
}
