import "./globals.css";
export const metadata = {
  title: "Campus Eventos · UPS",
  description: "Registro de entregas mediante carné institucional",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
