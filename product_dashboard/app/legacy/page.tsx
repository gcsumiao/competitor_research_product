import type { ReactNode } from "react"

import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Boxes,
  Calendar,
  ChevronRight,
  CircleDollarSign,
  Compass,
  Download,
  Filter,
  LineChart,
  Package,
  Radar,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

type Trend = "up" | "down" | "flat"

type Metric = {
  label: string
  value: string
  change: string
  note: string
  trend: Trend
}

type Opportunity = {
  name: string
  category: string
  size: string
  profit: string
  score: number
  action: string
}

type Product = {
  name: string
  brand: string
  price: string
  revenue: string
  units: string
  share: string
  tags: string[]
}

type BrandMove = {
  brand: string
  share: string
  change: string
  note: string
  tier: string
}

const metricCards: Metric[] = [
  {
    label: "Market 30D revenue",
    value: "$8.4M",
    change: "+4.2%",
    note: "Snapshot: Jan 14, 2026",
    trend: "up",
  },
  {
    label: "Market 30D units",
    value: "312K",
    change: "+2.6%",
    note: "Top 50 coverage: 92%",
    trend: "up",
  },
  {
    label: "Est 12M revenue",
    value: "$98M to $112M",
    change: "+8.1%",
    note: "6-snapshot median",
    trend: "up",
  },
  {
    label: "Est 12M units",
    value: "3.5M to 3.9M",
    change: "+6.4%",
    note: "6-snapshot median",
    trend: "up",
  },
  {
    label: "Market concentration",
    value: "Top 3 = 38%",
    change: "-1.3%",
    note: "HHI proxy 1,420",
    trend: "down",
  },
  {
    label: "Meaningful competitors",
    value: "17 brands",
    change: "+2",
    note: "Share > 1%",
    trend: "up",
  },
]

const opportunities: Opportunity[] = [
  {
    name: "Rugged auto DMM kits",
    category: "DMM",
    size: "$24M",
    profit: "$3.8M",
    score: 82,
    action: "Enter",
  },
  {
    name: "Dual-lens screen borescopes",
    category: "Borescope",
    size: "$18M",
    profit: "$2.6M",
    score: 77,
    action: "Differentiate",
  },
  {
    name: "Phone thermal dongles",
    category: "Thermal Imager",
    size: "$31M",
    profit: "$2.4M",
    score: 71,
    action: "Selective",
  },
  {
    name: "Digital NV range 300m",
    category: "Night Vision",
    size: "$14M",
    profit: "$1.9M",
    score: 69,
    action: "Test",
  },
]

const topProducts: Product[] = [
  {
    name: "Voltix True RMS Clamp Meter",
    brand: "Voltix",
    price: "$79",
    revenue: "$412K",
    units: "5.2K",
    share: "4.9%",
    tags: ["True RMS", "Backlit", "Safety CAT III"],
  },
  {
    name: "RidgePro Automotive Analyzer",
    brand: "RidgePro",
    price: "$126",
    revenue: "$381K",
    units: "3.1K",
    share: "4.5%",
    tags: ["OBD-II", "Rechargeable", "USB-C"],
  },
  {
    name: "Sparx 6000 Multimeter",
    brand: "Sparx",
    price: "$54",
    revenue: "$344K",
    units: "6.9K",
    share: "4.1%",
    tags: ["Large display", "Auto-range", "Kit"],
  },
  {
    name: "FieldX Compact Clamp Kit",
    brand: "FieldX",
    price: "$62",
    revenue: "$296K",
    units: "4.7K",
    share: "3.6%",
    tags: ["Carry case", "Temp probe", "Magnetic"],
  },
]

const brandMoves: BrandMove[] = [
  {
    brand: "Voltix",
    share: "12.4%",
    change: "+2.1%",
    note: "Pushed into $60-90 tier",
    tier: "Up-market",
  },
  {
    brand: "RidgePro",
    share: "9.7%",
    change: "+1.2%",
    note: "Spec bundle dominates kits",
    tier: "Defend",
  },
  {
    brand: "Sparx",
    share: "8.5%",
    change: "-0.8%",
    note: "Share lost to new entrants",
    tier: "Down-market",
  },
  {
    brand: "Kobra",
    share: "4.2%",
    change: "+0.9%",
    note: "Top 50 new entrant",
    tier: "Attack",
  },
]

