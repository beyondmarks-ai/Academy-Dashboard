import type { Metadata } from "next";
import "./globals.css";
import "./pro.css";

export const metadata: Metadata = {
  title: "Beyond Marks | Student Dashboard",
  description: "Beyond Marks AI Academy student performance dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
