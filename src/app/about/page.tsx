import {
  Database,
  BarChart3,
  Train,
  Home,
  Shield,
  ExternalLink,
  Map,
  MapPin,
  ArrowUpDown,
} from "lucide-react";
import { stressBand } from "@/lib/stress";
import { estimateCommuteMinutes } from "@/lib/geo";

// ---------------------------------------------------------------------------
// Figures taken from the code, so the page cannot drift from the behaviour
// ---------------------------------------------------------------------------

/** One sample percentage per band; labels and colours come from stress.ts. */
const STRESS_BANDS = [
  { range: "Under 25%", band: stressBand(20) },
  { range: "25% to 30%", band: stressBand(27) },
  { range: "Over 30%, up to 40%", band: stressBand(35) },
  { range: "Over 40%", band: stressBand(45) },
];

const COMMUTE_EXAMPLES = [5, 10, 20, 30].map((km) => ({
  km,
  minutes: estimateCommuteMinutes(km),
}));

const STEP_NUMBER =
  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary";

// ---------------------------------------------------------------------------
// Data source cards
// ---------------------------------------------------------------------------

const DATA_SOURCES = [
  {
    title: "NSW Fair Trading Rental Bond Data",
    description:
      "About 1.1 million rental bond lodgements across 237 Greater Sydney postcodes from 2021 to 2025. Includes weekly rent, postcode, dwelling type, and bedroom count for every new rental agreement lodged with NSW Fair Trading.",
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
      "Train, metro, light rail and ferry stop locations across the Sydney network, used for the nearest-station distances and the stations on the map. Public transport journey times on the suburb page come from the Transport for NSW Trip Planner.",
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
  {
    title: "OpenStreetMap",
    description:
      "The map tiles, the stored list of nearby hospitals, schools, universities, fire stations, police stations and childcare for each postcode, and the live points-of-interest lookup on each suburb page (supermarkets, parks, gyms, libraries, pharmacies and medical clinics within 3 km, fetched through the Overpass API). \u00a9 OpenStreetMap contributors.",
    href: "https://www.openstreetmap.org/copyright",
    icon: Map,
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
            decisions about where to live, based on real government data.
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
              Sydney RentSmart AI summarises about <strong>1.1 million rental
              bond lodgements</strong> from NSW Fair Trading (2021&ndash;2025)
              across <strong>237 Greater Sydney postcodes</strong>, and
              combines them with <strong>ABS Census 2021 household income
              data</strong>, to help renters find areas that fit what they can
              pay.
            </p>
            <p>
              Rents in the bond data are recorded by postcode, not by suburb.
              So each postcode is treated as <strong>one area</strong>, named
              after one of its suburbs, with the other suburbs it covers listed
              alongside. Every suburb in a postcode shares the same rent
              figures.
            </p>
            <p>There are two ways to search:</p>
            <ul className="space-y-2">
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>
                  <strong>Rent budget.</strong> Enter the most you want to pay
                  in rent (per person, if you are sharing). You get the areas
                  where the median rent for your dwelling size is at or under
                  that amount.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>
                  <strong>Income.</strong> Enter your income before tax. Each
                  area shows the share of that income its median rent would
                  take, rated against the <strong>30% rule</strong> below.
                </span>
              </li>
            </ul>
            <p>
              You can also choose a bedroom count, how many people are
              splitting the rent, and a workplace suburb to see distances and
              commute times.
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
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                In an income search, each area is rated by the share of your
                income its median rent would take:
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-500">
                {STRESS_BANDS.map(({ range, band }) => (
                  <li key={band.rating} className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${band.dot}`} />
                    {range} &mdash; {band.label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Card: Recommendations */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <BarChart3 className="h-4 w-4" />
                How Recommendations Work
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                When you search, we:
              </p>
              <ol className="mt-3 space-y-2 text-sm text-slate-600">
                <li className="flex gap-2">
                  <span className={STEP_NUMBER}>1</span>
                  <span>
                    Take the median rent for your bedroom count in each
                    Greater Sydney postcode (2000&ndash;2234,
                    2555&ndash;2770). If you are sharing, the dwelling size
                    follows the number of people and the rent is split
                    evenly.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className={STEP_NUMBER}>2</span>
                  <span>
                    <strong>Rent budget:</strong> keep the areas where that
                    rent is at or under your budget.{" "}
                    <strong>Income:</strong> work out the rent as a share of
                    your income, and leave out any area where it would be more
                    than your whole income.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className={STEP_NUMBER}>3</span>
                  <span>
                    Show <strong>one result per postcode</strong>, with
                    dwelling mix, nearest station, nearby amenities and, if
                    you gave a workplace, the distance and commute.
                  </span>
                </li>
              </ol>
            </div>

            {/* Card: Ranking */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <ArrowUpDown className="h-4 w-4" />
                Ranking the Results
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                Results can be ordered four ways:
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                <li>
                  <strong>Overall score</strong> &mdash; a combined score of
                  affordability, amenities and rental supply, plus commute
                  when you give a workplace
                </li>
                <li>
                  <strong>Commute</strong> &mdash; shortest commute to your
                  workplace (when you give one)
                </li>
                <li>
                  <strong>Affordability</strong> &mdash; lowest rent relative
                  to your income or budget
                </li>
                <li>
                  <strong>Lowest rent</strong> &mdash; cheapest weekly rent
                </li>
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                With a workplace, the first three look only at areas within a
                set straight-line distance of it (25, 20 and 40 km). Lowest
                rent always covers all of Sydney.
              </p>
            </div>

            {/* Card: Postcode areas and sample size */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <MapPin className="h-4 w-4" />
                Postcode Areas &amp; Small Samples
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                Rent, bond count, income and rent-stress figures are all
                measured for a whole postcode. A suburb page says which
                postcode its figures are for and which other suburbs that
                postcode covers.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                A median built from few bonds is unreliable. Areas with{" "}
                <strong>fewer than 100 bonds</strong> are flagged as a small
                sample and should be read as indicative only.
              </p>
            </div>

            {/* Card: Commute */}
            <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <Train className="h-4 w-4" />
                Commute Estimates
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                Commute times start as <strong>indicative estimates</strong>{" "}
                worked out from the straight-line (Haversine) distance between
                an area and your workplace. They do not account for roads,
                traffic, timetables or transfers:
              </p>
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {COMMUTE_EXAMPLES.map(({ km, minutes }) => (
                  <li key={km}>
                    {km} km &rarr; ~{minutes} min
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Where a routing service responds (
                <a
                  href="https://openrouteservice.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  OpenRouteService
                </a>{" "}
                is tried first), a <strong>routed driving time</strong>{" "}
                replaces the estimate. The suburb page also shows a public
                transport time when one is available.
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
            The sources below are publicly available. OpenStreetMap data is
            &copy; OpenStreetMap contributors and licensed under the Open
            Database Licence.
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
              Rent figures are for whole postcodes. Suburbs that share a postcode
              show the same figures, even where their rents differ in practice.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              Areas with fewer than 100 bonds are flagged as a small sample; their
              medians can be skewed by a handful of tenancies.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              Census income data is from 2021 and may not reflect current incomes.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              The 30% benchmark is measured against income before tax. In a rent
              budget search no stress rating is given, because no income is
              entered.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              Most commute times are rough estimates based on straight-line
              distance, not actual routing, timetables or traffic conditions.
              Routed and public transport times depend on outside services and
              are not always available.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              Nearby amenities are only as complete as OpenStreetMap is for an
              area, and the live points-of-interest lookup also depends on the
              Overpass service responding.
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
