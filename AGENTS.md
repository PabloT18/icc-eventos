# Campus Eventos

- Mantener TypeScript estricto y las capas domain, application, infrastructure y presentation.
- El servicio QR externo determina elegibilidad. No incorporar consultas ACA ni reglas locales de matrícula.
- Validar autorización en backend en cada operación; el rol del lector depende del evento.
- ADMIN y LECTOR_SUPER pueden registrar manualmente con observación obligatoria.
- No exponer tokens, OTP, QR completo ni motivos internos en respuestas de lectores o logs de producción.
- Mantener unicidad de entregas en PostgreSQL y transacciones para entrega, auditoría y outbox.
- Todas las migraciones son incrementales. No modificar una migración ya aplicada.
- Ejecutar npm run typecheck, npm test y npm run build:worker antes de proponer cambios.
- Documentar modificaciones de variables de entorno, contrato QR y despliegue en README.md.
