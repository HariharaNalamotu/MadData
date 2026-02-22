import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LexDoc — AI Document Analysis",
  description: "Chat with your documents using AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
