# Campus Eventos

Aplicación independiente para gestionar eventos y entregas mediante carné institucional UPS. Administrador inicial: `ptorresp@ups.edu.ec`.

## Stack y alcance

Next.js + TypeScript, PostgreSQL en Neon, adaptador OpenNext para Cloudflare Workers. SQL parametrizado con el driver oficial de Neon; no se requiere Prisma. Separación de dominio, casos de uso, adaptadores y presentación. No utiliza Oracle ni consulta endpoints ACA: el único servicio QR determina la elegibilidad.

Incluye login OTP, sesiones de ocho horas, eventos, lectores por evento, cámara QR, confirmación explícita, registro manual con observación, restricción de duplicados en DB, anulaciones auditadas, reporte CSV compatible con Excel y comprobantes opcionales. La fuente Campus corresponde a DejaVu Sans distribuida con su licencia.

## Preparación local

Requiere Node.js 22 o superior y una base Neon de desarrollo.

```bash
npm ci
cp .env.example .env.local
# Completar DATABASE_URL y OTP_HMAC_SECRET con al menos 32 caracteres aleatorios.
npm run db:migrate
npm run dev
```

La migración crea el administrador. No hay contraseña fija ni registro público. En desarrollo puede configurar `MAIL_MODE=console` para ver el OTP en la terminal y `QR_MODE=mock` para validar el texto `DEMO-VALID`. Ambos modos se rechazan en producción. Los datos de demostración no son estudiantes reales. Nunca utilizar la base de producción para pruebas.

## Configuración

| Variable | Uso |
|---|---|
| APP_BASE_URL | Origen exacto sin barra final; localhost en desarrollo, HTTPS en producción |
| DATABASE_URL | Conexión PostgreSQL Neon, preferiblemente pooled |
| OTP_HMAC_SECRET | Secreto aleatorio de al menos 32 caracteres |
| QR_VALIDATOR_URL | Endpoint HTTPS único y fijo |
| QR_VALIDATOR_TOKEN | Bearer token solo en servidor; renovar si caduca |
| QR_MODE | remote; mock únicamente en desarrollo |
| MAIL_MODE | remote; console únicamente en desarrollo |
| MAIL_API_KEY | Clave API Resend |
| MAIL_FROM | Remitente autorizado y verificado en el proveedor |
| DELIVERY_EMAIL_ENABLED | true para habilitar comprobantes globalmente |
| CRON_SECRET | Secreto aleatorio para procesar la bandeja de correos |

El adaptador de correo inicial utiliza Resend por HTTPS, no SMTP. Requiere remitente verificado y una cuota suficiente para OTP. El proveedor puede reemplazarse en `src/infrastructure/mail.ts`. No es obligatorio activar comprobantes para iniciar sesión.

## Roles

- ADMIN: todos los eventos, configuración, lectores, QR, manual, reportes y anulaciones.
- LECTOR: QR y entrega en eventos asignados.
- LECTOR_SUPER: mismas funciones y registro manual.

Asignar un correo desde el evento crea el usuario. El formulario también permite cambiar rol o revocar acceso. La API verifica permisos en cada operación. Los motivos del servicio QR son visibles exclusivamente en el reporte de lecturas del administrador. Una entrega manual no certifica elegibilidad y requiere código, nombre, correo y observación.

## Contrato provisional QR

POST al endpoint configurado con `Authorization: Bearer ...` y JSON:

```json
{"qr_content":"contenido leído","timestamp":"2026-11-04T15:30:00Z"}
```

Respuesta válida:

```json
{"valid":true,"student":{"code":"CODIGO-ESTABLE","name":"Nombre completo","email":"estudiante@est.ups.edu.ec"}}
```

Respuesta inválida:

```json
{"valid":false,"reason":"Motivo interno"}
```

El contrato real se adapta exclusivamente en `src/infrastructure/qr.ts`. El nombre no basta para impedir duplicados: `code` es obligatorio. El token no debe incluirse en variables NEXT_PUBLIC. No se abre ni consulta la URL contenida en un QR.

