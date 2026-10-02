# Canada OBD Gauge Market Memo — September 2026

Prepared 2026-10-02. Status: research skeleton. Sections 1, 4, 6 (apps), 8 and the Appendix are filled from web research. Sections 0, 2, 3, 5 and 7 hold placeholders. A later track fills them from the workbooks.

> **Evidence contract.** Every number is tagged `[WB: <file>!<sheet>!<cell>]` (workbook cell) or `[SRC: <url>, accessed YYYY-MM-DD]`. Amazon figures are Helium 10 estimates (uncalibrated). CAD and USD are never mixed in one figure. Anything not found is written as `GAP: …`. No Canada-wide market size is extrapolated. The Lordco observation is treated as a hypothesis until SKUs are confirmed.

Wording rules for this memo:

- Amazon results are worded as "observed in the supplied Helium 10 exports (September 2026 sales month, exported 2026-10-02)". They are never worded as facts about the whole marketplace.
- An absence is worded as "not observed in the supplied Helium 10 exports" or "zero classified gauge listings in this dataset".
- Helium 10 "Last Year Sales" and "Sales YoY %" are vendor proxies, not measured trends. A file's export date does not prove that the sales fell in calendar September.
- The memo never states a CAD-vs-USD price premium or revenue ratio. CA and US are compared on units, listing counts and ranks. Revenue appears side by side in its own currency. No FX conversion is used.
- Live listing prices read from retailer and amazon.ca pages on 2026-10-02 are point-in-time web observations tagged `[SRC: …]`. They are not Helium 10 figures.

## 0 Bottom line

_Placeholder: filled after the workbooks are built._

