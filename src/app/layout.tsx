import type { Metadata } from "next";

import { GlobalLoadingProvider } from "@/components/feedback/global-loading-provider";
import { MotionProvider } from "@/components/providers/motion-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "PRO Procesos",
  description: "Control operativo y documental de concreto",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <MotionProvider>
            <GlobalLoadingProvider>{children}</GlobalLoadingProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