const months = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan"]
const revenueSeries = [6.1, 6.8, 7.2, 7.6, 8.4, 8.1]
const unitsSeries = [24, 25, 27, 28, 31, 30]

const specRows = [
  { spec: "Rechargeable", values: [32, 38, 44, 49, 55, 58] },
  { spec: "Color screen", values: [22, 24, 27, 31, 34, 37] },
  { spec: "True RMS", values: [41, 43, 47, 50, 54, 57] },
  { spec: "Backlight", values: [46, 48, 49, 52, 53, 55] },
]

const priceTiers = [
  { label: "$20-40", share: 18, color: "#f3c571" },
  { label: "$40-60", share: 32, color: "#f0a44f" },
  { label: "$60-90", share: 29, color: "#2f8e9a" },
  { label: "$90+", share: 21, color: "#256d7a" },
]

const assumptions = [
  { label: "COGS %", value: "38" },
  { label: "Referral fee %", value: "15" },
  { label: "Fulfillment fee", value: "4.10" },
  { label: "ACOS %", value: "11" },
  { label: "Returns %", value: "4" },
]

const surveyLinks = [
  {
    name: "Shop techs - DMM kit",
    owner: "S. Patel",
    status: "Live",
  },
  {
    name: "DIY buyers - borescope",
    owner: "K. Huang",
    status: "Draft",
  },
  {
    name: "Thermal field use",
    owner: "A. Ramos",
    status: "Review",
  },
]

const supportLog = [
  { issue: "Battery drain", count: "184", severity: "High" },
  { issue: "Probe cable wear", count: "121", severity: "Medium" },
  { issue: "Display glare", count: "97", severity: "Medium" },
]