- One-paragraph answer to "is there a Canadian OBD gauge opportunity, and which model": observed export revenue for gauge devices on amazon.ca [WB: TBD] and the device share held by tuner-with-gauge-display units [WB: TBD].
- Model 1 (stand-alone unit) verdict in one line, citing the Section 7 scorecard [WB: TBD].
- Model 2 (RS2 / CarMD phone display) verdict in one line. Note: CarMD Connect is not listed on the Canadian iOS App Store (Section 6) [SRC: https://apps.apple.com/ca/app/id6738333261, accessed 2026-10-02].
- The single most important open data gap (Section 8): Lordco sell-through.

## 1 The ask

Leadership request (verbatim):

> "It looks the OBD gauge is doing well in Canada, Lordco in Vancouver is carrying 3 gas units and 2 diesel units in each store. Please look into this market in Canada. We can look into both models: Stand alone unit; Add to RS2 and CarMD Apps, use phone as display unit."

**Who Lordco is.** Lordco Auto Parts opened its first store in 1974 in Maple Ridge, British Columbia. It describes itself as Canada's biggest privately held automotive parts distributor and Western Canada's largest distributor and retailer of aftermarket parts. It has over 85 locations, including eighteen truck centres, and has been in Alberta since 2019 [SRC: https://lordco.com/our-story/, accessed 2026-10-02]. So Lordco is a BC-based distributor and retailer. The word "jobber" (trade supply to repair shops) does not appear on the story page. GAP: no Lordco source found that calls it a jobber or WD (warehouse distributor). The 500-vehicle delivery fleet points to trade delivery, but this memo does not claim it.

**What the ask leaves open.**

1. **"3 gas + 2 diesel units": SKUs or shelf depth?** It could mean five distinct SKUs (3 gas-specific and 2 diesel-specific part numbers) in every store's planogram. It could also mean five units on the shelf. Those are different signals. Five SKUs per store is a range decision. Five units of stock per store is a depth decision, and it says nothing about sell-through. Lordco's online catalogue does show gas-specific and diesel-specific gauge-tuner SKUs (Section 4). It does not show per-store quantity. GAP: per-store SKU list and on-hand depth.
2. **"Doing well" has to mean sell-through, not shelf presence.** A national-brand tuner on a distributor's shelf proves a range decision, not consumer demand. "Doing well" is accepted only with units sold per store per month (or inventory turns) for these SKUs at Lordco. Amazon.ca demand is the secondary check (Sections 2 and 3). GAP: Lordco sell-through (needs Innova's sales contact; see Section 8).
3. **"Vancouver".** The story page places Lordco's origin in Maple Ridge (Metro Vancouver region) [SRC: https://lordco.com/our-story/, accessed 2026-10-02]. The observation is read as "Lordco stores in the Lower Mainland". It is not read as Canada-wide.
4. **Two models.** Model 1 is a stand-alone gauge unit, covered in Section 5. Model 2 adds gauge/dashboard screens to the RS2 and CarMD apps and uses the phone as the display, covered in Section 6.

## 2 Canada Amazon gauge market, Sep '26

_Placeholder: filled from `CA_OBD_Gauge_Competitor_Report_202609.xlsx`._

- Observed export revenue (CAD) and units for in-scope gauge devices in the supplied Helium 10 exports (September 2026 sales month, exported 2026-10-02) [WB: TBD], with listing count [WB: TBD].
- Split by subtype (tuner with gauge display, truck gauge monitor, OBD+GPS HUD, OBD HUD, gauge display) [WB: TBD]. GPS-only HUDs are shown as adjacent and kept out of the OBD totals [WB: TBD].
- Top brands and ASINs by observed export revenue, including whether the Lordco-type units (Bully Dog GT, Edge Insight/Evolution) appear [WB: TBD]. If they do not: "not observed in the supplied Helium 10 exports".
- Price ladder by CAD tier [WB: TBD]. Helium 10 "Sales YoY %" and "Last Year Sales" are shown only as vendor proxies [WB: TBD].

## 3 US benchmark, same month

_Placeholder: filled from the US Benchmark and US vs CA Same-ASIN sheets._

- US observed export revenue (USD) and units for the same gauge classes [WB: TBD], shown next to the CA figures in their own currency. No ratio is taken.
- Same-ASIN comparison on units, listing counts and ranks only [WB: TBD]. No CAD-vs-USD price premium is stated.
- Subtype mix US vs CA as shares within each market [WB: TBD].

## 4 Who sells gas/diesel gauge units in Canada

Research date for every row: 2026-10-02. Every check was an online-catalogue or site-search check. GAP: in-store planograms and shelf stock were not observed for any retailer.

### 4.1 Retailer availability

| Retailer | Carried online? | Units found (part / SKU) | Price (CAD, as listed) | Source |
|---|---|---|---|---|
| Lordco | Yes | Bully Dog GT Platinum Gas Gauge Tuner BDT40417 | CA$554.61 | [SRC: https://lordco.com/Product/GT-Platinum-Gas-Gauge-Tuner-BDT40417, accessed 2026-10-02] |
| Lordco | Yes | Bully Dog GT diesel tuner + multi-gauge monitor BDT40420 | CA$554.46 | [SRC: https://lordco.com/Product/GT-diesel-vehicle-tuner-and-multi-gauge-vehicle-monitor-BDT40420, accessed 2026-10-02] |
| Lordco | Yes | Bully Dog GT Diesel Plus (export-only SKU) BDT40428 | CA$1150.00 | [SRC: https://lordco.com/Product/GT-Diesel-Plus-FOR-EXPORT-ONLY-BDT40428, accessed 2026-10-02] |
| Lordco | Yes | Bully Dog GTX Performance Tuner BDT40460B | CA$966.77 | [SRC: https://lordco.com/Product/GTX-Performance-Tuner-BDT40460B, accessed 2026-10-02] |
| Lordco | Yes | Bully Dog BDX Performance Programmer BDT40470 | CA$582.25 | [SRC: https://lordco.com/Product/BDX-Performance-Programmer-BDT40470, accessed 2026-10-02] |
| Lordco | Yes | Bully Dog BDX hand-held tuner (L5P only) BDT40472 | CA$830.49 | [SRC: https://lordco.com/Product/BDX-hand-held-performance-tuner-L5P-Only-BDT40472, accessed 2026-10-02] |
| Lordco | Yes | Edge Insight CTS3 Digital Gauge Monitor PTQ84130-3 (brand shown as Powerteq) | CA$769.99 | [SRC: https://lordco.com/Product/Insight-CTS3-Digital-Gauge-Monitor-PTQ84130-3, accessed 2026-10-02] |
| Lordco | Yes | DiabloSport Trinity dashboard monitor & tuner PTQT1000 | CA$764.01 | [SRC: https://lordco.com/Product/Diablo-Sport-TRINITY-DASHBOARD-MONITOR-TUNER-PTQT1000, accessed 2026-10-02] |
| Lordco | Yes | DiabloSport Trinity 2 (T2 EX) Ford PTQ9100 | CA$1049.99 | [SRC: https://lordco.com/Product/DiabloSport-Trinity-2-T2-EX-Ford-Vehicles-PTQ9100, accessed 2026-10-02] |
| Lordco | Yes | DiabloSport Trinity 2 (T2 EX) Dodge PTQ9300 | CA$1079.98 | [SRC: https://lordco.com/Product/DiabloSport-Trinity-2-T2-EX-for-Dodge-Vehicles-PTQ9300, accessed 2026-10-02] |
| Lordco | Yes | SCT Ford Livewire TS pre-programmed device SCT5015P | CA$721.41 | [SRC: https://lordco.com/Product/Ford-Livewire-TS-Pre-Programmed-Device-SCT5015P, accessed 2026-10-02] |
| Lordco | No (online) | Edge Evolution CTS3: not returned by site search | — | [SRC: https://lordco.com/search.php?search_query=Evolution+CTS3, accessed 2026-10-02] |
| Lordco | No (online) | ScanGauge: 0 results | — | [SRC: https://lordco.com/search.php?search_query=scangauge, accessed 2026-10-02] |
| Lordco | No (online) | Banks iDash: 0 results | — | [SRC: https://lordco.com/search.php?search_query=iDash, accessed 2026-10-02] |
| Lordco | No (online) | Banks DataMonster: 0 results | — | [SRC: https://lordco.com/search.php?search_query=DataMonster, accessed 2026-10-02] |
| Lordco | No (online) | Superchips Flashpaq: 0 results | — | [SRC: https://lordco.com/search.php?search_query=Flashpaq, accessed 2026-10-02] |
| Lordco | No (online) | Superchips Dashpaq: 0 results | — | [SRC: https://lordco.com/search.php?search_query=Dashpaq, accessed 2026-10-02] |
| Lordco | No (online) | UltraGauge: 0 results | — | [SRC: https://lordco.com/search.php?search_query=ultragauge, accessed 2026-10-02] |
| Canadian Tire | No (online) | Search "bully dog tuner": no vehicle tuner or gauge returned | — | [SRC: https://www.canadiantire.ca/en/search-results.html?q=bully%20dog%20tuner, accessed 2026-10-02] |
| Canadian Tire | No (online) | Search "edge insight": 1 unrelated result | — | [SRC: https://www.canadiantire.ca/en/search-results.html?q=edge%20insight, accessed 2026-10-02] |
| Canadian Tire | No (online) | Search "performance tuner": no vehicle tuner | — | [SRC: https://www.canadiantire.ca/en/search-results.html?q=performance%20tuner, accessed 2026-10-02] |
| Canadian Tire | No (online) | Search "scangauge": TPMS sensors only | — | [SRC: https://www.canadiantire.ca/en/search-results.html?q=scangauge, accessed 2026-10-02] |
| Princess Auto | Yes (HUD only) | Mr. Blacksmith OBD Plus GPS Smart Gauge, SKU 9465543 (OBD+GPS head-up) | CA$49.99 | [SRC: https://www.princessauto.com/en/product/obd-plus-gps-smart-gauge/PA0009465543/9465543, accessed 2026-10-02] |
| Princess Auto | Yes (GPS-only, adjacent) | Powerfist Windshield Projection HUD GPS Speedometer 9198797; Powerfist Digital GPS Speedometer 9198805 | CA$39.99; CA$49.99 | [SRC: https://www.princessauto.com/en/search?q=heads+up+display, accessed 2026-10-02] |
| Princess Auto | No (online) | Search "gauge tuner": no tuner or gauge-tuner | — | [SRC: https://www.princessauto.com/en/search?q=gauge+tuner, accessed 2026-10-02] |
| NAPA Canada | No (online) | Search "bully dog": no products rendered | — | [SRC: https://www.napacanada.com/en/search?text=bully%20dog&referer=v2, accessed 2026-10-02] |
| NAPA Canada | No (online) | Search "performance tuner": no products rendered | — | [SRC: https://www.napacanada.com/en/search?text=performance%20tuner&referer=v2, accessed 2026-10-02] |
| NAPA Canada | No (online) | Search "edge insight": no products rendered | — | [SRC: https://www.napacanada.com/en/search?text=edge%20insight&referer=v2, accessed 2026-10-02] |
| PartSource | No (online) | Search "bully dog": 0 results | — | [SRC: https://partsource.ca/search?q=bully+dog, accessed 2026-10-02] |
| PartSource | No (online) | Search "performance tuner": 2 analog Equus gauges only | — | [SRC: https://partsource.ca/search?q=performance+tuner, accessed 2026-10-02] |
| PartSource | No (online) | Search "heads up display": 0 results | — | [SRC: https://partsource.ca/search?q=heads+up+display, accessed 2026-10-02] |
| PartSource | No (online) | Search "edge insight": unrelated parts only | — | [SRC: https://partsource.ca/search?q=edge+insight, accessed 2026-10-02] |

Notes on the table:

- Lordco's "in stock" flag comes from the online catalogue. GAP: Lordco store-level stock and planogram per store.
- Princess Auto prices are taken from a Canadian retailer's page that shows no currency code. They are read as CAD.
- The SCT Livewire TS row is a gauge-capable programmer from the same tuner shelf. Its fuel scope was not verified.
- NAPA Canada search pages render client-side. "No products rendered" was confirmed against a control search ("obd2"), which did render 50 results [SRC: https://www.napacanada.com/en/search?text=obd2&referer=v2, accessed 2026-10-02].

### 4.2 amazon.ca live listings (point-in-time, not Helium 10)

These are web observations of amazon.ca search pages on 2026-10-02. They show that each unit family is listed. Prices are the live displayed price in CAD. The Helium 10 price, units and revenue for the same ASINs come from the workbook [WB: TBD].

- Bully Dog family (all observed): 40420 GT Platinum Diesel (B001T8J4YK) CA$515.38; 40410 Triple Dog GT Gas (B001P20QDS) CA$538.80; 40417 Triple Dog Platinum GT Gas (B06XWVYJGV) CA$498.79; 40430 Hemi Plus (B00AJLY628) CA$580.80; "40428canada Only Part" (B01602JWV4) CA$899.00. Edge 84130-3 Insight CTS3 (B087WMGLF1) shows CA$662.83 [SRC: https://www.amazon.ca/s?k=bully+dog+gt+tuner, accessed 2026-10-02]
- Edge Evolution CTS3 family: 85400-200 (B08N824D1J), 85400-300 (B09JL42PPV) and 85400-100 (B08YJQCTH2) at CA$1,022.98 each; 85401-201 "CA Edition" (B08YJLFVW7) CA$1,085.34; 85452-252 GM gas (B08YJHM4QJ) CA$1,109.03 [SRC: https://www.amazon.ca/s?k=edge+evolution+cts3, accessed 2026-10-02]
- Banks: iDash 1.8 DataMonster 66760 (B084KPRZ9J) CA$789.38; iDash 1.8 Super Gauge (B079WV5GXC) CA$876.42; iDash Data Pro (B0GNCW4XKM) CA$772.25 [SRC: https://www.amazon.ca/s?k=banks+idash, accessed 2026-10-02]
- ScanGauge: II SGIIFFP (B00VX2NOK2) CA$229.95; ScanGauge 3 SG3 (B0BFBQZZMC) CA$407.59 [SRC: https://www.amazon.ca/s?k=scangauge, accessed 2026-10-02]
- Superchips Flashpaq: F5 2845 (B017J844SY) CA$647.77; 4845 F5 California Edition (B017J7SKUS) CA$646.37 [SRC: https://www.amazon.ca/s?k=superchips+flashpaq, accessed 2026-10-02]
- Superchips Dashpaq: Dashpaq+ 20501 (B09Z7BTBW4) CA$1,317.82; Dashpaq 1050 Ford diesel (B07232K7PS) CA$1,067.24 [SRC: https://www.amazon.ca/s?k=superchips+dashpaq, accessed 2026-10-02]
- UltraGauge: UltraGauge-branded "MX V1.3" listings (B0HC61NG3H CA$127.63; B0H1GKDT6S CA$137.64). Seller authenticity not verified [SRC: https://www.amazon.ca/s?k=ultragauge, accessed 2026-10-02]

### 4.3 Manufacturers: ownership, status, part numbers

- **Bully Dog is owned by Derive Systems, not Holley, and is still sold.** The site says Bully Dog merged under Derive Systems with Bully Dog Big Rig, SCT and VQ [SRC: https://bullydog.com/, accessed 2026-10-02]. On 2026-10-02 it still lists the GT Platinum Gas Tuner (40410, labelled "50 State Legal"), the GT Gas Performance Tuner & Monitor (40417) and the GT Diesel Performance Tuner & Monitor (40420). Its prices are on the US site (USD) and are not compared here [SRC: https://bullydog.com/, accessed 2026-10-02]. No discontinuation notice was found. GAP: Bully Dog Hemi Plus 40430 status on bullydog.com was not checked; it is listed on amazon.ca (Section 4.2).
- **Part-number note (flag).** The brief's labels were "GT Platinum gas (40417) / Triple Dog GT gas (40410)". Lordco calls BDT40417 "GT Platinum Gas Gauge Tuner" [SRC: https://lordco.com/Product/GT-Platinum-Gas-Gauge-Tuner-BDT40417, accessed 2026-10-02]. Bullydog.com calls 40410 "GT Platinum Gas Tuner (50 State Legal)" and 40417 "GT Gas Performance Tuner & Monitor" [SRC: https://bullydog.com/, accessed 2026-10-02]. Amazon.ca titles 40410 "Triple Dog GT Gas Gauge Tuner" and 40417 "Triple Dog Platinum GT Gas" [SRC: https://www.amazon.ca/s?k=bully+dog+gt+tuner, accessed 2026-10-02]. Treat the model names as inconsistent across channels. Match on part number.
- **Bully Dog's Canadian dealer network.** The reseller locator with Location = International and country = Canada returned 1,748 reseller results. The first page lists Alberta resellers [SRC: https://bullydog.com/find-a-dealer/, accessed 2026-10-02]. GAP: these entries are not validated (they may be stale), and the number of Lordco branches among them was not counted.
- **Edge Products belongs to Holley.** Holley's FY2025 10-K names EDGE among its brands and says Holley sells primarily in the United States, Canada and Europe [SRC: https://www.sec.gov/Archives/edgar/data/1822928/000162828026018218/hlly-20251231.htm, accessed 2026-10-02]. Edge's own site names Holley as the schema publisher and links Holley's privacy policy [SRC: https://www.edgeproducts.com/products/in-cabin_monitors/insight/, accessed 2026-10-02]. Lordco files Edge under brand "Powerteq" with a PTQ prefix, and DiabloSport also uses a PTQ prefix [SRC: https://lordco.com/Product/Insight-CTS3-Digital-Gauge-Monitor-PTQ84130-3, accessed 2026-10-02]. GAP: no Edge dealer locator link was found on edgeproducts.com, so Edge's Canadian dealer coverage is unknown.
- **Edge part numbers (flag: the brief's mapping is reversed).** The brief said Evolution CTS3 gas = 85400-xxx and diesel = 85401-xxx. On Edge's catalogue, 85400-100/-200/-300 are the diesel units (Power Stroke / Duramax / Cummins). The gas units are 85450-150 (Ford), 85450-250 (GM) and 85452-xxx (GM). 85401-101 is the "50 STATE LEGAL" Power Stroke diesel unit [SRC: https://www.edgeproducts.com/products/in-cabin_tuners/evolution_cts3/, accessed 2026-10-02]. Edge also sells Insight+ (84140), an Insight CTS3 with a custom-tune licence for Power Stroke and Duramax diesels [SRC: https://www.edgeproducts.com/products/in-cabin_monitors/insightplus/, accessed 2026-10-02].
- **"CA Edition" means California (CARB), not Canada.** A reseller listing of the Edge "Ford Diesel Evolution CTS3 CA" says the unit carries CARB Executive Order approval and is 50-state legal [SRC: https://liftkits4less.com/ford-diesel-evolution-cts3-ca-1994-5-2019-ford-f-250-f-350-powerstroke-diesel-50-state-legal-edge-products, accessed 2026-10-02] (third-party US reseller). Edge's handheld 86040 is sold as the "EvoHT2 California Edition" [SRC: https://www.jbtools.com/edge-gas-diesel-vehicle-tuner-evoht2-california-edition-86040/, accessed 2026-10-02] (third-party US reseller). Edge's consolidated CARB Executive Order D-541-18 covers its 50-state-legal diesel products [SRC: https://theshopmag.com/news/edge-products-announces-extensive-diesel-executive-order-coverage-carb, accessed 2026-10-02] (trade press). The same convention applies to Superchips "California Edition" listings [SRC: https://www.amazon.ca/s?k=superchips+flashpaq, accessed 2026-10-02]. A "CA" suffix on amazon.ca does not make a listing Canada-specific.
- **Canada-specific SKUs do exist on the diesel side.** Lordco lists BDT40428 "GT Diesel Plus -FOR EXPORT ONLY" [SRC: https://lordco.com/Product/GT-Diesel-Plus-FOR-EXPORT-ONLY-BDT40428, accessed 2026-10-02], and amazon.ca lists "40428canada Only Part" [SRC: https://www.amazon.ca/s?k=bully+dog+gt+tuner, accessed 2026-10-02]. GAP: what differs from the US 40420 (tune content or emissions calibration) is not documented on these pages.

### 4.4 Hypothesis: what "3 gas + 2 diesel" could be (unconfirmed)

Lordco's online catalogue shows these candidate gauge-display units:

- Gas-specific: Bully Dog GT Platinum Gas (BDT40417).
- Diesel-specific: Bully Dog GT diesel (BDT40420), GT Diesel Plus export-only (BDT40428) and BDX L5P (BDT40472).
- Gas-and-diesel: Edge Insight CTS3 (PTQ84130-3).
- Fuel scope not verified: DiabloSport Trinity / Trinity 2 and SCT Livewire TS.

Sources for each are in the Section 4.1 table. This is consistent with a 3-gas / 2-diesel planogram, but the five SKUs on the shelf cannot be identified from public pages. Hypothesis status: OPEN until the Lordco SKU list is obtained (Section 8).

## 5 Model 1 — stand-alone unit

_Placeholder: filled from the Price Ladder (Model A) and Feature Matrix (Model A) sheets._

- Observed export revenue and units by CAD price tier for gauge devices on amazon.ca [WB: TBD], with where the Lordco-type tuner-with-gauge units sit on that ladder [WB: TBD].
- Feature matrix of the top device ASINs (data source, screen type, fuel scope, alarms, multi-gauge, km/h-mph) [WB: TBD].
- The gap an Innova stand-alone unit would aim at (for example, a monitor-only diesel gauge without tuning, priced below tuner units), stated only from tier data [WB: TBD].
- Channel note from Section 4: Lordco carries both tuner families. Canadian Tire, NAPA Canada and PartSource showed none online.

## 6 Model 2 — phone as display (RS2 / CarMD)

_App matrix below: filled from web research. Model-B demand proxy (Dongle tier sheet): placeholder [WB: TBD]._

### 6.1 App feature matrix: "phone as gauge display"

Prices are in the currency shown. "CA storefront" means the Canadian Apple App Store listing, which displays CAD. "Not stated" means the listing does not describe the feature, so it is unverified rather than proven absent.

| App (developer) | Live-data gauges / dashboards | Custom layouts / themes | HUD / mirror mode | Alarms / thresholds | Logging / export | Enhanced PIDs (incl. diesel) | CarPlay / Android Auto | Price | Canada availability | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| OBDLink (OBD Solutions) | Yes, customizable dashboards | Yes (dashboard export/import) | Yes (HUD mode on dashboards) | Yes (Alerts setting) | Yes (CSV) | OEM enhanced add-ons (Ford, FCA, Toyota...); trans-temp manufacturer PIDs for some Subaru; GAP: diesel EGT/DPF | Not stated | App free; enhanced add-ons CA$19.99 each (CA storefront); free OEM add-ons with MX+; OBDLink adapters only | Yes, CA App Store | [SRC: https://apps.apple.com/ca/app/id879636351, accessed 2026-10-02] |
| BlueDriver (Lemur Vehicle Monitors) | Not stated (multi-PID interactive graphs) | Not stated | Not stated | Not stated | Capture and share live data | Enhanced codes (ABS, airbag, transmission); not PIDs | Not stated | App free, no in-app purchases listed (CA storefront); sensor $139.95 USD on US store | Yes, CA App Store | [SRC: https://apps.apple.com/ca/app/id445403397, accessed 2026-10-02] [SRC: https://us.bluedriver.com/products/bluedriver-scan-tool, accessed 2026-10-02] |
| FIXD | Live Data feature exists; gauge view not stated | Not stated | Not stated | "Guardian alerts" (scope not stated) | Premium "Drive Analysis" records a test drive | Not stated | Not stated | Premium CA$129.99/yr, CA$17.99/mo, CA$9.99/wk (CA storefront) | Yes, CA App Store | [SRC: https://apps.apple.com/ca/app/id957168651, accessed 2026-10-02] |
| Carista (Prizmos) | Live data monitoring; gauge layout not stated | Not stated (cluster-theme coding is a car feature, not an app layout) | Not stated | Not stated | Not stated | Manufacturer-specific module diagnostics; DPF regeneration service function | Yes, CarPlay shows basic OBD2 live data | Pro subscription; CA storefront lists tiers incl. CA$19.99/month and CA$79.99; description quotes GBP | Yes, CA App Store | [SRC: https://apps.apple.com/ca/app/id954363569, accessed 2026-10-02] |
| Torque Pro (Ian Hawkins, Android only) | Yes, own dashboard of widgets/gauges | Yes (themes) | Yes (HUD mode) | Yes (alarms with voice) | Yes (CSV/KML) | Not stated in listing | Not stated | One-time purchase, rendered as $4.95 to a non-Canadian request; GAP: CAD price | GAP: Canadian Play availability not verifiable from our location | [SRC: https://play.google.com/store/apps/details?id=org.prowl.torque&hl=en_CA&gl=CA, accessed 2026-10-02] |
| Car Scanner ELM OBD2 | Yes, dashboard with gauges and charts | Yes (own layout) | Yes (HUD windshield mode) | Not stated | Not stated | Custom extended PIDs; extra features for many makes; GAP: diesel EGT/DPF | Not stated (a user review mentions CarPlay; unverified) | Pro forever CA$9.99; 1 yr CA$6.49; 6 mo CA$5.49 (CA storefront) | Yes, CA App Store | [SRC: https://apps.apple.com/ca/app/id1259933623, accessed 2026-10-02] |
| DashCommand (listed developer: Auto Meter Products, Inc.) | Yes, OBD-II dashboards | Yes, customizable display | Not stated | Yes (alarms in release notes) | Yes (data logging) | Manufacturer-specific packs by in-app purchase (GM, Ford) | Not stated | Paid app CA$12.99; packs CA$12.99 each (CA storefront) | Yes, CA App Store | [SRC: https://apps.apple.com/ca/app/id321293183, accessed 2026-10-02] |
| **RepairSolutions2 (Innova)** | **No gauge view stated.** Live data is a customizable feed with line graphs | Choose data inputs; no layout/theme stated | Not stated | Not stated | Yes, records and replays live-data sessions | Network scan and module scans (codes); GAP: diesel PIDs | Not stated | App free; in-app: 1-Month MOTOR Report CA$19.99, 1-Year MOTOR Report CA$39.99, Vehicle History Report CA$12.99 (CA storefront) | Yes, CA App Store; Android listing exists (1M+ downloads) | [SRC: https://apps.apple.com/ca/app/id1462864362, accessed 2026-10-02] [SRC: https://play.google.com/store/apps/details?id=com.innova.rs2&hl=en_CA&gl=CA, accessed 2026-10-02] |
| **CarMD Connect (CarMD.com Corp.)** | No gauge view stated; "insights from your vehicle's live data", health monitoring | Not stated | Not stated | Vehicle health alerts | Not stated | Not stated | Not stated | App free, no subscription; device $99.98 USD (carmd.com) | **Not on CA App Store** (CA URL returned 404); US App Store yes; GAP: Android/Canada | [SRC: https://apps.apple.com/us/app/id6738333261, accessed 2026-10-02] [SRC: https://apps.apple.com/ca/app/id6738333261, accessed 2026-10-02] [SRC: https://carmd.com/products/carmd-connect, accessed 2026-10-02] |

What the matrix shows (web facts only):

- The gauge-display apps (OBDLink, Torque Pro, Car Scanner, DashCommand) all offer custom dashboards. Most also offer HUD mode, alarms and logging. Neither RS2 nor CarMD Connect describes a gauge or dashboard view today. RS2 has the closest building block: a customizable live-data feed with graphs and recorded sessions [SRC: https://apps.apple.com/ca/app/id1462864362, accessed 2026-10-02].
- On the Canadian iOS storefront, CarMD Connect is absent. CarMD's Canadian developer page lists only CarMD Pro Scan 2.0, a repair-shop tool [SRC: https://apps.apple.com/ca/developer/carmd-com-corporation/id996226191, accessed 2026-10-02]. As of 2026-10-02, "add to CarMD" cannot reach Canadian iPhone users without a storefront release.
- RS2-compatible Innova hardware is on Canadian shelves. Lordco lists Innova 3215RS at CA$159.99 [SRC: https://lordco.com/Product/Wireless-Bluetooth-OBD2-Scanner-No-Subscription-iPhone-Android-Compatibility-Read-Erase-ABS-SRS-Check-Engine-Light-View-and-Graph-Live-Data-Free-Fix-and-Part-Recommendations-3833215RS, accessed 2026-10-02] and 3210RS at CA$75.99 [SRC: https://lordco.com/Product/Code-Scanner-Free-App-With-No-Subscription-Battery-Charging-System-Test-Graph-Record-Live-Data-Read-Clear-Check-Engine-Light-Free-Fix-and-Part-Recommendations-3833210RS, accessed 2026-10-02]. NAPA Canada lists the Innova Drive OBD2 Dongle 3215RS at CA$211.99, the 3210RS at CA$99.99 and the 3020RS at CA$105.99 [SRC: https://www.napacanada.com/en/search?text=obd2&referer=v2, accessed 2026-10-02]. A Model 2 gauge feature would therefore reach Innova hardware that is already listed at Lordco and NAPA Canada. GAP: Canadian unit sell-in of these dongles.
- Diesel-specific live PIDs (EGT, DPF soot load, trans temp) are not documented for any app except as OEM add-ons (OBDLink) or service functions (Carista DPF regeneration). GAP: per-app diesel PID lists.

### 6.2 Model-B demand proxy (placeholder)

- amazon.ca code-reader Type = Dongle, by dongle price tier: observed export revenue and units [WB: TBD], and Innova's position in that tier [WB: TBD].
- If Innova dongle listings are absent: "zero Innova dongle listings in this dataset" [WB: TBD].

## 7 Decision criteria & verdicts

_Placeholder: scorecard filled after Sections 2, 3 and 5 are populated._

- Criteria (draft): demand evidence on amazon.ca [WB: TBD]; channel evidence (Lordco sell-through, Section 8 GAP); price-tier headroom [WB: TBD]; build effort (Model 2 reuses RS2 live data, Section 6.1); regulatory exposure (tuning vs monitor-only; "CA Edition" = CARB, Section 4.3).
- Verdict per model: GO / NO-GO / NEED-DATA, with the deciding evidence tag for each [WB: TBD].
- Explicit statement of what would flip each verdict.

## 8 Data gaps & next pulls

Status key: **confirmed** = this research looked for the item and did not find it. **assumed** = not researched in this track and believed missing.

### 8.1 Helium 10 pulls to request (amazon.ca)

1. **Black Box by the nodes where the units actually sit (confirmed).** No "Performance Tuners/Programmers" node was observed on any amazon.ca listing checked. The units are spread across these nodes:
   - Bully Dog GT gas and diesel: *Engines & Engine Parts > Engine Management Systems* [SRC: https://www.amazon.ca/dp/B001T8J4YK, accessed 2026-10-02] [SRC: https://www.amazon.ca/dp/B001P20QDS, accessed 2026-10-02]
   - Edge Evolution CTS3: *Lighting & Electrical > Gauges > Specialty* [SRC: https://www.amazon.ca/dp/B08N824D1J, accessed 2026-10-02]
   - Edge Insight CTS3: *Diagnostic & Test Tools > Code Readers & Scan Tools* [SRC: https://www.amazon.ca/dp/B087WMGLF1, accessed 2026-10-02]
   - OBD+GPS HUDs: *Gauges > Speedometers* [SRC: https://www.amazon.ca/dp/B0957S3F3H, accessed 2026-10-02]
   - Banks iDash: *Ignition Parts > Engine Computers* [SRC: https://www.amazon.ca/dp/B084KPRZ9J, accessed 2026-10-02]
   - Superchips Flashpaq: *Tools & Equipment > Diagnostic & Test Tools* [SRC: https://www.amazon.ca/dp/B017J844SY, accessed 2026-10-02]

   Request an amazon.ca Black Box pull of Engine Management Systems, Gauges > Specialty, Gauges > Speedometers (plus any sibling Gauges sub-nodes such as multi-gauge or information-display nodes; their names were not verified) and Engine Computers. Use no OBD keyword filter, so that Bully Dog GT diesel, the full Edge Evolution / Juice / Insight family, Banks and Superchips are captured. Flag: the brief's node name "Performance Tuners/Programmers" could not be verified on amazon.ca. Use the node names above.
2. **The same nodes on amazon.com (assumed).** Needed for a like-for-like US benchmark. It is assumed but not verified that the US nodes carry the same names.
3. **Helium 10 Xray / Trends 12-month history (assumed)** for the top in-scope CA ASINs and for the Lordco-type ASINs in Section 4.2 (B001T8J4YK, B001P20QDS, B06XWVYJGV, B01602JWV4, B087WMGLF1, B08N824D1J). These replace the "Last Year Sales" / "Sales YoY %" vendor proxies with a monthly series.
4. **Export-window check (assumed).** Record each export file's date range, so that "September 2026" is not inferred from the export date alone.

### 8.2 Non-Amazon gaps

| Gap | Status | What was found / where to get it |
|---|---|---|
| Lordco SKU list per store (which 3 gas + 2 diesel) and on-hand depth | confirmed | The online catalogue shows candidate SKUs and an online stock flag only (Section 4.4). Ask through Innova's sales contact at Lordco. |
| Lordco sell-through (units/store/month or turns) for those SKUs | confirmed | Not public. Ask through Innova's sales contact. This is the test for "doing well". |
| Canadian Tire / Princess Auto in-store shelf presence | confirmed (online only) | Canadian Tire: no gauge-tuner units online. Princess Auto: OBD+GPS HUD and GPS HUDs only (Section 4.1). In-store not observed. |
| NAPA Canada / PartSource | confirmed (online only) | No gauge-tuner units returned by site search (Section 4.1). |
| Innova Canadian distributor sell-in (3215RS / 3210RS and others) | assumed | Internal Innova data; not researched here. Innova dongles are listed at Lordco and NAPA Canada (Section 6.1). |
| Bully Dog Canadian reseller list validation | confirmed | The locator returns 1,748 Canada results, unvalidated [SRC: https://bullydog.com/find-a-dealer/, accessed 2026-10-02]. |
| Edge Canadian dealer coverage | confirmed | No dealer locator link found on edgeproducts.com. Ask Holley/Edge or Lordco. |
| Bully Dog 40428 "export / Canada only" difference vs 40420 | confirmed | Not documented on the Lordco or amazon.ca pages. |
| CarMD Connect on Android in Canada; CarMD Canada launch plans | confirmed (iOS absent) / assumed (Android) | The CA App Store URL returns 404 [SRC: https://apps.apple.com/ca/app/id6738333261, accessed 2026-10-02]. Android not checked. |
| Torque Pro CAD price and Canadian Play availability | confirmed | The Play page rendered to a non-Canadian request; needs a Canadian Play account. |
| Per-app diesel PID coverage (EGT, DPF, trans temp) | confirmed | Not stated in store listings (Section 6.1). |
| Canadian light-duty diesel fleet size by province | assumed | Not researched. Needed before any channel sizing. This memo does not extrapolate a Canada-wide market size. |

## Appendix (sources, method, taxonomy, scripts)

### A.1 Sources

Mirrors `ca_market_reports/memo/sources_202609.csv` (one row per claim; all accessed 2026-10-02).

| # | Source | Publisher | Claim | Quote (≤15 words) | Section |
|---|---|---|---|---|---|
| 1 | [SRC: https://lordco.com/our-story/, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco was founded in 1974 in Maple Ridge, British Columbia; it describes itself as Canada's biggest privately held automotive parts distributor and Western Canada's largest distributor and retailer of aftermarket parts, with over 85 stores including eighteen truck centres; it expanded into Alberta in 2019 (Calgary). | Canada’s biggest privately held automotive parts distributor | 1 |
| 2 | [SRC: https://lordco.com/Product/GT-Platinum-Gas-Gauge-Tuner-BDT40417, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco online catalogue lists Bully Dog GT Platinum Gas Gauge Tuner, part BDT40417, CA$554.61, in stock online (in-store pickup offered). | GT Platinum Gas Gauge Tuner \| BDT40417 | 4 |
| 3 | [SRC: https://lordco.com/Product/GT-diesel-vehicle-tuner-and-multi-gauge-vehicle-monitor-BDT40420, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists Bully Dog GT diesel tuner and multi-gauge vehicle monitor, part BDT40420, CA$554.46, in stock online. | GT diesel, vehicle tuner and multi-gauge vehicle monitor | 4 |
| 4 | [SRC: https://lordco.com/Product/GT-Diesel-Plus-FOR-EXPORT-ONLY-BDT40428, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists Bully Dog GT Diesel Plus (export-only SKU), part BDT40428, CA$1150.00, in stock online. | GT Diesel Plus -FOR EXPORT ONLY | 4 |
| 5 | [SRC: https://lordco.com/Product/GTX-Performance-Tuner-BDT40460B, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists Bully Dog GTX Performance Tuner, part BDT40460B, CA$966.77, in stock online. | GTX Performance Tuner | 4 |
| 6 | [SRC: https://lordco.com/Product/BDX-Performance-Programmer-BDT40470, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists Bully Dog BDX Performance Programmer, part BDT40470, CA$582.25, in stock online. | BDX Performance Programmer | 4 |
| 7 | [SRC: https://lordco.com/Product/BDX-hand-held-performance-tuner-L5P-Only-BDT40472, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists Bully Dog BDX hand-held performance tuner (L5P only), part BDT40472, CA$830.49, in stock online. | BDX hand-held performance tuner (L5P Only) | 4 |
| 8 | [SRC: https://lordco.com/Brand/Bully-Dog, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco has a Bully Dog brand page; 21 Bully Dog products were listed across two pages on 2026-10-02 (tuners plus mounts, cables, sensor docks). | — | 4 |
| 9 | [SRC: https://lordco.com/Product/Insight-CTS3-Digital-Gauge-Monitor-PTQ84130-3, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists the Edge Insight CTS3 Digital Gauge Monitor under the brand Powerteq, part PTQ84130-3, CA$769.99, in stock online. | Insight CTS3 Digital Gauge Monitor | 4 |
| 10 | [SRC: https://lordco.com/search.php?search_query=Evolution+CTS3, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco site search for 'Evolution CTS3' returned the Insight CTS3 monitor and wiper blades; no Edge Evolution CTS3 tuner was returned. | — | 4 |
| 11 | [SRC: https://lordco.com/Product/Diablo-Sport-TRINITY-DASHBOARD-MONITOR-TUNER-PTQT1000, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists DiabloSport Trinity dashboard monitor and tuner, part PTQT1000, CA$764.01, in stock online. | TRINITY DASHBOARD MONITOR & TUNER | 4 |
| 12 | [SRC: https://lordco.com/Product/DiabloSport-Trinity-2-T2-EX-Ford-Vehicles-PTQ9100, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists DiabloSport Trinity 2 (T2 EX) for Ford vehicles, part PTQ9100, CA$1049.99, in stock online. | Trinity 2 (T2 EX) Ford Vehicles | 4 |
| 13 | [SRC: https://lordco.com/Product/DiabloSport-Trinity-2-T2-EX-for-Dodge-Vehicles-PTQ9300, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists DiabloSport Trinity 2 (T2 EX) for Dodge vehicles, part PTQ9300, CA$1079.98, in stock online. | Trinity 2 (T2 EX) for Dodge Vehicles | 4 |
| 14 | [SRC: https://lordco.com/Product/Ford-Livewire-TS-Pre-Programmed-Device-SCT5015P, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists SCT Performance Ford Livewire TS pre-programmed device, part SCT5015P, CA$721.41, in stock online. | Ford Livewire TS Pre-Programmed Device | 4 |
| 15 | [SRC: https://lordco.com/search.php?search_query=scangauge, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco site search for 'ScanGauge' returned 0 results. | — | 4 |
| 16 | [SRC: https://lordco.com/search.php?search_query=iDash, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco site search for 'iDash' (Banks) returned 0 results. | — | 4 |
| 17 | [SRC: https://lordco.com/search.php?search_query=DataMonster, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco site search for 'DataMonster' (Banks iDash 1.8 DataMonster) returned 0 results. | — | 4 |
| 18 | [SRC: https://lordco.com/search.php?search_query=Flashpaq, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco site search for 'Flashpaq' (Superchips) returned 0 results. | — | 4 |
| 19 | [SRC: https://lordco.com/search.php?search_query=Dashpaq, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco site search for 'Dashpaq' (Superchips) returned 0 results. | — | 4 |
| 20 | [SRC: https://lordco.com/search.php?search_query=ultragauge, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco site search for 'UltraGauge' returned 0 results. | — | 4 |
| 21 | [SRC: https://bullydog.com/, accessed 2026-10-02] | Bully Dog (bullydog.com) | Bully Dog says it merged under Derive Systems together with Bully Dog Big Rig, SCT and VQ; the site still sells the GT Platinum Gas Tuner (part 40410, labelled 50 State Legal), GT Gas Performance Tuner & Monitor (40417) and GT Diesel Performance Tuner & Monitor (40420) on 2026-10-02; prices are shown on the US site only (USD). | As a result of its recent merger under Derive Systems | 4 |
| 22 | [SRC: https://bullydog.com/find-a-dealer/, accessed 2026-10-02] | Bully Dog (bullydog.com) | Bully Dog reseller locator with Location=International and country=Canada returned 1,748 reseller results (first page: Alberta resellers); entries not validated. | NEARBY RESELLERS 1 - 15 of 1,748 results | 4 |
| 23 | [SRC: https://www.sec.gov/Archives/edgar/data/1822928/000162828026018218/hlly-20251231.htm, accessed 2026-10-02] | Holley Inc. Form 10-K for FY2025 (SEC EDGAR) | Holley's FY2025 10-K names EDGE among its brands and says it sells primarily in the United States, Canada and Europe. | Holley, Holley EFI, MSD, Simpson, Flowmaster, EDGE, Cataclean, and Accel | 4 |
| 24 | [SRC: https://www.edgeproducts.com/products/in-cabin_monitors/insight/, accessed 2026-10-02] | Edge Products (edgeproducts.com; schema publisher holley.com) | Edge's own page sells Insight CTS3 part 84130-3 (USD, US site) and says it can give audible and visual alerts; page schema names Holley as publisher and links Holley's privacy policy; no dealer locator link was found on the site. | The Insight CTS3 can also be configured to provide audible and visual alerts | 4 |
| 25 | [SRC: https://www.edgeproducts.com/products/in-cabin_tuners/evolution_cts3/, accessed 2026-10-02] | Edge Products (edgeproducts.com) | Edge's catalogue numbers Evolution CTS3 diesel units 85400-100 (Power Stroke), 85400-200 (Duramax), 85400-300 (Cummins); gas units 85450-150 (Ford gas), 85450-250 (GM gas), 85452-xxx (GM gas); 85401-101 is the '50 STATE LEGAL' Power Stroke unit. | EVOLUTION CTS3 - 50 STATE LEGAL | 4 |
| 26 | [SRC: https://www.edgeproducts.com/products/in-cabin_monitors/insightplus/, accessed 2026-10-02] | Edge Products (edgeproducts.com) | Edge launched Insight+ (part 84140), built on Insight CTS3, adding a tune licence for third-party calibrators on Ford Power Stroke and GM Duramax diesel trucks. | Built on the industry-leading Insight CTS3 platform | 4 |
| 27 | [SRC: https://liftkits4less.com/ford-diesel-evolution-cts3-ca-1994-5-2019-ford-f-250-f-350-powerstroke-diesel-50-state-legal-edge-products, accessed 2026-10-02] | Lift Kits 4 Less (US third-party reseller) | Reseller listing of Edge 'Ford Diesel Evolution CTS3 CA' states it carries CARB Executive Order approval making it 50-state legal, i.e. the 'CA' suffix denotes California/CARB. | comes with CARB Executive Order (EO) approval, making it 50-state legal | 4 |
| 28 | [SRC: https://www.jbtools.com/edge-gas-diesel-vehicle-tuner-evoht2-california-edition-86040/, accessed 2026-10-02] | JB Tools (US third-party reseller) | Reseller titles Edge part 86040 as the EvoHT2 'California Edition', confirming Edge's California-edition naming. | Edge Gas & Diesel Vehicle Tuner EvoHT2 California Edition (86040) | 4 |
| 29 | [SRC: https://theshopmag.com/news/edge-products-announces-extensive-diesel-executive-order-coverage-carb, accessed 2026-10-02] | The Shop magazine (trade press, 2018-02-23) | Edge received consolidated CARB Executive Order D-541-18 covering its 50-state-legal diesel products. | Executive Order D-541-18, detailing the far-reaching 50 state legal diesel coverage | 4 |
| 30 | [SRC: https://www.canadiantire.ca/en/search-results.html?q=bully%20dog%20tuner, accessed 2026-10-02] | Canadian Tire (canadiantire.ca) | Canadian Tire site search 'bully dog tuner' was rewritten to 'tuner' and returned 7 results, none a vehicle tuner or gauge (wheel locks, radio, antennas). | — | 4 |
| 31 | [SRC: https://www.canadiantire.ca/en/search-results.html?q=edge%20insight, accessed 2026-10-02] | Canadian Tire (canadiantire.ca) | Canadian Tire site search 'edge insight' returned 1 unrelated result (robot vacuum). | — | 4 |
| 32 | [SRC: https://www.canadiantire.ca/en/search-results.html?q=performance%20tuner, accessed 2026-10-02] | Canadian Tire (canadiantire.ca) | Canadian Tire site search 'performance tuner' returned 5 results, none a vehicle tuner (radio, TV antennas). | — | 4 |
| 33 | [SRC: https://www.canadiantire.ca/en/search-results.html?q=scangauge, accessed 2026-10-02] | Canadian Tire (canadiantire.ca) | Canadian Tire site search 'scangauge' (rewritten to 'scan gauge') returned 3 TPMS sensors and no OBD gauge. | — | 4 |
| 34 | [SRC: https://www.princessauto.com/en/product/obd-plus-gps-smart-gauge/PA0009465543/9465543, accessed 2026-10-02] | Princess Auto (princessauto.com) | Princess Auto sells the Mr. Blacksmith OBD Plus GPS Smart Gauge, SKU 9465543, CA$49.99 (Hot Buy), head-up display type, OBD connection, MPH/km/h switchable. | Dial Gauge readout is switchable from MPH to km/h. | 4 |
| 35 | [SRC: https://www.princessauto.com/en/search?q=heads+up+display, accessed 2026-10-02] | Princess Auto (princessauto.com) | Princess Auto 'heads up display' search returned 7 products incl. Powerfist Windshield Projection Heads-Up Display GPS Speedometer SKU 9198797 CA$39.99 and Powerfist Digital GPS Speedometer SKU 9198805 CA$49.99 (GPS-only). | Windshield Projection Heads-Up Display GPS Speedometer | 4 |
| 36 | [SRC: https://www.princessauto.com/en/search?q=gauge+tuner, accessed 2026-10-02] | Princess Auto (princessauto.com) | Princess Auto 'gauge tuner' search returned 20 products (analog LED gauges, testers, Autel PS100); no tuner or gauge-tuner unit. | — | 4 |
| 37 | [SRC: https://www.napacanada.com/en/search?text=bully%20dog&referer=v2, accessed 2026-10-02] | NAPA Auto Parts Canada (napacanada.com, UAP Inc.) | NAPA Canada site search 'bully dog' rendered no product results. | — | 4 |
| 38 | [SRC: https://www.napacanada.com/en/search?text=performance%20tuner&referer=v2, accessed 2026-10-02] | NAPA Auto Parts Canada (napacanada.com, UAP Inc.) | NAPA Canada site search 'performance tuner' rendered no product results. | — | 4 |
| 39 | [SRC: https://www.napacanada.com/en/search?text=edge%20insight&referer=v2, accessed 2026-10-02] | NAPA Auto Parts Canada (napacanada.com, UAP Inc.) | NAPA Canada site search 'edge insight' rendered no product results. | — | 4 |
| 40 | [SRC: https://partsource.ca/search?q=bully+dog, accessed 2026-10-02] | PartSource (partsource.ca) | PartSource site search 'bully dog' returned 0 results. | — | 4 |
| 41 | [SRC: https://partsource.ca/search?q=performance+tuner, accessed 2026-10-02] | PartSource (partsource.ca) | PartSource site search 'performance tuner' returned 2 Equus analog gauges and no tuner. | — | 4 |
| 42 | [SRC: https://partsource.ca/search?q=heads+up+display, accessed 2026-10-02] | PartSource (partsource.ca) | PartSource site search 'heads up display' returned 0 results. | — | 4 |
| 43 | [SRC: https://partsource.ca/search?q=edge+insight, accessed 2026-10-02] | PartSource (partsource.ca) | PartSource site search 'edge insight' returned 66 unrelated results (wiper, brake, gasket parts); no Edge product. | — | 4 |
| 44 | [SRC: https://www.amazon.ca/s?k=bully+dog+gt+tuner, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca search on 2026-10-02 showed Bully Dog 40420 GT Platinum Diesel (B001T8J4YK) CA$515.38, 40410 Triple Dog GT Gas (B001P20QDS) CA$538.80, 40417 Triple Dog Platinum GT Gas (B06XWVYJGV) CA$498.79, 40430 Hemi Plus (B00AJLY628) CA$580.80, '40428canada Only Part' (B01602JWV4) CA$899.00, Edge 84130-3 Insight CTS3 (B087WMGLF1) CA$662.83. | 40428canada Only Part | 4 |
| 45 | [SRC: https://www.amazon.ca/s?k=edge+evolution+cts3, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca search on 2026-10-02 showed Edge Evolution CTS3 85400-200 (B08N824D1J) CA$1,022.98, 85400-300 (B09JL42PPV) CA$1,022.98, 85400-100 (B08YJQCTH2) CA$1,022.98, 85401-201 'CA Edition' (B08YJLFVW7) CA$1,085.34, 85452-252 GM gas (B08YJHM4QJ) CA$1,109.03. | Edge 85401-201 Evolution CTS3 Programmer - CA Edition | 4 |
| 46 | [SRC: https://www.amazon.ca/s?k=banks+idash, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca search on 2026-10-02 showed Banks iDash 1.8 DataMonster 66760 (B084KPRZ9J) CA$789.38, iDash 1.8 Super Gauge (B079WV5GXC) CA$876.42, iDash Data Pro (B0GNCW4XKM) CA$772.25. | Banks iDash 1.8 DataMonster | 4 |
| 47 | [SRC: https://www.amazon.ca/s?k=scangauge, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca search on 2026-10-02 showed ScanGauge II SGIIFFP (B00VX2NOK2) CA$229.95 and ScanGauge 3 SG3 (B0BFBQZZMC) CA$407.59. | 3 Touch Screen OBD2 Scanner, Digital Gauges & Trip Computer SG3 | 4 |
| 48 | [SRC: https://www.amazon.ca/s?k=superchips+flashpaq, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca search on 2026-10-02 showed Superchips Flashpaq F5 2845 (B017J844SY) CA$647.77 and 4845 Flashpaq F5 California Edition (B017J7SKUS) CA$646.37. | 4845 Flashpaq F5 California Edition Tuner | 4 |
| 49 | [SRC: https://www.amazon.ca/s?k=superchips+dashpaq, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca search on 2026-10-02 showed Superchips Dashpaq+ 20501 (B09Z7BTBW4) CA$1,317.82 and Dashpaq 1050 for Ford diesel (B07232K7PS) CA$1,067.24. | 1050 Dashpaq for Ford Diesel Vehicle | 4 |
| 50 | [SRC: https://www.amazon.ca/s?k=ultragauge, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca search on 2026-10-02 returned UltraGauge-branded listings (B0HC61NG3H CA$127.63; B0H1GKDT6S CA$137.64) titled MX V1.3; seller authenticity not verified. | UltraGauge Transmission Temperature Sensor OBD2 Readout Tool | 4 |
| 51 | [SRC: https://www.amazon.ca/dp/B001T8J4YK, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca breadcrumb for Bully Dog 40420 GT Platinum Diesel is Automotive > Replacement Parts > Engines & Engine Parts > Engine Management Systems. | Engine Management Systems | 8 |
| 52 | [SRC: https://www.amazon.ca/dp/B001P20QDS, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca breadcrumb for Bully Dog 40410 Triple Dog GT Gas Gauge Tuner is Automotive > Replacement Parts > Engines & Engine Parts > Engine Management Systems. | Engine Management Systems | 8 |
| 53 | [SRC: https://www.amazon.ca/dp/B08N824D1J, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca breadcrumb for Edge 85400-200 Evolution CTS3 is Automotive > Replacement Parts > Lighting & Electrical > Gauges > Specialty. | Gauges › Specialty | 8 |
| 54 | [SRC: https://www.amazon.ca/dp/B087WMGLF1, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca breadcrumb for Edge 84130-3 Insight CTS3 is Automotive > Tools & Equipment > Diagnostic & Test Tools > Code Readers & Scan Tools. | Code Readers & Scan Tools | 8 |
| 55 | [SRC: https://www.amazon.ca/dp/B0957S3F3H, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca breadcrumb for wiiyii P6 OBD+GPS HUD is Automotive > Replacement Parts > Lighting & Electrical > Gauges > Speedometers. | Gauges › Speedometers | 8 |
| 56 | [SRC: https://www.amazon.ca/dp/B084KPRZ9J, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca breadcrumb for Banks iDash 1.8 DataMonster is Automotive > Replacement Parts > Ignition Parts > Engine Computers. | Engine Computers | 8 |
| 57 | [SRC: https://www.amazon.ca/dp/B017J844SY, accessed 2026-10-02] | Amazon.ca (live listing page; not a Helium 10 figure) | amazon.ca breadcrumb for Superchips 2845 Flashpaq F5 is Automotive > Tools & Equipment > Diagnostic & Test Tools. | Diagnostic & Test Tools | 8 |
| 58 | [SRC: https://lordco.com/Product/Wireless-Bluetooth-OBD2-Scanner-No-Subscription-iPhone-Android-Compatibility-Read-Erase-ABS-SRS-Check-Engine-Light-View-and-Graph-Live-Data-Free-Fix-and-Part-Recommendations-3833215RS, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists Innova 3215RS wireless Bluetooth OBD2 scanner (part 3833215RS) at CA$159.99, in stock online. | Wireless Bluetooth OBD2 Scanner: No Subscription | 6 |
| 59 | [SRC: https://lordco.com/Product/Code-Scanner-Free-App-With-No-Subscription-Battery-Charging-System-Test-Graph-Record-Live-Data-Read-Clear-Check-Engine-Light-Free-Fix-and-Part-Recommendations-3833210RS, accessed 2026-10-02] | Lordco Auto Parts (lordco.com) | Lordco lists Innova 3210RS code scanner with free app (part 3833210RS) at CA$75.99, in stock online. | Code Scanner: Free App With No Subscription | 6 |
| 60 | [SRC: https://www.napacanada.com/en/search?text=obd2&referer=v2, accessed 2026-10-02] | NAPA Auto Parts Canada (napacanada.com, UAP Inc.) | NAPA Canada lists Innova Drive OBD2 Dongle INO 3215RS CA$211.99, Innova Basic Bluetooth OBD2 Scanner INO 3210RS CA$99.99, Innova CAN OBD2 reader INO 3020RS CA$105.99. | Innova Drive Obd2 Dongle | 6 |
| 61 | [SRC: https://apps.apple.com/ca/app/id1462864362, accessed 2026-10-02] | Apple App Store - Canada storefront | RepairSolutions2 (Innova Electronic) is on the Canadian App Store, free with in-app purchases (1-Month MOTOR Report CA$19.99, 1-Year MOTOR Report CA$39.99, Vehicle History Report CA$12.99); live data is a customizable feed with line graphs and recorded sessions; no gauge, HUD, alarm or CarPlay feature is described. | Access a customizable LIVE data feed with the ability to choose specific data inputs | 6 |
| 62 | [SRC: https://play.google.com/store/apps/details?id=com.innova.rs2&hl=en_CA&gl=CA, accessed 2026-10-02] | Google Play | RepairSolutions2 Android listing (com.innova.rs2): 1M+ downloads, in-app purchases, same customizable LIVE data feed text; no gauge or Android Auto feature described. | create line graphs, record and access previous LIVE data recording sessions | 6 |
| 63 | [SRC: https://apps.apple.com/us/app/id6738333261, accessed 2026-10-02] | Apple App Store - US storefront | CarMD Connect (CarMD.com Corporation) is on the US App Store, free, iPhone only; offers vehicle health monitoring, alerts, location sharing; says no subscriptions; no gauge/live-data dashboard described. | No subscriptions. No hidden fees. | 6 |
| 64 | [SRC: https://apps.apple.com/ca/app/id6738333261, accessed 2026-10-02] | Apple App Store - Canada storefront | The Canadian App Store URL for CarMD Connect (id6738333261) returned HTTP 404 on 2026-10-02, i.e. not listed on the Canadian iOS storefront. | — | 6 |
| 65 | [SRC: https://apps.apple.com/ca/developer/carmd-com-corporation/id996226191, accessed 2026-10-02] | Apple App Store - Canada storefront | CarMD.com Corporation's Canadian developer page lists only CarMD Pro Scan 2.0 (a repair-shop business tool); CarMD Connect is absent. | — | 6 |
| 66 | [SRC: https://carmd.com/products/carmd-connect, accessed 2026-10-02] | CarMD (carmd.com) | CarMD Connect device priced $99.98 USD on carmd.com with free app and no subscription; page cites insights from the vehicle's live data. | Personalized insights from your vehicle's live data | 6 |
| 67 | [SRC: https://apps.apple.com/ca/app/id879636351, accessed 2026-10-02] | Apple App Store - Canada storefront | OBDLink app (OBD Solutions) on the Canadian App Store: customizable dashboards, HUD mode on dashboards, configurable Alerts, CSV data logging, enhanced diagnostics add-ons (e.g. Ford, FCA, Toyota) at CA$19.99 each, free OEM add-ons with MX+; works only with OBDLink adapters. | MX+ provides Unlimited Free OEM Add-ons, No in-app fees | 6 |
| 68 | [SRC: https://apps.apple.com/ca/app/id445403397, accessed 2026-10-02] | Apple App Store - Canada storefront | BlueDriver app (Lemur Vehicle Monitors) on the Canadian App Store is free with no in-app purchases listed; live data with multi-PID interactive graphing; enhanced codes (ABS, transmission); no gauge dashboard, HUD or alarms described. | View live data with multi-PID interactive graphing | 6 |
| 69 | [SRC: https://us.bluedriver.com/products/bluedriver-scan-tool, accessed 2026-10-02] | BlueDriver (us.bluedriver.com, US store) | BlueDriver Pro sensor listed at $139.95 on the US store (USD); live data can be captured and shared. | Capture and share any live data supported by the vehicle. | 6 |
| 70 | [SRC: https://apps.apple.com/ca/app/id957168651, accessed 2026-10-02] | Apple App Store - Canada storefront | FIXD app on the Canadian App Store: FIXD Premium yearly CA$129.99, monthly CA$17.99, weekly CA$9.99; release notes mention Live Data, Guardian alerts and Premium Drive Analysis (records a test drive). | record a test drive and get an AI health summary | 6 |
| 71 | [SRC: https://apps.apple.com/ca/app/id954363569, accessed 2026-10-02] | Apple App Store - Canada storefront | Carista OBD2 on the Canadian App Store: live data, manufacturer-specific module diagnostics, DPF regeneration service function, Apple CarPlay shows basic OBD2 live data; in-app purchase list shows Pro tiers incl. 1 month Pro CA$19.99 and Pro CA$79.99; description quotes GBP pricing. | Apple CarPlay support: view basic OBD2 live data on your car's screen | 6 |
| 72 | [SRC: https://apps.apple.com/ca/app/id1259933623, accessed 2026-10-02] | Apple App Store - Canada storefront | Car Scanner ELM OBD2 on the Canadian App Store: own dashboard with gauges and charts, custom extended PIDs, HUD mode for windshield projection; Pro forever CA$9.99, 1 year CA$6.49, 6 months CA$5.49. | Layout your own dashboard with the gauges and charts you want! | 6 |
| 73 | [SRC: https://apps.apple.com/ca/app/id321293183, accessed 2026-10-02] | Apple App Store - Canada storefront | DashCommand (developer Auto Meter Products, Inc.) on the Canadian App Store: paid CA$12.99, OBD-II dashboards, data logging, alarms, manufacturer-specific data packs via in-app purchase (e.g. GM/Ford packs CA$12.99 each). | Transform your iPhone into a customizable display and monitoring system. | 6 |
| 74 | [SRC: https://play.google.com/store/apps/details?id=org.prowl.torque&hl=en_CA&gl=CA, accessed 2026-10-02] | Google Play | Torque Pro (Ian Hawkins, Android): custom dashboard widgets/gauges, themes, HUD mode, alarms with voice, CSV/KML log export; listed $4.95 one-time (currency as rendered to a non-Canadian request, CAD not confirmed); 1M+ downloads. | Heads up display / HUD mode for night time driving | 6 |

### A.2 Method

- **Web research:** done on 2026-10-02 from retailer sites (lordco.com, canadiantire.ca, princessauto.com, napacanada.com, partsource.ca), manufacturer sites (bullydog.com, edgeproducts.com, carmd.com, us.bluedriver.com), Holley's SEC 10-K, Apple App Store (Canadian storefront unless noted), Google Play, and amazon.ca search and listing pages. Third-party resellers and trade press are marked as such in the sources.
- **Retail checks:** online catalogue and site search only. Lordco pages were read as server-rendered HTML (BigCommerce product JSON gives price, currency CAD and the in-stock flag). Client-rendered sites (Canadian Tire, Princess Auto, NAPA Canada, PartSource, amazon.ca) were read in a browser. Cookie banners were declined. In-store stock was not observed.
- **Amazon numbers:** every Helium 10-derived figure (revenue, units, price, YoY, listing counts) will come from the month's workbooks and carry a `[WB: …]` tag. The `[WB: TBD]` markers are placeholders for that. amazon.ca live prices in Section 4.2 are point-in-time page observations, not Helium 10 data.
- **Currency:** CAD figures come from Canadian sites and storefronts. USD figures (bullydog.com, edgeproducts.com, carmd.com, us.bluedriver.com) are labelled USD and are not compared with CAD figures.

### A.3 Gauge taxonomy (from `ca_common.GAUGE_CLASSES` / `GAUGE_SUBTYPE_LABELS`; first matching rule wins, ASIN map overrides)

| Code | Class | Label | Role |
|---|---|---|---|
| XN | excluded_non_gauge | Excluded - not a gauge | excluded |
| XD | excluded_app_dongle | Excluded - app dongle | excluded |
| AC | gauge_accessory | Gauge accessory | in scope, accessory section |
| TD | tuner_with_gauge_display | Tuner with gauge display | device (Lordco-type) |
| TM | truck_gauge_monitor | Truck gauge monitor | device (Lordco-type) |
| HG | obd_gps_hud | OBD+GPS HUD | device |
| HO | obd_hud | OBD HUD | device |
| GH | gps_hud | GPS-only HUD (adjacent) | adjacent, excluded from OBD totals |
| GD | gauge_display | Gauge display | device |
| AMB | ambiguous | Ambiguous - needs review | review queue / Excluded tab |

### A.4 Scripts

- `ca_market_reports/build_gauge_report.py`: builds `CA_OBD_Gauge_Competitor_Report_<month>.xlsx` (and the US benchmark sheets).
- `ca_market_reports/build_ca_code_reader_report.py`: builds `CA_Code_Reader_Competitor_Report_<month>.xlsx` and `CA_Code_Reader_Analysis_<month>.xlsx` (the Model-B dongle proxy).
- `ca_market_reports/validate_outputs.py`: checks V01–V20, including V20 (every `[WB: file!sheet!cell]` in this memo resolves and matches within ±0.5%).
