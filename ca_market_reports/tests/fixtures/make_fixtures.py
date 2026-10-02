"""Regenerates the synthetic fixtures. Run: ca_market_reports/run.sh ca_market_reports/tests/fixtures/make_fixtures.py

Fixtures carry the Helium 10 Black Box header VERBATIM (copied from a real CA export) and synthetic rows
that exercise every rule the tracks must handle. No real sales figures; ASINs are fake (B0TEST....).
"""
from __future__ import annotations
import csv
from pathlib import Path

HERE = Path(__file__).resolve().parent
HEADER = ["URL","Image URL","ASIN","Title","Brand","Fulfillment","Category","BSR","UPC","GTIN","EAN","ISBN","Subcategory",
          "Subcategory BSR","Price","Price Trend (90 days) (%)","Parent Level Sales","ASIN Sales","Sales Trend (90 days) (%)",
          "Parent Level Revenue","ASIN Revenue","Review Count","Frequently Returned Item Badge","Reviews Rating","Seller",
          "Seller Country/Region","Number of Active Sellers","Last Year Sales","Sales Year Over Year (%)","Shipping Details",
          "Length","Width","Height","Weight","Storage Fee (Jan - Sep)","Storage Fee (Oct - Dec)","Best Sales Period",
          "Listing Age (Months)","Number of Images","Variation Count","Sales to Reviews"]

def row(asin, title, brand, price, sales, revenue, *, sub="Code Readers & Scan Tools", bsr="1000", sub_bsr="50", reviews="10",
        rating="4.5", seller="SomeSeller", ly="N/A", yoy="N/A", trend="", ptrend="", age="24", fr="No", ful="FBA", var="1",
        domain="amazon.ca", image="https://m.media-amazon.com/images/I/TEST.jpg"):
    return {"URL": f"https://{domain}/dp/{asin}", "Image URL": image, "ASIN": asin, "Title": title, "Brand": brand,
            "Fulfillment": ful, "Category": "Automotive", "BSR": bsr, "UPC": "N/A", "GTIN": "N/A", "EAN": "N/A", "ISBN": "N/A",
            "Subcategory": sub, "Subcategory BSR": sub_bsr, "Price": price, "Price Trend (90 days) (%)": ptrend,
            "Parent Level Sales": sales, "ASIN Sales": sales, "Sales Trend (90 days) (%)": trend, "Parent Level Revenue": revenue,
            "ASIN Revenue": revenue, "Review Count": reviews, "Frequently Returned Item Badge": fr, "Reviews Rating": rating,
            "Seller": seller, "Seller Country/Region": "N/A", "Number of Active Sellers": "1", "Last Year Sales": ly,
            "Sales Year Over Year (%)": yoy, "Shipping Details": "Standard Size", "Length": "5", "Width": "3", "Height": "1",
            "Weight": "0.5", "Storage Fee (Jan - Sep)": "0.1", "Storage Fee (Oct - Dec)": "0.3", "Best Sales Period": "N/A",
            "Listing Age (Months)": age, "Number of Images": "6", "Variation Count": var, "Sales to Reviews": "1.0"}

