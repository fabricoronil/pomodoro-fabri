import "./globals.css";

export const metadata = {
  title: "Pomodoro · Fabri",
  description: "Timer pomodoro con analítica de estudio y control de sueño",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#07080d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
