import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RO Cat Quest World",
  description: "หน้าบ้าน Next.js เชื่อมต่อ Go Gateway (0xC7 binary protocol)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