export default function Page() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(252,238,214,0.7),_transparent_60%),radial-gradient(circle_at_20%_80%,_rgba(99,181,184,0.25),_transparent_55%)]">
      <div className="pointer-events-none absolute -left-32 top-12 h-72 w-72 rounded-full bg-[radial-gradient(circle,_rgba(37,109,122,0.35),_transparent_70%)] blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-52 h-80 w-80 rounded-full bg-[radial-gradient(circle,_rgba(243,197,113,0.35),_transparent_70%)] blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 pb-24 pt-10">
        <header className="space-y-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                  <Compass className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Competitor Intelligence
                  </p>
                  <h1 className="font-display text-3xl leading-tight md:text-4xl">
                    Market Command Center
                  </h1>
                </div>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Track Helium10 snapshots, quantify market momentum, and move from
                raw data to decision-grade actions across four categories.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge className="gap-1 bg-card/80 text-foreground shadow-sm">
                <BadgeCheck className="h-3.5 w-3.5" />
                Query signature locked
              </Badge>
              <Button className="gap-2">
                <Upload className="h-4 w-4" />
                Upload snapshot
              </Button>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Export report
              </Button>
            </div>
          </div>

          <Card className="border-border/60 bg-card/70 backdrop-blur">
            <CardContent className="grid gap-4 py-4 md:grid-cols-[1.1fr_1.1fr_1.6fr_1.2fr]">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Category
                </p>
                <Select defaultValue="dmm">
                  <SelectTrigger className="bg-background/80">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dmm">DMM / Automotive</SelectItem>
                    <SelectItem value="borescope">Borescope</SelectItem>
                    <SelectItem value="thermal">Thermal Imager</SelectItem>
                    <SelectItem value="night">Night Vision</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Snapshot
                </p>
                <Select defaultValue="2026-01-14">
                  <SelectTrigger className="bg-background/80">
                    <SelectValue placeholder="Select snapshot" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2026-01-14">Jan 14, 2026</SelectItem>
                    <SelectItem value="2025-12-15">Dec 15, 2025</SelectItem>
                    <SelectItem value="2025-11-15">Nov 15, 2025</SelectItem>
                    <SelectItem value="2025-10-15">Oct 15, 2025</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Search brand or ASIN
                </p>
                <Input
                  className="bg-background/80"
                  placeholder="Search Voltix, RidgePro, B0D5..."
                />
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Focus
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-2">
                    <Filter className="h-4 w-4" />
                    Spec bundles
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Calendar className="h-4 w-4" />
                    Compare snapshots
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </header>

        <main className="space-y-10">
          <section className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Exec summary
                </p>
                <h2 className="font-display text-2xl">
                  Profit pool, momentum, and competitive pressure
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-2">
                  <LineChart className="h-4 w-4" />
                  Revenue
                </Button>
                <Button size="sm" variant="outline" className="gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Units
                </Button>
                <Button size="sm" variant="outline" className="gap-2">
                  <CircleDollarSign className="h-4 w-4" />
                  Profit pool
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              {metricCards.map((metric) => (
                <MetricCard key={metric.label} metric={metric} />
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Card className="bg-card/80">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">
                        Market trend over snapshots
                      </CardTitle>
                      <CardDescription>
                        Revenue and units indexed to monthly snapshots
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" className="gap-2">
                      <Sparkles className="h-3.5 w-3.5" />
                      Base assumptions
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TrendChart
                    labels={months}
                    revenue={revenueSeries}
                    units={unitsSeries}
                  />
                  <div className="grid gap-3 md:grid-cols-3">
                    <InsightPill
                      icon={<TrendingUp className="h-4 w-4" />}
                      title="Price tier expansion"
                      text="$60-90 tier grew 6 pts in 6 months"
                    />
                    <InsightPill
                      icon={<TrendingDown className="h-4 w-4" />}
                      title="Premium softening"
                      text="$90+ tier down 2 pts since Nov"
                    />
                    <InsightPill
                      icon={<Radar className="h-4 w-4" />}
                      title="Spec adoption"
                      text="Rechargeable + color screen up 11 pts"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/80">
                <CardHeader>
                  <CardTitle className="text-base">Top opportunities</CardTitle>
                  <CardDescription>
                    Ranked by 12M contribution profit
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {opportunities.map((opportunity, index) => (
                    <div
                      key={opportunity.name}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {index + 1}. {opportunity.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {opportunity.category} | Size {opportunity.size}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {opportunity.profit}
                        </p>
                        <Badge
                          variant="secondary"
                          className="mt-1 text-xs"
                        >
                          Score {opportunity.score}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" className="w-full gap-2">
                    See score breakdown
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <Card className="bg-card/80">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Brand movement</CardTitle>
                    <CardDescription>
                      Share shifts and competitive posture
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="gap-2">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    MoM change
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Brand</th>
                        <th className="px-3 py-2 text-left">Share</th>
                        <th className="px-3 py-2 text-left">Change</th>
                        <th className="px-3 py-2 text-left">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {brandMoves.map((brand) => (
                        <tr
                          key={brand.brand}
                          className="border-t border-border/60"
                        >
                          <td className="px-3 py-3 font-medium">
                            {brand.brand}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {brand.share}
                          </td>
                          <td className="px-3 py-3">
                            <Badge
                              className="gap-1"
                              variant={
                                brand.change.startsWith("-")
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {brand.change}
                            </Badge>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {brand.note}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {brandMoves.map((brand) => (
                    <Badge key={brand.brand} variant="outline">
                      {brand.brand}: {brand.tier}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">Top products</CardTitle>
                <CardDescription>
                  Revenue leaders in the selected snapshot
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {topProducts.map((product, index) => (
                  <div
                    key={product.name}
                    className="rounded-xl border border-border/60 bg-background/70 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          {index + 1}. {product.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {product.brand} | {product.price} | {product.units} units
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {product.revenue}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {product.share} share
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {product.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-3">
                      <MiniBar value={parseFloat(product.share)} />
                    </div>
                  </div>
                ))}
                <Button variant="outline" className="w-full gap-2">
                  View top 50 products
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">Spec adoption heatmap</CardTitle>
                <CardDescription>
                  Percent of top revenue ASINs with spec
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-[1.2fr_repeat(6,1fr)] items-center gap-2 text-xs">
                  <div className="text-muted-foreground">Spec</div>
                  {months.map((month) => (
                    <div key={month} className="text-center text-muted-foreground">
                      {month}
                    </div>
                  ))}
                  {specRows.map((row) => (
                    <SpecRow key={row.spec} row={row} />
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">Price tier mix</CardTitle>
                <CardDescription>
                  Revenue share by tier (snapshot)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex h-4 overflow-hidden rounded-full bg-muted">
                  {priceTiers.map((tier) => (
                    <div
                      key={tier.label}
                      style={{ width: `${tier.share}%`, backgroundColor: tier.color }}
                      className="h-full"
                    />
                  ))}
                </div>
                <div className="space-y-3">
                  {priceTiers.map((tier) => (
                    <div key={tier.label} className="flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: tier.color }}
                      />
                      <div className="flex w-full items-center justify-between text-sm">
                        <span>{tier.label}</span>
                        <span className="text-muted-foreground">
                          {tier.share}% share
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Price tier signals</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>$60-90 tier gaining 6 pts over 6 months</li>
                    <li>$20-40 tier contracting with new entrants</li>
                    <li>Premium tier needs spec differentiation</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">Assumptions and profit pool</CardTitle>
                <CardDescription>
                  Scenario inputs feed the contribution profit model
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Base</Badge>
                  <Badge variant="outline">Conservative</Badge>
                  <Badge variant="outline">Aggressive</Badge>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {assumptions.map((assumption) => (
                    <div key={assumption.label} className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        {assumption.label}
                      </p>
                      <Input
                        type="number"
                        defaultValue={assumption.value}
                        className="bg-background/80"
                      />
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="grid gap-4 md:grid-cols-3">
                  <ProfitStat
                    label="Est 12M profit pool"
                    value="$12.6M"
                    note="Base scenario"
                  />
                  <ProfitStat
                    label="Capture at 1-3%"
                    value="$126K to $378K"
                    note="Target share"
                  />
                  <ProfitStat
                    label="Best tier profit"
                    value="$60-90"
                    note="Spec bundle led"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">Profit by segment</CardTitle>
                <CardDescription>
                  Ranked under base assumptions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <SegmentRow
                  name="Auto kits + probes"
                  value="$4.1M"
                  share={36}
                />
                <SegmentRow
                  name="Compact DMM"
                  value="$3.2M"
                  share={28}
                />
                <SegmentRow
                  name="Clamp meters"
                  value="$2.6M"
                  share={22}
                />
                <SegmentRow
                  name="Premium pro sets"
                  value="$2.1M"
                  share={14}
                />
                <Button variant="outline" className="w-full gap-2">
                  Export focus list
                  <Download className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">Upload and QA</CardTitle>
                <CardDescription>
                  Snapshot ingestion checklist
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  Select category and upload CSV parts
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Confirm snapshot date and query signature
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  Validate required columns and dedupe ASINs
                </div>
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  Store snapshot and refresh rollups
                </div>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Data health
                  </p>
                  <div className="flex items-center justify-between">
                    <span>Rows loaded</span>
                    <span className="font-semibold">2,148</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Unique ASINs</span>
                    <span className="font-semibold">1,974</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Missing columns</span>
                    <span className="font-semibold">0</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">Survey hub</CardTitle>
                <CardDescription>
                  Link insights to product validation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {surveyLinks.map((survey) => (
                  <div
                    key={survey.name}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-background/70 px-3 py-2"
                  >
                    <div>
                      <p className="font-medium">{survey.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Owner: {survey.owner}
                      </p>
                    </div>
                    <Badge variant="secondary">{survey.status}</Badge>
                  </div>
                ))}
                <Button variant="outline" className="w-full gap-2">
                  Create new survey
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">Voice of customer</CardTitle>
                <CardDescription>
                  Support issue log and severity
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {supportLog.map((issue) => (
                  <div
                    key={issue.issue}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-background/70 px-3 py-2"
                  >
                    <div>
                      <p className="font-medium">{issue.issue}</p>
                      <p className="text-xs text-muted-foreground">
                        {issue.count} reports
                      </p>
                    </div>
                    <Badge variant="outline">{issue.severity}</Badge>
                  </div>
                ))}
                <Button variant="outline" className="w-full gap-2">
                  Log new issue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="rounded-2xl border border-border/70 bg-background/80 px-6 py-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Next action
                </p>
                <p className="font-display text-xl">
                  Generate the monthly exec report and align on top 3 bets.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="gap-2">
                  <Boxes className="h-4 w-4" />
                  Export summary
                </Button>
                <Button variant="outline" className="gap-2">
                  <Radar className="h-4 w-4" />
                  Review spec gaps
                </Button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

function MetricCard({ metric }: { metric: Metric }) {
  const tone =
    metric.trend === "up"
      ? "bg-emerald-500/15 text-emerald-800"
      : metric.trend === "down"
      ? "bg-rose-500/15 text-rose-800"
      : "bg-amber-500/20 text-amber-800"

  return (
    <Card className="bg-card/80">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {metric.label}
        </CardDescription>
        <CardTitle className="font-display text-2xl">
          {metric.value}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{metric.note}</span>
        <span className={`rounded-full px-2 py-1 font-medium ${tone}`}>
          {metric.change}
        </span>
      </CardContent>
    </Card>
  )
}

function TrendChart({
  labels,
  revenue,
  units,
}: {
  labels: string[]
  revenue: number[]
  units: number[]
}) {
  const width = 560
  const height = 180

  const buildPath = (values: number[]) => {
    const max = Math.max(...values)
    const min = Math.min(...values)
    const range = max - min || 1
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width
        const y = height - ((value - min) / range) * height
        return `${index === 0 ? "M" : "L"}${x},${y}`
      })
      .join(" ")
  }

  const revenuePath = buildPath(revenue)
  const unitsPath = buildPath(units)
  const areaPath = `${revenuePath} L ${width},${height} L 0,${height} Z`

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-48 w-full"
          role="img"
          aria-label="Market trend line chart"
        >
          <defs>
            <linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(47, 142, 154, 0.45)" />
              <stop offset="100%" stopColor="rgba(47, 142, 154, 0.05)" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#revenueFill)" />
          <path
            d={revenuePath}
            fill="none"
            stroke="rgba(47, 142, 154, 0.95)"
            strokeWidth="3"
          />
          <path
            d={unitsPath}
            fill="none"
            stroke="rgba(243, 164, 79, 0.95)"
            strokeWidth="3"
            strokeDasharray="6 6"
          />
        </svg>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">Revenue</Badge>
        <Badge variant="outline">Units</Badge>
      </div>
    </div>
  )
}

function InsightPill({
  icon,
  title,
  text,
}: {
  icon: ReactNode
  title: string
  text: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
      <div className="mt-0.5 text-primary">{icon}</div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

function MiniBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.min(Math.max(value, 4), 100)}%` }}
      />
    </div>
  )
}

function SpecRow({ row }: { row: { spec: string; values: number[] } }) {
  return (
    <>
      <div className="text-sm font-medium">{row.spec}</div>
      {row.values.map((value, index) => (
        <div
          key={`${row.spec}-${index}`}
          className="h-8 rounded-lg text-center text-xs font-medium text-foreground"
          style={{
            backgroundColor: `rgba(47, 142, 154, ${0.15 + value / 140})`,
          }}
        >
          <span className="inline-flex h-full items-center justify-center">
            {value}%
          </span>
        </div>
      ))}
    </>
  )
}

function ProfitStat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="font-display text-lg">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

function SegmentRow({
  name,
  value,
  share,
}: {
  name: string
  value: string
  share: number
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-background/70 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${share}%` }}
          />
        </div>
        <span>{share}%</span>
      </div>
    </div>
  )
}
