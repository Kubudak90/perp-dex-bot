import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Perp DEX Bot Dashboard",
  description: "Multi-platform perpetual DEX trading bot dashboard",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
