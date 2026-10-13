import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const TITLE = "Sydney RentSmart AI — Find Affordable Sydney Areas";
const DESCRIPTION =
  "Find Sydney areas you can actually afford. Sydney RentSmart AI uses NSW Fair Trading rental bond data and ABS Census income statistics to show renters which postcode areas match their rent budget or income, bedroom needs and workplace location.";

// No metadataBase, canonical URL or social image: the production domain is
// not fixed in the code, so nothing here points at a URL.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Sydney RentSmart AI",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Sydney RentSmart AI",
    type: "website",
    locale: "en_AU",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-AU" className="scroll-smooth">
      <body className={`${inter.variable} antialiased`}>
        <Navbar />
        <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
