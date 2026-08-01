import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "土木工程智能规范助手",
  description: "土木工程法规与行业规范查询助手",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
