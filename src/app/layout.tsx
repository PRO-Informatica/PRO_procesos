import type { Metadata } from "next";
import { Poppins } from "next/font/google";

import { AppToaster } from "@/components/feedback/app-toaster";
import { GlobalLoadingProvider } from "@/components/feedback/global-loading-provider";
import { MotionProvider } from "@/components/providers/motion-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";

import "@schedule-x/theme-default/dist/index.css";
import "sileo/styles.css";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PRO Procesos",
  description: "Control operativo y documental de concreto",
  icons: { icon: "/pro-logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={poppins.variable}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <MotionProvider>
            <GlobalLoadingProvider>
              {children}
              <AppToaster />
            </GlobalLoadingProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
