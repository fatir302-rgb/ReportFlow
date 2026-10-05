import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReportFlow",
  description: "Automate client reporting without rebuilding the process for every client.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
