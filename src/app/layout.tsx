import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { AskPopover } from "@/components/AskPopover";
import { getSessionUser } from "@/lib/auth/session";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "paisa. — personal expense tracker",
  description:
    "Track UPI, card, and cash spending. Auto-ingests bank emails. Built for Indian banking.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "paisa.",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Keeps the address bar and system chrome from being a different shade
  // than the app background.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Only show the global nav + chat FAB when signed in — keeps the /login
  // screen clean and avoids nav links that would just bounce to /login.
  const signedIn = (await getSessionUser()) !== null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 pb-[env(safe-area-inset-bottom)] dark:bg-black">
        {children}
        {signedIn ? (
          <>
            <BottomNav />
            <AskPopover categories={[]} />
          </>
        ) : null}
      </body>
    </html>
  );
}
