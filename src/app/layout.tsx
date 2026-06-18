import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERA Monitoring Dashboard",
  description: "Role-based EIA monitoring dashboard seeded from ERA workbook data"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
