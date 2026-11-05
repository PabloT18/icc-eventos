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
  if (!endpoint || !endpoint.startsWith("https://") || !token) {
    console.error("QR validator configuration error", {
      hasUrl: Boolean(endpoint),
      urlIsHttps: Boolean(endpoint?.startsWith("https://")),
      hasToken: Boolean(token),
    });
    throw new Error("Validador QR no configurado");
  }

  const url = new URL(endpoint);
  url.searchParams.set("qr", content);
  let result: Response;
  try {
    result = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
      cache: "no-store",
    });
  } catch (error) {
    // Conserva aquí el diagnóstico de red que ya tienes.
    // No registres error.cause ni el mensaje sin filtrar: podrían incluir el QR.
    const failure = error as {
      name?: unknown;
      cause?: { name?: unknown; code?: unknown };
    };
    const causeCode =
      typeof failure?.cause?.code === "string" &&
        /^[A-Z0-9_]{1,40}$/.test(failure.cause.code)
        ? failure.cause.code
        : undefined;
    console.error("QR validator network failure", {
      host: url.hostname,
      errorType:
        typeof failure?.name === "string" ? failure.name : "UnknownError",
      causeType:
        typeof failure?.cause?.name === "string"
          ? failure.cause.name
          : undefined,
      causeCode,
    });

    throw new Error("No fue posible conectar con el validador QR");
  }

  if (result.status >= 300 && result.status < 400) {
    const location = result.headers.get("location");
    let locationHost: string | undefined;

    try {
      locationHost = location ? new URL(location, url).hostname : undefined;
    } catch {
      locationHost = undefined;
    }

    console.error("QR validator redirect rejected", {
      status: result.status,
      locationHost,
    });
    throw new Error("El validador QR respondió con una redirección");
  }

  // El servicio ACA usa HTTP 400 para un QR inválido o vencido.
  if (result.status === 400)
    return { valid: false as const, reason: "QR inválido o vencido" };
  if (!result.ok) {
    console.error("QR validator HTTP failure", { status: result.status });
    throw new Error("El validador QR respondió con error HTTP");
  }

  let payload: unknown;
  try {
    payload = await result.json();
  } catch (error) {
    console.error("QR validator invalid JSON", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    throw new Error("El validador QR devolvió JSON inválido");
  }

  const parsed = validatorResponse.safeParse(payload);
  if (!parsed.success) {
    console.error("QR validator response contract mismatch", {
      issues: parsed.error.issues.map(({ code, path }) => ({ code, path })),
    });
    throw new Error("La respuesta del validador QR no cumple el contrato");
  }

  const data = parsed.data;
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
