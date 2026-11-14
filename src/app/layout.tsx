import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDET CI/CD Lab",
  description:
    "A small task manager used to practice CI/CD and per-PR preview environments",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
