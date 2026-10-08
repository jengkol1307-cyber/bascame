import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Basecamp — Persiapan pendakian, lebih tenang",
  description:
    "Informasi jalur, status gunung, dan persiapan pendakian dalam satu tempat.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
