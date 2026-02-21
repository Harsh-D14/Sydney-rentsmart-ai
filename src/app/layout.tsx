import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ChatBot from "@/components/ChatBot";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sydney RentSmart AI — Find Affordable Suburbs",
  description:
    "Discover Sydney suburbs you can actually afford. Sydney RentSmart AI analyses NSW Government rental bond data and ABS Census income statistics to help renters find suburbs that match their budget, bedroom needs, and workplace location.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body className={`${inter.variable} antialiased`}>
        <Navbar />
        <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
        <Footer />
        <Suspense>
          <ChatBot />
        </Suspense>
      </body>
    </html>
  );
}
