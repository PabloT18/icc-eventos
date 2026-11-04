# Verificación inicial

- TypeScript: sin errores.
- Pruebas: 4 pruebas aprobadas; la integración PostgreSQL embebida verifica permisos, revocación, duplicados, anulaciones y consumo de QR/OTP.
- Compilación Next.js: correcta.
- Compilación OpenNext: correcta.
- Simulación de despliegue Wrangler: correcta; bundle comprimido aproximado de 1,05 MiB.

No se conectó una base Neon real ni se envió correo real. Pendientes: credenciales, contrato QR definitivo, pruebas de cámara en dispositivo físico, concurrencia contra Neon y medición de CPU de Workers Free.

El ZIP contiene código fuente, dependencias bloqueadas, migración, pruebas, fuentes y configuración. No contiene node_modules, builds, credenciales ni historial Git.

Publicación en GitHub: permisos de escritura habilitados y archivos publicados en main.
