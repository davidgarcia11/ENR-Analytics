import type { Metadata } from "next"; // Tipo de dato para definir metadatos (título, descripción) para SEO
import { Geist, Geist_Mono } from "next/font/google"; // Fuentes de Google optimizadas por Next.js
import "./globals.css"; // Importamos los estilos globales (Tailwind, resets, etc.)
import "./nova-theme.css"; // Tema Nova (ShadcnSpace) aislado bajo [data-nova-theme] — no afecta a los paneles existentes
import { ToastProvider } from "@/components/ui/toast"; // Sistema de notificaciones global
import { SessionProvider } from "@/components/SessionProvider"; // Sesión compartida: revalida sola y decide quién entra en cada panel

// Configuración de la fuente Sans Serif (Geist)
const geistSans = Geist({
  variable: "--font-geist-sans", // Define variable CSS para usarla en Tailwind
  subsets: ["latin"], // Descarga solo los caracteres latinos para optimizar
});

// Configuración de la fuente Monoespaciada
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Metadatos de la aplicación (Lo que sale en la pestaña del navegador y Google)
export const metadata: Metadata = {
  title: "ENR Analytics",
  description: "Paneles de analítica de Elaborados Naturales",
};

// RootLayout es el componente PADRE de toda la aplicación.
// Todas las páginas (page.tsx) se renderizan DENTRO de este 'children'.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // La etiqueta html y body deben estar aquí porque es el layout raíz
    <html lang="es">
      <body
        // Las variables de fuente Geist se consumen desde los tokens de globals.css
        className={`${geistSans.variable} ${geistMono.variable}`}
      >
        {/* Aquí se inyecta el contenido de la página que estés visitando */}
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
