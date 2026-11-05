import { z } from "zod";

export const studentSchema = z.object({
  code: z.string().trim().min(1).max(254),
  name: z.string().trim().min(3).max(200),
  email: z.string().email().max(254).transform((v) => v.toLowerCase()),
  type: z.string().trim().min(1).max(80),
});

const validatorResponse = z.object({
  nombres: z.string().trim().min(1).max(150),
  apellidos: z.string().trim().min(1).max(150),
  email: z.string().email().max(254),
  type: z.string().trim().min(1).max(80),
});

export async function validateQr(content: string) {
  if (process.env.QR_MODE === "mock" && process.env.NODE_ENV === "development")
    return content === "DEMO-VALID"
      ? {
          valid: true as const,
          student: {
            code: "demo@example.com",
            name: "Estudiante de demostración",
            email: "demo@example.com",
            type: "estudiante",
          },
        }
      : { valid: false as const, reason: "QR de demostración inválido" };

  const endpoint = process.env.QR_VALIDATOR_URL;
  const token = process.env.QR_VALIDATOR_TOKEN;
  if (!endpoint || !endpoint.startsWith("https://") || !token)
    throw new Error("Validador QR no configurado");

  const url = new URL(endpoint);
  url.searchParams.set("qr", content);
  const result = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    cache: "no-store",
  });

  // El servicio ACA usa HTTP 400 para un QR inválido o vencido.
  if (result.status === 400)
    return { valid: false as const, reason: "QR inválido o vencido" };
  if (!result.ok) throw new Error("Servicio QR no disponible");

  const data = validatorResponse.parse(await result.json());
  const email = data.email.toLowerCase();
  return {
    valid: true as const,
    student: {
      // El contrato no entrega código de estudiante. El correo institucional
      // sirve como identificador estable para detectar entregas duplicadas.
      code: email,
      name: `${data.nombres} ${data.apellidos}`.trim(),
      email,
      type: data.type,
    },
  };
}
