import {
  Database,
  Brain,
  BarChart3,
  Train,
  Home,
  Shield,
  ExternalLink,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Data source cards
// ---------------------------------------------------------------------------

const DATA_SOURCES = [
  {
    title: "NSW Fair Trading Rental Bond Data",
    description:
      "Over 1.6 million rental bond lodgements across Greater Sydney from 2021 to 2025. Includes weekly rent, postcode, dwelling type, and bedroom count for every new rental agreement lodged with NSW Fair Trading.",
    href: "https://www.fairtrading.nsw.gov.au/about-fair-trading/rental-bond-data",
    icon: Home,
  },
  {
    title: "ABS Census 2021 — Household Income",
    description:
      "Median total household income (weekly) by postal area from the Australian Bureau of Statistics 2021 Census General Community Profile (G02). Used to calculate area-level rent stress.",
    href: "https://www.abs.gov.au/census/find-census-data/datapacks",
    icon: BarChart3,
  },
  {
    title: "Transport for NSW Open Data",
    description:
      "Train, metro, and ferry station locations across the Sydney network. Used to calculate nearest station distance and indicative commute times for each suburb.",
    href: "https://opendata.transport.nsw.gov.au/",
    icon: Train,
  },
  {
    title: "Australian Postcodes Dataset",
    description:
      "Postcode-to-suburb mapping with latitude and longitude coordinates, used for geospatial calculations, map rendering, and suburb name resolution.",
    href: "https://www.matthewproctor.com/australian_postcodes",
    icon: Database,
  },
] as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-orange-50/30">
      {/* Hero */}
      <div className="bg-gradient-to-br from-primary-dark via-primary to-primary-light">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            About Sydney Rent<span className="text-accent">Smart</span> AI
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-blue-100/90 sm:text-lg">
            An open-data-powered tool helping Sydney renters make informed
            decisions about where to live, based on real government data and AI.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        {/* ---------------------------------------------------------------- */}
        {/* What it does */}
        {/* ---------------------------------------------------------------- */}
        <section className="animate-fade-in">
          <h2 className="text-xl font-bold text-primary sm:text-2xl">
            What does RentSmart AI do?
          </h2>
          <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            <p>
              Sydney RentSmart AI analyses over <strong>1.6 million rental bond
              lodgements</strong> from NSW Fair Trading (2021&ndash;2025) and combines
              them with <strong>ABS Census 2021 household income data</strong> to
              help renters find suburbs that genuinely fit their budget.
            </p>
            <p>
              Enter your annual income, desired bedroom count, and optionally your
              workplace suburb. The tool instantly shows you suburbs where rent
              stays within the recommended <strong>30% of gross income</strong>,
              ranked by affordability, rental supply, or commute time.
            </p>
            <p>
              An AI-powered advisor (Claude by Anthropic) is available to answer
              natural-language questions about the Sydney rental market, drawing on
              the full processed dataset for accurate, data-driven responses.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Methodology */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-14 animate-fade-in">
          <h2 className="text-xl font-bold text-primary sm:text-2xl">
            Methodology
          </h2>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {/* Card: Affordability */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <Shield className="h-4 w-4" />
                The 30% Rule
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                The widely-used housing affordability benchmark states that a
                household should spend <strong>no more than 30%</strong> of gross
                income on rent. A household exceeding this threshold is considered
                to be in <em>housing stress</em>.
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-500">
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  &lt; 25% &mdash; Comfortable
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  25&ndash;30% &mdash; Manageable
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  30&ndash;40% &mdash; Stressed
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  &gt; 40% &mdash; Severe
                </li>
              </ul>
            </div>

            {/* Card: Recommendations */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <BarChart3 className="h-4 w-4" />
                How Recommendations Work
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                When you enter your income and bedroom needs, we:
              </p>
              <ol className="mt-3 space-y-2 text-sm text-slate-600">
                <li className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    1
                  </span>
                  Calculate the median rent for your bedroom count in every
                  Greater Sydney postcode (2000&ndash;2234, 2555&ndash;2770).
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    2
                  </span>
                  Compute your rent-to-income ratio for each suburb and filter
                  out anything above 50% (unlikely to be viable).
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    3
                  </span>
                  Rank the remaining suburbs by affordability and return the top
                  20 with rent trends, dwelling types, nearest station, and
                  commute estimates.
                </li>
              </ol>
            </div>

            {/* Card: Commute */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <Train className="h-4 w-4" />
                Commute Estimates
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                Commute times are <strong>indicative estimates</strong> based on
                straight-line (Haversine) distance between suburb centroids. They
                are not route-based and do not account for traffic, transit
                schedules, or transfers.
              </p>
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                <li>&lt; 5 km &rarr; ~15&ndash;20 min</li>
                <li>5&ndash;15 km &rarr; ~20&ndash;35 min</li>
                <li>15&ndash;30 km &rarr; ~35&ndash;50 min</li>
                <li>30+ km &rarr; ~50&ndash;70 min</li>
              </ul>
            </div>

            {/* Card: AI Advisor */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <Brain className="h-4 w-4" />
                AI-Powered Advisor
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                The built-in chat advisor is powered by{" "}
                <strong>Claude by Anthropic</strong>. It receives a comprehensive
                summary of the processed rental data (medians, trends, cheapest
                &amp; most expensive suburbs, supply statistics) as context, so
                its answers are grounded in real numbers &mdash; not just general
                knowledge.
              </p>
              <p className="mt-2 text-sm text-slate-600">
                When you&apos;ve already run a search, the AI also receives your
                income and bedroom preferences so it can give personalised advice.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Data sources */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-14 animate-fade-in">
          <h2 className="text-xl font-bold text-primary sm:text-2xl">
            Data Sources
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            All data used in this project is publicly available under open
            government licences.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {DATA_SOURCES.map((src) => (
              <a
                key={src.title}
                href={src.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                  <src.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    {src.title}
                    <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 transition-colors group-hover:text-accent" />
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {src.description}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Limitations */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-14 animate-fade-in">
          <h2 className="text-xl font-bold text-primary sm:text-2xl">
            Limitations &amp; Disclaimers
          </h2>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-slate-600">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              Median rents are calculated from bond lodgement data, which reflects
              new tenancies only and may not represent asking rents or renewals.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              Census income data is from 2021 and may not reflect current incomes.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              Commute times are rough estimates based on distance, not actual
              transit routing or traffic conditions.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              This tool is for informational purposes only and should not be
              treated as financial or housing advice.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
