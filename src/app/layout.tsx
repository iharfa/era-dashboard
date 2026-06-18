import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERA Data Portal",
  description: "Role-based EIA data management portal for projects, permits, monitoring, inspections, and data quality"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
