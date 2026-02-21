import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white/60">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {/* Brand */}
          <div>
            <p className="text-sm font-bold text-primary">
              Rent<span className="text-accent">Smart</span> AI
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Empowering Sydney renters with transparent, data-driven insights.
              Built for the NSW Government GovHack challenge.
            </p>
          </div>

          {/* Data sources */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Data Sources
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-400">
              <li>
                <a
                  href="https://www.fairtrading.nsw.gov.au/about-fair-trading/rental-bond-data"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-primary"
                >
                  NSW Fair Trading Rental Bonds
                </a>
              </li>
              <li>
                <a
                  href="https://www.abs.gov.au/census"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-primary"
                >
                  ABS Census 2021
                </a>
              </li>
              <li>
                <a
                  href="https://opendata.transport.nsw.gov.au/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-primary"
                >
                  Transport for NSW Open Data
                </a>
              </li>
            </ul>
          </div>

          {/* Credits */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Powered By
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-400">
              <li>
                <a
                  href="https://www.anthropic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-primary"
                >
                  Claude AI by Anthropic
                </a>
              </li>
              <li>Next.js &middot; React &middot; Leaflet</li>
              <li>
                <Link href="/about" className="transition-colors hover:text-primary">
                  Methodology &amp; About
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-slate-100 pt-6 text-center text-[11px] text-slate-300">
          Built with NSW Government Open Data. Not financial advice.
        </div>
      </div>
    </footer>
  );
}