# ---- code reader page 1 ----
cr1 = [
    row("B0TESTAUT1", "Autel MaxiCOM MK808S Bidirectional Tool, 2026 Android Tablet Scanner", "Autel", "659.99", "20", "13199.80", bsr="120", ly="180", yoy="33", trend="12", age="60"),
    row("B0TESTANC1", "ANCEL AD310 Classic Enhanced Universal OBD II Scanner Car Engine Fault Code Reader", "ANCEL", "39.99", "100", "3999.00", bsr="5", reviews="5000", rating="4.6", ly="1500", yoy="-20"),
    row("B0TESTINN1", "INNOVA 5610 OBD2 Bidirectional Scan Tool", "INNOVA", "463.99", "28", "12991.72", seller="Amazon", ful="Amazon", ly="574", yoy="120", age="80"),
    row("B0TESTINN2", "Innova 1000 V2 OBD2 Bluetooth Scanner - For Android & iPhone Car Scanner", "INNOVA", "173.90", "3", "521.70", seller="Dominion Pride", ly="53", age="18"),
    row("B0TESTGEN1", "FOXWELL NT530 Multi-System OBD2 Scanner for BMW with SRS ABS", "Generic", "199.00", "4", "796.00", bsr="900"),   # generic recovery -> foxwell
    row("B0TESTGEN2", "Case for Innova 5610 Scanner, Hard EVA Travel Case", "Generic", "19.99", "2", "39.98", bsr="30000"),            # must NOT be reassigned (mid-title)
    row("B0TESTOBD1", "OBDLink MX+ OBD2 Bluetooth Scanner for iPhone, Android, and Windows", "OBDLink", "209.95", "40", "8398.00", bsr="40", reviews="2000"),
    row("B0TESTBLU1", "BlueDriver OBD2 Scanner Bluetooth, No Subscription, ABS SRS TPMS", "BlueDriver", "119.95", "60", "7197.00", bsr="3", reviews="800", rating="3.9"),
    row("B0TESTEDG1", "Edge 84130-3 Insight CTS3", "EDGE", "661.00", "4", "2644.00", bsr="700", ly="33", yoy="29", age="90"),           # truck_gauge_monitor
    row("B0TESTEDG2", "Edge 85401-201 Evolution CTS3 Programmer - CA Edition", "Edge Products", "1085.34", "0", "-", bsr="90000"),       # tuner_with_gauge_display; CA Edition = California
    row("B0TESTSCG1", "ScanGauge 3 Touch Screen OBD2 Scanner, Digital Gauges & Trip Computer SG3", "ScanGauge", "389.95", "2", "779.90", bsr="2000", ly="40", yoy="64"),  # gauge_display
    row("B0TESTCAB1", "KIMISS OBD2 to HD Multimedia Interface Cable for Edge CS2 CTS2 CTS3 H00008000", "KIMISS", "36.28", "1", "41.20", bsr="50000"),  # gauge_accessory
    row("B0TESTBRK1", "LINXINO OBD2 Breakout Box OBDII Protocol Detector 16-Pin with LED Display", "LINXINO", "49.99", "3", "149.97", bsr="8000"),       # excluded_non_gauge
    row("B0TESTANC2", "ANCEL BD330 BMW OBD2 Scanner, 3-in-1 Bluetooth/Wired/HUD Mode, Battery Registration EPB", "ANCEL", "109.99", "5", "549.95", bsr="3000"),  # excluded_app_dongle / ambiguous
    row("B0TESTTAB1", "LAUNCH X431 PRO5 Car Scanner, J2534 Programming Tool, Topology Mapping", "LAUNCH", "1999.00", "1", "1999.00", bsr="40000", age="70"),  # price >= 1000 must NOT be dropped
    row("B0TESTEX40", "XTOOL D5S OBD2 Scanner ABS SRS Check Engine Code Reader", "xTool", "400.00", "2", "800.00", bsr="6000"),     # price exactly 400 -> Tablet $400-$800 (if Tablet)
    row("B0TESTNEW1", "MUCAR 892BT AI-Assisted Bidirectional Scan Tool All System 2026", "mucar", "614.00", "6", "3684.00", bsr="800", age="3"),  # not in US map -> keyword rule tablet? (bidirectional scan tool, >=380 'scanner')
    row("B0TESTCBL2", "OBD2 16 Pin Male to Female Extension Cable 1m", "Fydun", "12.99", "0", "-", bsr="150000"),                 # Cable/Adapter keyword
    row("B0TESTDUP1", "Vgate iCar Pro 2S Bluetooth OBD2 Scanner", "Vgate", "52.99", "8", "423.92", bsr="500"),                     # duplicated identical on page 2
    row("B0TESTDUP2", "VEEPEAK OBDCheck BLE Bluetooth OBD II Scanner", "VEEPEAK", "39.99", "10", "399.90", bsr="450"),              # duplicated CONFLICTING on page 2 (lower revenue there)
]
# ---- code reader page 2 (pagination overlap + rows that are gauge-like) ----
cr2 = [
    row("B0TESTDUP1", "Vgate iCar Pro 2S Bluetooth OBD2 Scanner", "Vgate", "52.99", "8", "423.92", bsr="500"),                     # identical dupe
    row("B0TESTDUP2", "VEEPEAK OBDCheck BLE Bluetooth OBD II Scanner", "VEEPEAK", "39.99", "9", "359.91", bsr="460"),               # conflicting dupe: lower revenue -> dropped
    row("B0TESTHUD1", "wiiyii Car HUD Head Up Display P6, OBD+GPS Smart Gauge, Works Great for Most Cars", "wiiyii", "59.99", "119", "7138.81", sub="Speedometers", bsr="2500", ly="87", yoy="37"),  # obd_gps_hud (also in gauge set -> source_set both)
    row("B0TESTLUF1", "Lufi XF OBD2 gague Display, Boost Gauge, Water Temperature Meter", "Lufi", "163.25", "2", "326.50", bsr="20000"),   # gauge_display (misspelt gauge)
    row("B0TESTOBD2", "OBDLink EX FORScan OBD Adapter", "OBDLink", "94.95", "50", "4747.50", bsr="60"),
    row("B0TESTKEY1", "Autel MaxiIM KM100 Key Programmer Immobilizer Tool", "Autel", "299.00", "1", "299.00", bsr="9000"),           # Key
    row("B0TESTOTH1", "Diesel Laptops Nexiq USB Link 3 Heavy Duty Truck Adapter", "Diesel Laptops", "1099.00", "2", "2198.00", bsr="7000"),  # VCI / Other
    row("B0TESTbad1", "lowercase asin row must be uppercased", "Generic", "9.99", "0", "-", bsr="999999"),                                        # asin normalization
]
# ---- gauge export page 1 ----
g1 = [
    row("B0TESTHUD1", "wiiyii Car HUD Head Up Display P6, OBD+GPS Smart Gauge, Works Great for Most Cars", "wiiyii", "59.99", "119", "7138.81", sub="Speedometers", bsr="2500", ly="87", yoy="37"),  # overlap with CR
    row("B0TESTHUD2", "Car Speedometer Gauge,OBD2 HUD Head Up Display Projector", "Keenso", "32.39", "54", "1749.06", sub="Speedometers", bsr="4236", ly="587", yoy="116"),   # obd_hud
    row("B0TESTHUD3", "Digital GPS Speedometer Universal Heads Up Display for Car 5.5 inch LCD", "SinoTrack", "32.98", "30", "989.40", sub="Speedometers", bsr="3000"),         # gps_hud (adjacent)
    row("B0TESTLUF2", "LUFI Xs OBD2 Gauge Display – Fuel Car Companion, Multi-Function & Overload Protection", "Lufi", "180.45", "6", "1082.70", sub="Multi Gauges", bsr="15000"),  # gauge_display
    row("B0TESTSHF1", "Lufi Shift Light (Blue) - Alarm Light Accessory for XF OBD2 Gauge and X1 Gauges Display", "Lufi", "12.98", "0", "-", sub="Shift Light", bsr="80000"),   # gauge_accessory
    row("B0TESTCAS1", "Car and Auto Mini Carry Case Compatible with BlueDriver Bluetooth Pro OBDII Scan Tool", "COMECASE", "19.02", "0", "-", sub="Code Readers & Scan Tools", bsr="70000"),  # excluded_non_gauge
    row("B0TESTAEM1", "AEM X-Series 52mm OBD II Digital Gauge View Engine Parameters Codes CEL Black", "AEM", "297.29", "0", "-", sub="Multi Gauges", bsr="60000"),   # gauge_display, zero sales
    row("B0TESTAIM1", "AiM Solo 2 DL GPS Lap Timer with OBDII Harness Data Logger", "AiM", "1336.00", "1", "1336.00", sub="Specialty", bsr="90000"),   # ambiguous / borderline
    row("B0TESTMEC1", "10Pcs Universal Water Temperature Gauge Racing 60mm Tinted Mechanical Instrument", "Fydun", "119.92", "0", "-", sub="Water Temp", bsr="99000"),  # excluded_non_gauge (mechanical bulk)
]
# ---- gauge export: separate bully dog file (different file-name pattern) ----
gbd = [
    row("B0TESTBDG1", "Bully Dog 40410 Triple Dog GT Gas Gauge Tuner", "Bully Dog", "538.80", "2", "1077.60", sub="Engine Management Systems", bsr="30000", ly="26", yoy="-32", age="169"),   # tuner_with_gauge_display, gas
    row("B0TESTBDG2", "Bully Dog Triple Dog Platinum GT Gas Tuner and Gauge (40417)", "Bully Dog", "498.79", "1", "498.79", sub="Specialty", bsr="35000", ly="19", yoy="-34", age="113"),
]