Una validación dura tres minutos y pertenece al lector y evento. La identidad confirmada sale de DB, no del cliente. La entrega se registra en transacción junto con auditoría y correo pendiente. El índice único parcial impide dos entregas confirmadas por evento y estudiante. Anular conserva el historial y permite una nueva entrega. Las fechas se almacenan en timestamptz y se muestran en America/Guayaquil.

## Cloudflare

```bash
npm run build:worker
npx wrangler login
# Para cada variable confidencial:
npx wrangler secret put DATABASE_URL
npx wrangler secret put OTP_HMAC_SECRET
npx wrangler secret put QR_VALIDATOR_URL
npx wrangler secret put QR_VALIDATOR_TOKEN
npx wrangler secret put MAIL_API_KEY
npx wrangler secret put MAIL_FROM
npx wrangler secret put APP_BASE_URL
npx wrangler secret put CRON_SECRET
# Opcional:
npx wrangler secret put DELIVERY_EMAIL_ENABLED
npm run deploy
```

No ejecutar migraciones automáticamente durante cada build. Aplicar `db:migrate` con la URL de la base correspondiente antes del primer despliegue. Las migraciones llevan registro y bloqueo transaccional. Configurar backups y comprobar restauración antes de uso operativo.

El repositorio incluye CI de tipos, pruebas y compilación. Cloudflare y Neon requieren cuentas externas y configuración; el repositorio no crea dichas cuentas. El nivel gratuito tiene límites: medir CPU/tamaño del Worker y consumo de base antes de comprometer un evento. Si el paquete excede el límite gratuito, no contratar automáticamente: revisar tamaño o usar frontend estático más API ligera. No se garantiza servicio ilimitado gratuito.

## Comprobantes

Habilitar la variable global y la casilla del evento. Configurar en GitHub Actions la variable `APP_BASE_URL` y el secreto `CRON_SECRET`. El workflow de correo procesa hasta cinco pendientes cada quince minutos; también puede ejecutarse manualmente. GitHub puede retrasar tareas programadas. Para volumen alto, aumentar la frecuencia/lotes tras verificar cuotas o integrar una cola.

Cada envío usa una clave idempotente del proveedor. Los fallos se reintentan hasta cinco veces; una caída del correo no revierte la entrega. Revisar pendientes y cuota del proveedor. El reporte incluye intentos y fecha de envío. Las entregas anuladas pendientes no se envían.

## Verificación

```bash
npm run typecheck
npm test
npm run build
npm run build:worker
```

Las pruebas de integración usan PostgreSQL embebido PGlite y validan roles, revocación, unicidad, anulación, consumo de QR y OTP. No sustituyen pruebas de concurrencia contra Neon ni cámara en Android/iOS. Antes de producción comprobar correo real, servicio QR, cámara HTTPS, dos lectores simultáneos y recuperación de fallos de conexión.

## Límites iniciales

- Exportación CSV compatible con Excel; no genera XLSX nativo.
- Contrato QR provisional; confirmar timestamp y respuestas reales.
- No permite registrar sin conexión.
- Los registros manuales dependen del código ingresado correctamente.
- Listado de reportes completo por evento: incorporar paginación para eventos masivos.
- La interfaz gestiona lectores; el administrador global se inicializa por migración.

## Piloto sin correo

Configure `AUTH_MODE=pilot` y `DELIVERY_EMAIL_ENABLED=false` en el Worker. Aplique la migración 002. Para emitir invitaciones desde el equipo administrador prepare .env.production.local con DATABASE_URL, APP_BASE_URL (origen HTTPS del Worker) y AUTH_MODE=pilot.

```bash
node --env-file=.env.production.local --import tsx scripts/migrate.ts
node --env-file=.env.production.local --import tsx scripts/invite.ts ptorresp@ups.edu.ec
```

Abra su enlace e ingrese su correo. Cree el evento y asigne a cada lector. Repita el comando invite.ts con cada correo y comparta el enlace de salida en privado. Cada enlace funciona una vez durante 24 horas y abre una sesión de ocho horas. Generar otro reemplaza el enlace pendiente. En desarrollo use .env.local y el origen local. Para volver a OTP configure primero Resend y OTP_HMAC_SECRET, luego AUTH_MODE=otp; las sesiones piloto dejan de ser válidas. El envío de comprobantes se activa por separado.
