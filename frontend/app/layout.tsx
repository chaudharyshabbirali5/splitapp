import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

import { Pwa } from "./pwa";
import { TabBar, TabBarSpacer } from "./tabbar";
import { ThemeProvider } from "./theme-provider";
import { ThemeScript } from "./theme-script";

// Instrument Sans for everything you read, IBM Plex Mono for everything you
// count. The mono face carries figures, labels and codes — it is what makes a
// column of rupee amounts line up and read as a ledger rather than as text.
const ui = Instrument_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
  display: "swap",
});

const figure = IBM_Plex_Mono({
  variable: "--font-figure",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SplitApp",
  description: "Split shared expenses and settle up.",
  applicationName: "SplitApp",
  // Next injects <link rel="manifest"> from app/manifest.ts automatically.
  appleWebApp: {
    capable: true,
    title: "SplitApp",
    // The paper ground is light, so a translucent bar would put white status
    // text on it. "default" keeps the normal, legible bar.
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  // Tracks the page ground in each theme, so the browser/status bar reads as an
  // extension of the paper rather than a band sitting on top of it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1815" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ui.variable} ${figure.variable} h-full antialiased`}
      // The inline script sets data-theme before React hydrates, so the server
      // markup and the first client render disagree by design.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          <TabBarSpacer />
          <TabBar />
        </ThemeProvider>
        <Pwa />
      </body>
    </html>
  );
}