def write(name, rows):
    with open(HERE / name, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=HEADER); w.writeheader(); w.writerows(rows)

write("cr_page1.csv", cr1); write("cr_page2.csv", cr2); write("gauge_page1.csv", g1); write("gauge_bullydog.csv", gbd)

# mini US type map (ASIN -> Type), mirrors amazon_scanner_type.xlsx columns
with open(HERE / "us_type_map_mini.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh); w.writerow(["Title", "Brand", "ASIN", "Price", "Type", "URL"])
    for asin, t in [("B0TESTAUT1","Tablet"),("B0TESTANC1","Handheld"),("B0TESTINN1","Handheld"),("B0TESTINN2","Dongle"),
                    ("B0TESTOBD1","Dongle"),("B0TESTBLU1","Dongle"),("B0TESTEDG1","Other"),("B0TESTSCG1","Tablet"),
                    ("B0TESTCAB1","Cable/Adapter"),("B0TESTEX40","Tablet"),("B0TESTDUP1","Dongle"),("B0TESTDUP2","Dongle"),
                    ("B0TESTOBD2","Cable/Adapter"),("B0TESTKEY1","Key"),("B0TESTOTH1","VCI"),("B0TESTGEN1","Handheld")]:
        w.writerow(["", "", asin, "", t, ""])

# normalized rows for the workbook engine (ROW_COLUMNS order) — values hand-assigned, consistent with the rules above
import sys; sys.path.insert(0, str(HERE.parents[2]))
from ca_market_reports.ca_common import ROW_COLUMNS  # noqa: E402

def nrow(asin, title, brand_key, brand_display, price, units, rev, typ, tsrc, gclass, grule, *, in_scope, sub="Code Readers & Scan Tools",
         source_set="code_reader", tier="", bsr=1000, reviews=10, rating=4.5, age=24, ly="", yoy="", seller="SomeSeller", ful="FBA"):
    d = dict.fromkeys(ROW_COLUMNS, "")
    d.update(asin=asin, title=title, brand_raw=brand_display, brand_key=brand_key, brand_display=brand_display, seller=seller, fulfillment=ful,
             category="Automotive", subcategory=sub, bsr=bsr, subcategory_bsr=50, list_price=price, units_month=units, revenue_month=rev,
             price=(round(rev/units, 2) if units else price), review_count=reviews, rating=rating, listing_age_months=age, variation_count=1,
             frequently_returned=False, last_year_units=ly, yoy_units_pct=yoy, sales_trend_90d_pct="", price_trend_90d_pct="",
             url=f"https://amazon.ca/dp/{asin}", image_url="https://m.media-amazon.com/images/I/TEST.jpg", export_date="2026-10-02",
             source_file="cr_page1.csv", source_set=source_set, market="CA", currency="CAD", type=typ, type_source=tsrc, type_confidence=1.0,
             gauge_class=gclass, gauge_in_scope=in_scope, gauge_rule_id=grule, gauge_confidence=1.0, price_tier=tier)
    return d

norm = [
    nrow("B0TESTAUT1","Autel MaxiCOM MK808S Bidirectional Tool","autel","Autel",659.99,20,13199.80,"Tablet","us_map","excluded_non_gauge","XN",in_scope=False,tier="Tablet $400-$800",ly=180,yoy=33),
    nrow("B0TESTANC1","ANCEL AD310 Classic Enhanced OBD II Scanner","ancel","ANCEL",39.99,100,3999.00,"Handheld","us_map","excluded_non_gauge","XN",in_scope=False,tier="Handheld $75-",reviews=5000,rating=4.6,ly=1500,yoy=-20),
    nrow("B0TESTINN1","INNOVA 5610 OBD2 Bidirectional Scan Tool","innova","Innova",463.99,28,12991.72,"Handheld","us_map","excluded_non_gauge","XN",in_scope=False,tier="Handheld $75+",seller="Amazon",ful="Amazon",ly=574,yoy=120),
    nrow("B0TESTINN2","Innova 1000 V2 OBD2 Bluetooth Scanner","innova","Innova",173.90,3,521.70,"Dongle","us_map","excluded_app_dongle","XD",in_scope=False,tier="Total Dongle",seller="Dominion Pride",ly=53),
    nrow("B0TESTGEN1","FOXWELL NT530 Multi-System OBD2 Scanner for BMW","foxwell","FOXWELL",199.00,4,796.00,"Handheld","us_map","excluded_non_gauge","XN",in_scope=False,tier="Handheld $75+"),
    nrow("B0TESTOBD1","OBDLink MX+ OBD2 Bluetooth Scanner","obdlink","OBDLink",209.95,40,8398.00,"Dongle","us_map","excluded_app_dongle","XD",in_scope=False,tier="Total Dongle",reviews=2000),
    nrow("B0TESTBLU1","BlueDriver OBD2 Scanner Bluetooth","bluedriver","BlueDriver",119.95,60,7197.00,"Dongle","us_map","excluded_app_dongle","XD",in_scope=False,tier="Total Dongle",reviews=800,rating=3.9),
    nrow("B0TESTEDG1","Edge 84130-3 Insight CTS3","edge products","Edge Products",661.00,4,2644.00,"Other","us_map","truck_gauge_monitor","TM",in_scope=True,tier="Total Other Tools",ly=33,yoy=29),
    nrow("B0TESTEDG2","Edge 85401-201 Evolution CTS3 Programmer - CA Edition","edge products","Edge Products",1085.34,0,0.0,"Other","keyword","tuner_with_gauge_display","TD",in_scope=True,tier="Total Other Tools"),
    nrow("B0TESTSCG1","ScanGauge 3 Touch Screen OBD2 Scanner, Digital Gauges & Trip Computer SG3","scangauge","ScanGauge",389.95,2,779.90,"Tablet","us_map","gauge_display","GD",in_scope=True,tier="Tablet $400-",ly=40,yoy=64),
    nrow("B0TESTCAB1","KIMISS OBD2 to HDMI Cable for Edge CS2 CTS2 CTS3 H00008000","kimiss","Kimiss",36.28,1,41.20,"Cable/Adapter","us_map","gauge_accessory","AC",in_scope=True,tier="Total Other Tools"),
    nrow("B0TESTTAB1","LAUNCH X431 PRO5 Car Scanner J2534","launch","LAUNCH",1999.00,1,1999.00,"Tablet","keyword","excluded_non_gauge","XN",in_scope=False,tier="Tablet $800+"),
    nrow("B0TESTHUD1","wiiyii Car HUD Head Up Display P6, OBD+GPS Smart Gauge","wiiyii","wiiyii",59.99,119,7138.81,"Other","keyword","obd_gps_hud","HG",in_scope=True,sub="Speedometers",source_set="both",tier="Total Other Tools",ly=87,yoy=37),
    nrow("B0TESTHUD2","Car Speedometer Gauge,OBD2 HUD Head Up Display Projector","keenso","Keenso",32.39,54,1749.06,"","","obd_hud","HO",in_scope=True,sub="Speedometers",source_set="gauge",ly=587,yoy=116),
    nrow("B0TESTHUD3","Digital GPS Speedometer Universal Heads Up Display 5.5 inch","sinotrack","SinoTrack",32.98,30,989.40,"","","gps_hud","GH",in_scope=True,sub="Speedometers",source_set="gauge"),
    nrow("B0TESTLUF2","LUFI Xs OBD2 Gauge Display – Fuel Car Companion","lufi","Lufi",180.45,6,1082.70,"","","gauge_display","GD",in_scope=True,sub="Multi Gauges",source_set="gauge"),
    nrow("B0TESTSHF1","Lufi Shift Light (Blue) Accessory for XF OBD2 Gauge","lufi","Lufi",12.98,0,0.0,"","","gauge_accessory","AC",in_scope=True,sub="Shift Light",source_set="gauge"),
    nrow("B0TESTCAS1","Mini Carry Case Compatible with BlueDriver Scan Tool","comecase","Comecase",19.02,0,0.0,"","","excluded_non_gauge","XN",in_scope=False,source_set="gauge"),
    nrow("B0TESTAEM1","AEM X-Series 52mm OBD II Digital Gauge","aem","AEM",297.29,0,0.0,"","","gauge_display","GD",in_scope=True,sub="Multi Gauges",source_set="gauge"),
    nrow("B0TESTAIM1","AiM Solo 2 DL GPS Lap Timer with OBDII Harness","aim","AiM",1336.00,1,1336.00,"","","ambiguous","AMB",in_scope=False,sub="Specialty",source_set="gauge"),
    nrow("B0TESTBDG1","Bully Dog 40410 Triple Dog GT Gas Gauge Tuner","bully dog","Bully Dog",538.80,2,1077.60,"","","tuner_with_gauge_display","TD",in_scope=True,sub="Engine Management Systems",source_set="gauge",ly=26,yoy=-32,age=169),
    nrow("B0TESTBDG2","Bully Dog Triple Dog Platinum GT Gas Tuner and Gauge (40417)","bully dog","Bully Dog",498.79,1,498.79,"","","tuner_with_gauge_display","TD",in_scope=True,sub="Specialty",source_set="gauge",ly=19,yoy=-34,age=113),
]
with open(HERE / "normalized_rows.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(ROW_COLUMNS)); w.writeheader(); w.writerows(norm)
print("fixtures written:", sorted(p.name for p in HERE.glob("*.csv")))
