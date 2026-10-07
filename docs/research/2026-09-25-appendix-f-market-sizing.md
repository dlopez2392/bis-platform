# Appendix F — Valley market sizing for more industries

Part of `2026-09-25-crm-feature-research.md`. Compiled 2026-09-25 by a delegated research agent from the Census County Business Patterns 2023 county and national files (downloaded directly), Census Nonemployer Statistics, IRS SOI data, FMCSA, TDI and TDLR licence data. Location quotients compare the four Valley counties with the US. Findings tagged HARD, arithmetic or SOFT.

---

# Rio Grande Valley small-business market sizing for BIS

*Research F. Prepared 2026-09-25. Geography: Hidalgo, Cameron, Starr and Willacy counties, Texas (the "Valley"; 2024 population 1,433,308).*

---

## 0. Summary

- **Primary data works.** I downloaded the Census County Business Patterns 2023 county file (`cbp23co.zip`) and the national file (`cbp23us.zip`) directly from www2.census.gov. I did not use the API. Every establishment figure below comes from those files.
- **In the Valley, most small businesses have no employees.** The four counties have 20,908 employer establishments, or 14.8 per 1,000 residents against 24.8 nationally. They also have 142,585 nonemployer businesses (NES 2022), about 100 per 1,000 residents against about 89 nationally. On 28.3% of individual tax returns filed there, the filer reports Schedule C business income. The US figure is 19.2% (IRS SOI TY2023). CBP therefore understates trades, beauty, trucking, catering and events. See the NES and TDLR columns and sections.
- **The strongest concentrations fit the border economy.** Among the codes requested, the highest location quotients (LQ) are for freight transportation arrangement (488510, 3.99), child day care (2.35), used-car dealers (2.23), retail bakeries (2.08) and tax preparation (1.93). A scan of every 6-digit industry turns up much larger outliers:
  - tortillerías: 31.8
  - produce wholesalers: 15.8
  - casas de cambio: 11.5
  - consumer installment lenders: 8.9
  - pawn and title lenders: 4.0
  - lot developers: 4.0
- **Demand signals with hard numbers:**
  - The Valley's EITC claim rate is 36.4% of returns, against 15.0% in the US, 2.4 times higher. That is $751M of EITC and $1.82B in refunds a year, and 319k of those returns were done by a paid preparer.
  - RGV ports took in 1.17M northbound trucks in 2025.
  - RGV ZIP codes hold 12% of Texas's county-mutual (non-standard auto) agents and 28% of its small-face (≤$25k, burial) life agents, with 4.6% of the state's population.
  - The Valley has 1 attorney per about 800 residents, against 1 per 310 statewide.
  - Real-estate licensees are sparse: 0.41 times the Texas per-capita density.
- **Top segments by the requested formula** (count of 1–19-employee establishments × LQ, non-HIPAA, screened for fit; full list in §5):
  1. produce wholesalers
  2. consumer lenders
  3. insurance agencies
  4. freight arrangement and customs brokers
  5. law offices
  6. truckload carriers
  7. pawn and title lenders
  8. used-car dealers
  9. tax preparers
  10. event-hall lessors
  11. homebuilders
  12. lot developers

---

## 1. Data sources and method

| Source | What I used | How obtained |
|---|---|---|
| **CBP 2023 county file** | `cbp23co.txt`, 2- to 6-digit NAICS; `est`, `emp`, `n<5` … `n1000` | `curl https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23co.zip` (HTTP 200, 12.9 MB). The file downloaded, so **the API was not needed or used.** |
| **CBP 2023 US file** | `cbp23us.txt`, `lfo = "-"` (all legal forms), for US establishment totals | `…/cbp/datasets/2023/cbp23us.zip` |
| **Nonemployer Statistics 2022** | `nonemp22co.txt`, `nonemp22us.txt` (latest NES release; 2- to 6-digit, mostly 5-digit at county level) | `…/nonemployer-statistics/datasets/2022/historical-datasets/` |
| **Census population estimates** | `co-est2024-alldata.csv` (2023 and 2024 totals); `cc-est2024-agesex-48.csv` (girls 15–19); `cc-est2024-alldata-48.csv` (Hispanic origin) | www2.census.gov popest |
| **IRS SOI county data TY2023** | `23incyallnoagi.csv`: returns (N1), EITC (N59660/A59660), paid preparer (PREP), ACTC (N11070), Schedule C (N00900), refunds (N11902/A11902) | irs.gov/pub/irs-soi/ |
| **Texas licensing open data** (data.texas.gov, queried 2026-09-25, updated daily) | TREC broker/agent licensees (`s7ft-44qi`); TDI agencies (`3yqc-fcdt`) and individual licensees (`kxv3-diwf`); TDLR all licenses (`7358-krk7`) | Socrata SoQL `count(*)` group-bys |
| **FMCSA Company Census** (data.transportation.gov `az4n-8mr2`) | Active carriers, brokers and forwarders with physical ZIP 785xx vs all of Texas | SoQL |
| **BTS Border Crossing Entry Data** (data.bts.gov `keg4-3bc2`) | Incoming (northbound) trucks by Texas port, 2023–2026 | SoQL |
| **State Bar of Texas**, *2023-24 Attorney Population Density by MSA/County* | In-state attorneys by county | PDF from texasbar.com (ContentID 66372) |

**Method and caveats (read before using the numbers):**

1. **4-county totals** are the sums of the Hidalgo (215), Cameron (061), Starr (427) and Willacy (489) rows for each NAICS code. A code missing from a county's rows is counted as zero establishments.
2. **NAICS vintage.** CBP 2023 still uses **NAICS 2017**, and the file shows it: `4413` splits into `441310` (parts) and `441320` (tires). So the tire dealers requested as **441340 (the NAICS 2022 code) are reported as 441320**. All other requested codes exist at 6 digits except "484" (3-digit total, as asked) and "813" (3-digit total, as asked). Every row in the master table says which level was used.
3. **Size bands are lower bounds.** The layout defines size-class value `N` as "Not available or not comparable". Across the whole 2023 county file, no size cell ever holds 1 or 2, so **`N` means 0, 1 or 2 establishments.** Summed band counts are therefore floors. The "in N cells" column (establishments minus the sum of published bands) shows how many establishments sit in suppressed cells.
4. **Establishment counts are exact.** Employment is noise-infused. Flags are G (<2% noise), H (2–5%) and J (≥5%); rows with any J county are marked `*`. No employment cell was withheld in these rows, so employment is shown for every code.
5. **CBP counts establishments, not firms.** A chain with 30 branches counts as 30. CBP also excludes the self-employed (see NES), government, and most agriculture. Employment is measured in the week of March 12, which is inside tax season, so seasonal tax-prep storefronts do show up.
6. **Location quotient (LQ vs US)** = (Valley establishments in the code ÷ all 20,908 Valley establishments) ÷ (US establishments in the code ÷ all 8,361,342 US establishments), which is the share-based LQ requested. **LQ vs TX** uses the sum of all Texas county rows (670,877) as the base.
7. **Per-capita index.** The Valley has only 59% of the US employer-establishment density per resident, so a share-LQ of 1.0 means the Valley has **0.59 times** the US establishments per resident in that industry. The "per-capita idx" column is LQ × 0.594 and answers the question "how many businesses of this type per resident, relative to the US?". LQ answers "is the local business mix tilted toward this industry?".
8. **NES LQ** is the same share-LQ on nonemployer counts (Valley 142,585; US 29,811,495). It uses the finest NES level available, shown in parentheses.

---

## 2. Valley baseline

| Metric | Valley (4 counties) | Texas | US | Source tag |
|---|---:|---:|---:|---|
| Population 2024 | 1,433,308 (Hidalgo 914,820; Cameron 431,874; Starr 66,587; Willacy 20,027) | 31,290,831 | — | [HARD] PEP V2024 |
| Hispanic share 2024 | 91.3% (Starr 96.9%, Hidalgo 92.0%, Cameron 89.2%, Willacy 87.6%) | 40.3% | — | [HARD] PEP cc-est2024 |
| Employer establishments 2023 | 20,908 (Hidalgo 13,393; Cameron 6,732; Starr 594; Willacy 189) | 670,877 | 8,361,342 | [HARD] CBP |
| Paid employees, mid-March 2023 | 363,139 | — | — | [HARD] CBP |
| Employer establishments per 1,000 residents | 14.8 | — | 24.8 | [DERIVED] |
| Nonemployer businesses 2022 | 142,585 (~100 per 1,000) | — | 29.8M (~89 per 1,000) | [HARD] NES |
| Share of tax returns with Schedule C, TY2023 | **28.3%** (165,180 returns) | 24.4% | 19.2% | [HARD] IRS SOI |

---

## 3. Master table: every requested code (4-county totals, CBP 2023)

Columns: `<5`, `5–9` and `10–19` are published counts of establishments by employee-size band (floors; see caveat 3). `20+` is the sum of all larger bands. `in "N" cells` is establishments not allocated to any published band. Paid emp. is mid-March 2023 employment (`*` = at least one county has ≥5% noise). **LQ vs US** is the requested location quotient.

| NAICS | Industry | Level | Estabs | <5 | 5–9 | 10–19 | 20+ | in "N" cells | Paid emp. | LQ vs US | LQ vs TX | Per-capita idx | Nonemployers 2022 (NES level) | NES LQ |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 541940 | Veterinary services | 6-dig | 32 | 5 | 6 | 7 | 9 | 5 | 650* | **0.37** | 0.38 | 0.22 | 21 (54194) | 0.17 |
| 812910 | Pet care (except veterinary) | 6-dig | 30 | 22 | 4 | 0 | 0 | 4 | 129 | **0.47** | 0.50 | 0.28 | 186 (81291) | 0.3 |
| 541110 | Offices of lawyers | 6-dig | 510 | 369 | 81 | 40 | 16 | 4 | 2,337* | **1.23** | 1.19 | 0.73 | 872 (5411) | 0.64 |
| 541191 | Title abstract & settlement offices | 6-dig | 26 | 10 | 7 | 0 | 3 | 6 | 220* | **1.06** | 0.99 | 0.63 | 872 (5411) | 0.64 |
| 524210 | Insurance agencies & brokerages | 6-dig | 524 | 367 | 106 | 40 | 4 | 7 | 2,760 | **1.57** | 1.38 | 0.93 | 1,461 (52421) | 1.01 |
| 541213 | Tax preparation services | 6-dig | 139 | 94 | 27 | 14 | 3 | 1 | 717* | **1.93** | 1.81 | 1.15 | 631 (541213) | 1.31 |
| 541211 | Offices of CPAs | 6-dig | 92 | 54 | 22 | 11 | 3 | 2 | 579 | **0.67** | 0.74 | 0.40 | 91 (541211) | 0.55 |
| 541219 | Other accounting services (bookkeeping) | 6-dig | 128 | 92 | 19 | 9 | 4 | 4 | 774* | **1.07** | 1.03 | 0.64 | 1,104 (541219) | 0.91 |
| 531210 | Offices of real estate agents & brokers | 6-dig | 190 | 168 | 14 | 0 | 0 | 8 | 920* | **0.46** | 0.54 | 0.27 | 1,306 (53121) | 0.31 |
| 531311 | Residential property managers | 6-dig | 120 | 98 | 15 | 4 | 0 | 3 | 384* | **0.79** | 0.79 | 0.47 | 724 (53131) | 0.6 |
| 531320 | Offices of real estate appraisers | 6-dig | 21 | 19 | 0 | 0 | 0 | 2 | 47* | **0.68** | 0.91 | 0.40 | 51 (53132) | 0.35 |
| 488510 | Freight transportation arrangement | 6-dig | 218 | 121 | 38 | 31 | 24 | 4 | 2,072 | **3.99** | 2.50 | 2.37 | 1,025 (488) | 1.5 |
| 484 | Truck transportation (total) | 3-dig | 539 | 355 | 67 | 49 | 65 | 3 | 6,450 | **1.27** | 1.22 | 0.75 | 11,428 (484) | 2.61 |
| 811111 | General automotive repair | 6-dig | 147 | 102 | 24 | 7 | 6 | 8 | 1,106* | **0.69** | 0.75 | 0.41 | 1,914 (81111) | 2.02 |
| 811121 | Automotive body, paint & interior repair | 6-dig | 43 | 21 | 10 | 7 | 3 | 2 | 318 | **0.49** | 0.52 | 0.29 | 477 (81112) | 1.51 |
| 811192 | Car washes | 6-dig | 40 | 14 | 0 | 21 | 0 | 5 | 424 | **0.81** | 0.73 | 0.48 | 945 (81119) | 2.13 |
| 441320 | Tire dealers (NAICS 2017 code; =441340 in NAICS 2022) | 6-dig | 64 | 31 | 17 | 13 | 0 | 3 | 401 | **1.26** | 1.23 | 0.75 | 533 (4413) | 1.76 |
| 4413 | Auto parts, accessories & tire retailers (parent) | 4-dig | 263 | 66 | 77 | 108 | 11 | 1 | 2,456 | **1.79** | 1.62 | 1.06 | 533 (4413) | 1.76 |
| 441120 | Used car dealers | 6-dig | 140 | 99 | 26 | 11 | 3 | 1 | 748 | **2.23** | 1.82 | 1.33 | 1,462 (44112) | 2.42 |
| 441110 | New car dealers | 6-dig | 78 | 13 | 3 | 0 | 55 | 7 | 4,781 | **1.42** | 1.54 | 0.84 | n/a (4411 total 1,462 ≈ used) |  |
| 561710 | Exterminating & pest control | 6-dig | 40 | 26 | 7 | 0 | 0 | 7 | 216 | **0.97** | 0.91 | 0.58 | 137 (56171) | 1.8 |
| 561730 | Landscaping services | 6-dig | 63 | 43 | 8 | 7 | 0 | 5 | 376 | **0.21** | 0.37 | 0.12 | 4,321 (56173) | 1.73 |
| 561720 | Janitorial services | 6-dig | 66 | 42 | 11 | 7 | 3 | 3 | 486 | **0.39** | 0.56 | 0.23 | 7,792 (56172) | 1.56 |
| 238220 | Plumbing, heating & A/C contractors | 6-dig | 213 | 136 | 41 | 17 | 16 | 3 | 1,351 | **0.77** | 0.77 | 0.46 | 1,429 (23822) | 1.73 |
| 238210 | Electrical contractors | 6-dig | 123 | 68 | 24 | 17 | 7 | 7 | 1,176 | **0.59** | 0.65 | 0.35 | 1,853 (23821) | 2.56 |
| 238160 | Roofing contractors | 6-dig | 38 | 25 | 4 | 0 | 0 | 9 | 284* | **0.60** | 0.51 | 0.36 | 3,349 (2381) | 2.34 |
| 812111 | Barber shops | 6-dig | 15 | 10 | 4 | 0 | 0 | 1 | 63* | **0.77** | 0.87 | 0.46 | 608 (812111) | 0.93 |
| 812112 | Beauty salons | 6-dig | 134 | 102 | 19 | 5 | 5 | 3 | 610* | **0.64** | 0.76 | 0.38 | 2,698 (812112) | 0.68 |
| 812113 | Nail salons | 6-dig | 26 | 25 | 0 | 0 | 0 | 1 | 52* | **0.30** | 0.46 | 0.18 | 1,544 (812113) | 1.15 |
| 812199 | Other personal care services (spas etc.) | 6-dig | 63 | 43 | 10 | 8 | 0 | 2 | 282* | **0.79** | 0.79 | 0.47 | 653 (81219) | 0.72 |
| 713940 | Fitness & recreational sports centers | 6-dig | 71 | 27 | 23 | 10 | 9 | 2 | 1,412 | **0.68** | 0.68 | 0.40 | 417 (7139) | 0.62 |
| 611610 | Fine arts schools | 6-dig | 23 | 21 | 0 | 0 | 0 | 2 | 62 | **0.56** | 0.67 | 0.33 | 2,718 (611) | 0.66 |
| 611620 | Sports & recreation instruction | 6-dig | 26 | 15 | 0 | 5 | 0 | 6 | 135 | **0.50** | 0.49 | 0.30 | 2,718 (611) | 0.66 |
| 611691 | Exam prep & tutoring | 6-dig | 12 | 7 | 3 | 0 | 0 | 2 | 103 | **0.49** | 0.46 | 0.29 | 2,718 (611) | 0.66 |
| 611692 | Automobile driving schools | 6-dig | 9 | 0 | 3 | 0 | 0 | 6 | 73* | **1.36** | 1.63 | 0.81 | 2,718 (611) | 0.66 |
| 812210 | Funeral homes & funeral services | 6-dig | 46 | 15 | 12 | 13 | 0 | 6 | 357* | **1.21** | 1.76 | 0.72 | 77 (81221) | 1.22 |
| 812320 | Drycleaning & laundry (except coin-op) | 6-dig | 18 | 6 | 4 | 4 | 0 | 4 | 161* | **0.46** | 0.42 | 0.27 | 64 (81232) | 0.95 |
| 531120 | Lessors of nonresidential buildings | 6-dig | 137 | 112 | 17 | 3 | 0 | 5 | 481 | **1.59** | 1.35 | 0.94 | 2,715 (5311) | 0.43 |
| 812990 | All other personal services | 6-dig | 34 | 24 | 6 | 0 | 0 | 4 | 161* | **0.55** | 0.64 | 0.33 | 3,677 (81299) | 1.02 |
| 541921 | Photography studios, portrait | 6-dig | 16 | 12 | 0 | 0 | 0 | 4 | 61 | **0.56** | 0.69 | 0.33 | 473 (54192) | 0.43 |
| 722320 | Caterers | 6-dig | 26 | 13 | 8 | 0 | 0 | 5 | 161 | **0.79** | 1.03 | 0.47 | 3,314 (7223) | 1.86 |
| 311811 | Retail bakeries | 6-dig | 48 | 28 | 13 | 0 | 3 | 4 | 280* | **2.08** | 2.39 | 1.24 | 545 (3118) | 3.88 |
| 624410 | Child day care services *(reference)* | 6-dig | 482 | 186 | 160 | 111 | 22 | 3 | 3,593 | **2.35** | 2.51 | 1.40 | 4,762 (62441) | 1.82 |
| 722511 | Full-service restaurants *(reference)* | 6-dig | 765 | 235 | 132 | 140 | 251 | 7 | 15,558 | **1.18** | 1.18 | 0.70 | 722 (722511) | 2.74 |
| 722513 | Limited-service restaurants *(reference)* | 6-dig | 881 | 133 | 112 | 232 | 397 | 7 | 22,607 | **1.30** | 1.16 | 0.77 | 274 (722513) | 1.35 |
| 621210 | Offices of dentists *(HIPAA, reference)* | 6-dig | 311 | 108 | 95 | 85 | 18 | 5 | 2,492 | **0.92** | 0.84 | 0.55 | 178 (62121) | 0.72 |
| 621111 | Offices of physicians *(HIPAA, reference)* | 6-dig | 1029 | 508 | 209 | 170 | 133 | 9 | 11,253 | **2.01** | 1.54 | 1.19 | 713 (621111) | 0.81 |
| 621340 | PT/OT/speech & audiology *(HIPAA, reference)* | 6-dig | 172 | 74 | 45 | 34 | 13 | 6 | 1,639 | **1.32** | 1.72 | 0.78 | 757 (62134) | 1.56 |
| 813110 | Religious organizations *(reference)* | 6-dig | 354 | 234 | 66 | 29 | 20 | 5 | 2,360 | **0.76** | 0.77 | 0.45 | 782 (813) | 0.88 |
| 813 | Religious, grantmaking, civic, professional orgs (total) *(reference)* | 3-dig | 623 | 406 | 112 | 69 | 31 | 5 | 3,830 | **0.81** | 0.94 | 0.48 | 782 (813) | 0.88 |
| 541810 | Advertising agencies *(competitor supply)* | 6-dig | 19 | 15 | 3 | 0 | 0 | 1 | 58* | **0.49** | 0.50 | 0.29 | 498 (5418) | 0.52 |

Notes on specific rows:
- **Restaurants and caterers:** NES "7223" (special food services) includes mobile food and food trucks as well as caterers.
- **Education:** NES has only "611" (all education) at county level, so its count repeats for the four 6116xx codes.
- **Legal:** NES has only "5411" (legal services), which includes notaries and paralegal services.
- **Freight arrangement:** NES has only "488" (support activities for transportation).

### 3a. Top 10 requested codes by LQ vs US

| # | NAICS | Industry | LQ vs US | Estabs | Note |
|---:|---|---|---:|---:|---|
| 1 | 488510 | Freight transportation arrangement | **3.99** | 218 | Customs brokers and forwarders; LQ vs TX is still 2.50 |
| 2 | 624410 | Child day care | 2.35 | 482 | Reference only |
| 3 | 441120 | Used car dealers | 2.23 | 140 | Plus 1,462 nonemployer dealers (NES LQ 2.42) |
| 4 | 311811 | Retail bakeries (panaderías) | 2.08 | 48 | NES bakeries-and-tortillas LQ 3.88 |
| 5 | 621111 | Offices of physicians | 2.01 | 1,029 | HIPAA; excluded |
| 6 | 541213 | Tax preparation | 1.93 | 139 | Plus 631 nonemployer preparers |
| 7 | 531120 | Lessors of nonresidential buildings (event-venue proxy) | 1.59 | 137 | Mostly <5 employees |
| 8 | 524210 | Insurance agencies & brokerages | 1.57 | 524 | Largest non-HIPAA small-business count on the list |
| 9 | 441110 | New car dealers | 1.42 | 78 | 55 of 78 have 20+ employees; not a small-business segment |
| 10 | 611692 | Automobile driving schools | 1.36 | 9 | Too few establishments to be reliable |

Next non-HIPAA codes: 722513 (1.30), 484 (1.27), 441320 tires (1.26), 541110 lawyers (1.23), 812210 funeral homes (1.21; **1.76 vs Texas**).

**Most under-represented (LQ < 0.5):**
- landscaping: 0.21
- nail salons: 0.30
- veterinary: 0.37
- janitorial: 0.39
- real-estate offices: 0.46
- dry cleaning: 0.46
- pet care: 0.47
- auto body: 0.49
- tutoring: 0.49
- advertising agencies: 0.49
- sports instruction: 0.50

In most of these, the nonemployer LQ is **above 1.5**. The Valley does have these businesses, but they are one-person operations, not employer shops. Veterinary, pet care and real estate are the exceptions: they are thin on both measures.

### 3b. Industries the requested list did not include: all 6-digit codes with ≥15 Valley establishments, top 25 by LQ vs US

| Rank | NAICS | Industry | Estabs | 1–19 emp. (published) | Paid emp. | LQ vs US | LQ vs TX |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | 311830 | Tortilla manufacturing (tortillerías) | 34 | 24 | 281 | 31.77 | 10.01 |
| 2 | 424480 | Fresh fruit & vegetable merchant wholesalers | 194 | 165 | 2,593 | 15.79 | 14.48 |
| 3 | 523130 | Commodity contracts dealing (includes foreign-currency exchange sold to the public, i.e. casas de cambio) | 23 | 18 | 166 | 11.51 | 8.29 |
| 4 | 522291 | Consumer lending (installment and payday lenders) | 270 | 266 | 809 | 8.92 | 3.96 |
| 5 | 114112 | Shellfish fishing (shrimp fleet) | 19 | 19 | 17 | 8.08 | 13.25 |
| 6 | 493120 | Refrigerated warehousing & storage | 23 | 15 | 427 | 6.68 | 6.42 |
| 7 | 624230 | Emergency & other relief services | 16 | 0 | 5,388 | 5.05 | 5.19 |
| 8 | 522298 | All other nondepository credit (pawnshops, auto-title lending) | 94 | 91 | 494 | 4.01 | 1.92 |
| 9 | 488510 | Freight transportation arrangement | 218 | 190 | 2,072 | 3.99 | 2.50 |
| 10 | 237210 | Land subdivision (lot developers) | 44 | 38 | 192 | 3.96 | 2.44 |
| 11 | 624120 | Services for elderly & persons with disabilities (Medicaid attendant care; HIPAA-adjacent) | 352 | 188 | 36,730 | 3.50 | 5.31 |
| 12 | 621610 | Home health care (HIPAA) | 343 | 161 | 30,477 | 3.37 | 2.46 |
| 13 | 445210 | Meat markets (carnicerías) | 47 | 37 | 443 | 3.31 | 3.81 |
| 14 | 517911 | Telecommunications resellers (prepaid wireless) | 30 | 25 | 297 | 3.20 | 2.89 |
| 15 | 424450 | Confectionery merchant wholesalers | 16 | 12 | 85 | 2.85 | 3.57 |
| 16 | 424320 | Men's & boys' clothing wholesalers | 21 | 16 | 122 | 2.84 | 4.55 |
| 17 | 722514 | Cafeterias, grill buffets & buffets | 32 | 17 | 820 | 2.77 | 2.55 |
| 18 | 448130 | Children's & infants' clothing stores | 25 | 20 | 173 | 2.73 | 2.57 |
| 19 | 522390 | Other credit-intermediation activities (check cashing, money transmitters) | 77 | 75 | 226 | 2.73 | 1.56 |
| 20 | 423320 | Brick, stone & construction-material wholesalers | 24 | 19 | 169 | 2.57 | 1.82 |
| 21 | 424330 | Women's & children's clothing wholesalers | 39 | 36 | 198 | 2.45 | 4.21 |
| 22 | 621910 | Ambulance services (HIPAA) | 34 | 17 | 907 | 2.45 | 2.20 |
| 23 | 621512 | Diagnostic imaging centers (HIPAA) | 42 | 34 | 391 | 2.41 | 1.69 |
| 24 | 424420 | Packaged frozen food wholesalers | 18 | 13 | 104 | 2.40 | 3.32 |
| 25 | 452319 | All other general merchandise (dollar stores) | 293 | 274 | 2,446 | 2.39 | 2.07 |

Other 6-digit codes below the top 25 that matter for BIS:
- 532289 all other consumer goods rental, which includes party rental: 29 establishments, LQ 2.18
- 532210 rent-to-own: 2.25
- 441310 auto parts stores: 2.05
- 484121 truckload carriers: 1.90 (286 establishments)
- 811191 oil-change shops: 1.76
- 448190 other clothing stores, which includes bridal and quince gowns: 1.59
- 713290 game rooms: 2.05

**Pattern:** the outliers group into three clusters:
1. cross-border trade: produce, cold storage, freight arrangement, casas de cambio, wholesale apparel sold to Mexican buyers
2. finance for thin-credit households: installment lenders, pawn and title, check cashing and remittance, rent-to-own
3. Mexican-American food and household culture: tortillerías, panaderías, carnicerías, buffets, children's-wear

---

## 4. Demand signals by candidate segment

Legend:
- **[HARD]**: official statistics, a primary data file or regulator data (includes my own counts from them).
- **[DERIVED]**: my arithmetic on hard data, with the assumption stated.
- **[SOFT]**: news, trade association, vendor or directory claims, or inference.

### 4.1 Quinceañeras and weddings

- **[HARD / DERIVED]** In 2024 there were 59,371 girls aged 15–19 in the four counties, so **about 11,900 girls turn 15 each year** (15–19 count ÷ 5). With a 91.3% Hispanic population, that is the demand pool for quinces. I found no count of how many families hold a paid event. If 40–60% do, that is roughly 4,800–7,100 events a year. The share is an assumption, not data. Sources: `cc-est2024-agesex-48.csv`, `cc-est2024-alldata-48.csv` (www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/asrh/).
- **[HARD]** Vendor supply in CBP 2023. Employer counts are small, while nonemployer (NES) counts are large:

| Vendor type (NAICS) | Employer establishments | LQ | Nonemployers |
|---|---:|---:|---:|
| Nonresidential lessors, venue proxy (531120) | 137 | 1.59 | — |
| Caterers (722320) | 26 | 0.79 | 3,314 (7223, includes food trucks) |
| Party and consumer-goods rental (532289) | 29 | 2.18 | — |
| Other clothing stores, bridal and quince gowns (448190) | 45 | 1.59 | — |
| Portrait photographers (541921) | 16 | — | 473 (54192) |
| All other personal services, includes party planners (812990) | 34 | — | 3,677 (81299) |
| Retail bakeries, cakes (311811) | 48 | 2.08 | — |

  Venues split between event halls (531120 when rented without food, 722320 when catered) and the McAllen Convention Center.
- **[SOFT]** Spending per event:
  - The 2019 Mi Padrino survey (525,000 quinceañeras nationwide) put the average at $21,781, about $28,372 in today's dollars. Cited by KPBS, 2026-06-11: https://www.kpbs.org/news/economy/2026/06/11/quinceanera-costs-are-rising-heres-how-families-are-making-it-work
  - Texas Monthly calls quinceañeras "a multibillion-dollar industry" and puts it at $49B globally: https://www.texasmonthly.com/style/quinceaneras-texas-parties-birthday-party-industry/
  - Marketplace headline: "A 15th birthday with a $20K price tag", 2024-02-12: https://www.marketplace.org/story/2024/02/12/how-much-do-quinceaneras-cost
  - Valley household incomes are well below these markets, so treat $20K+ as a ceiling. At an assumed Valley median of $8–15K and 4,800–7,100 events, the Valley quince spend is roughly **$40–105M a year [DERIVED; assumption-heavy]**.
- **[SOFT]** The vendor ecosystem is organised enough to run expos twice a year:
  - RGV Wedding & Quince Expo at the McAllen Convention Center, Feb 15 and Sept 27, 2026: https://experiencemcallen.com/event/rgv-wedding-quince-expo-mcallen/ and https://rgvweddingandquinceexpo.com/
  - The Valley Wedding Pages Bridal & Quince Expo, Feb 22, 2026, at Rancho Guadalupe Event Center, Edinburg, "over 400 guests": https://valleyweddingpages.com/rgv-bridal-quince-expo-february-22-2026
  - Local venue list-post (McAllen/Edinburg): https://www.forgetmenotrgv.com/blog/best-quinceanera-venues-mcallen-edinburg
- **Gap:** I could not retrieve Valley wedding counts. Texas DSHS Vital Statistics Table 39 (marriages by county) exists, but the page renders its data client-side: https://www.dshs.texas.gov/vital-statistics-data/vital-statistics-annual-reports/list-tables-and-references/table-39-marriages-and-divorces-county

### 4.2 Cross-border logistics (Pharr–Reynosa, McAllen, Laredo)

- **[HARD]** BTS incoming (northbound) trucks, calendar 2025:

| Port | Trucks |
|---|---:|
| Hidalgo (includes Pharr) | 719,184 |
| Brownsville | 306,858 |
| Progreso | 62,123 |
| Roma | 50,339 |
| Rio Grande City | 31,353 |
| **RGV total** | **1,169,857** |
| Laredo, for comparison | 2,945,388 |

  2026 through August: Hidalgo 468,678. Source: https://data.bts.gov/resource/keg4-3bc2 (Border Crossing Entry Data).
- **[HARD]** The Pharr bridge's own figures:
  - FY2024-25 total truck crossings: 688,876.
  - October 2025: 67,196, up 16.0% year over year.
  - Agriculture trucks are about 34–37% of imports from Mexico in winter months (Dec 19,275; Jan 22,636; Feb 18,449).

  Sources: https://bridge.pharr-tx.gov/crossings-and-revenues-monthly-comparison/truck-crossing-comparison/ and the monthly PDFs, e.g. https://bridge.pharr-tx.gov/wp-content/uploads/2025/04/Crossings-Rev.-for-March-2024-2025.pdf
- **[SOFT]** The City of Pharr says the bridge carries "over 65% of the nation's fresh produce imports from Mexico" and "more than $47 billion in annual trade" (release of 2024-10-15): https://pharr-tx.gov/pharr-bridge-celebrates-30-years-of-connecting-two-nations-with-11th-annual-produce-season-kickoff/
- **[HARD]** Business supply in CBP 2023:
  - 218 freight-arrangement establishments (488510, LQ 3.99), 190 of them with 1–19 employees.
  - 194 produce wholesalers (424480, LQ 15.8).
  - 23 refrigerated warehouses (LQ 6.7).
  - 539 employer trucking firms (484).
  - **11,428 nonemployer truckers** (NES 2022, LQ 2.61).
- **[HARD]** FMCSA Company Census, active, physical ZIP 785xx, queried 2026-09-25 (https://data.transportation.gov/resource/az4n-8mr2):
  - 10,288 registrants, 5.3% of Texas (population share 4.6%).
  - 946 hold broker authority (6.0% of Texas).
  - 169 are freight forwarders.
  - 7,985 for-hire carriers with 1–19 power units.
  - **3,408 carriers declare produce cargo, 23.2% of all Texas produce carriers** (5.1 times the population share).
- **[SOFT, directory]** Licensed customs brokers by city (CustomsBrokerIndex, derived from CBP broker licences):

| City | Brokers |
|---|---:|
| Brownsville | 19 |
| Pharr | 17 |
| McAllen | 16 |
| Hidalgo | 10 |
| Mission | 4 |
| Edinburg | 1 |
| Alamo | 1 |
| **RGV total** | **≈68** (of 491 in Texas) |
| Laredo | 216 |

  The Hidalgo/Pharr port page lists 49 brokers authorised there. Sources: https://customsbrokerindex.com/texas/ and https://customsbrokerindex.com/port-hidalgo-pharr/
- **[SOFT, inference]** Why Spanish-speaking callers matter here:
  - The Valley population is 91% Hispanic.
  - The counterparties are Mexican agentes aduanales, carriers and growers in Reynosa, Tamaulipas and Michoacán.
  - Local brokers advertise themselves as "customs broker / agencia aduanal", for example Mendiola Customs Brokerage in Mission (https://www.rgvcustoms.com/). Posey International in Brownsville advertises a bilingual team (https://posey-intl.com/brownsville-tx/).
  - The day's work is document exchange: commercial invoices, pedimentos, bills of lading, PACA and USDA paperwork. That fits BIS's documents module better than a booking calendar.
  - I found no survey measuring the Spanish share of calls.

### 4.3 Immigration and family law; notario-fraud rules

- **[HARD]** Attorney supply, from the State Bar of Texas *2023-24 Attorney Population Density* report (https://www.texasbar.com/AM/Template.cfm?Section=Archives&Template=%2FCM%2FContentDisplay.cfm&ContentID=66372):

| County | In-state attorneys | Residents per attorney |
|---|---:|---:|
| Hidalgo | 1,132 | 794 |
| Cameron | 587 | 727 |
| Starr | 42 | 1,570 |
| Willacy | 9 | 2,226 |
| **Valley total** | **1,770** | **≈797** |
| Texas | 98,345 | 310 |

  Each Valley attorney serves about 2.6 times as many residents as the Texas average.
- **[HARD]** CBP 2023 has 510 law-office establishments (LQ 1.23). 450 of them have fewer than 10 employees, and 369 have fewer than 5. NES "5411" adds 872 nonemployer legal-service businesses. **These are small, overloaded solo and small-firm practices: the classic after-hours and overflow case for an intake line.**
- **[HARD, third-party compilation of EOIR data]** Harlingen Immigration Court has handled 168,440 cases since 2009 (data through Feb 2026) with a 1.4% grant rate: https://www.openimmigration.us/courts/harlingen
- **[HARD]** TRAC's 2021 county map: neither Hidalgo nor Cameron was among the counties with more than 10,000 resident pending cases (Texas total 171,579, 45.7% represented): https://tracreports.org/immigration/reports/651/
- **[SOFT, inference]** Valley immigration practice is therefore less about removal defence and more about family-based petitions, consular processing, naturalization, DACA and border-crossing matters, alongside family law (divorce and custody across borders).
- **[HARD] Rules the receptionist must obey:**
  - **Tex. Gov't Code §406.017.** A notary commits an offence by implying they are a lawyer, by accepting pay to represent anyone in a proceeding (including immigration), or by advertising in a language other than English without a set notice. The notice must read "I AM NOT AN ATTORNEY LICENSED TO PRACTICE LAW IN TEXAS AND MAY NOT GIVE LEGAL ADVICE OR ACCEPT FEES FOR LEGAL ADVICE" and appear in English and in the advertisement's language. First offence is a Class A misdemeanour; a repeat is a third-degree felony. The ban on advertising as a "notario" or "notario público" is in the same section. https://codes.findlaw.com/tx/government-code/gov-t-sect-406-017/
  - The Texas Secretary of State lists as a prohibited act holding oneself out as an "immigration specialist" or "immigration consultant": https://notarytraining.sos.texas.gov/prohibitedacts. The page was unavailable (503) when I tried; its content is from search results.
- **[HARD]** State Bar of Texas Professional Ethics Committee **Opinion 705** (February 2025) on generative AI. It covers:
  - competence (Rule 1.01)
  - confidentiality (Rule 1.05): the lawyer must be "reasonably satisfied that the program will not reveal confidential information"
  - lawyers' responsibility for AI output, with Rule 5.03 applied by analogy
  - no billing for time the AI saved

  It does not address client-facing chatbots or intake. https://www.legalethicstexas.com/resources/opinions/opinion-705/
- **[SOFT]** Enforcement history:
  - The AG's office says it has used consumer law to shut down more than 75 unlawful immigration-service businesses since 2002.
  - In 2004 it won nearly $200K against Brownsville "notario" Martha Uresti: https://www.aila.org/library/tx-ag-closes-fraudulent-immigration-consulatant and https://www.aila.org/library/tx-attorney-combat-immigration-consultant-fraud
  - The **Texas Observer (2026-08-25)** reports that enforcement has collapsed: 11 AG immigration-fraud suits in 2014, but only 2 in 2017–2024. Victims were still paying $4,000 or more in 2024–25. https://www.texasobserver.org/notario-fraud-immigrants-detention-ken-paxton/
- **What this means for a law firm's AI receptionist [SOFT, product inference]:**
  - Identify itself as the law office's automated assistant, **never** as a "notario", "consultor de inmigración" or "asesor legal".
  - Say in Spanish and English that it is not an attorney and cannot give legal advice. Modelling the wording on the §406.017 notice is a good idea, even though that statute binds notaries rather than software.
  - Never assess eligibility ("¿califico para…?"), predict outcomes, or quote fees for legal advice unless the attorney has scripted them.
  - Route every substantive question to a consultation with a licensed attorney or DOJ-accredited representative.
  - Log conversations as confidential client communications (Rule 1.05 / Opinion 705).
  - Because enforcement is weak and fraud persists, trust signals (the attorney's name and State Bar number on the booking confirmation) help the firm, not just compliance.
  - Not re-verified this session: the Texas Penal Code also makes unauthorised practice of law an offence (§38.123).

### 4.4 Tax preparation and the refund economy

- **[HARD]** IRS SOI county data, **tax year 2023** (https://www.irs.gov/pub/irs-soi/23incyallnoagi.csv):

| Metric | Valley (4 counties) | Texas | US |
|---|---:|---:|---:|
| Individual returns | 584,370 | 13.67M | 159.0M |
| **EITC claim rate** | **36.4%** (212,590 returns) | 19.4% | 15.0% |
| EITC dollars | **$751.2M**; average $3,533 | $8.09B; $3,053 | $64.96B; $2,717 |
| Additional Child Tax Credit claim rate | 27.5% | 14.9% | 10.8% |
| Returns signed by a paid preparer | **319,450 (54.7%)** | 48.1% | 52.9% |
| Returns with refunds | 468,230; **$1.817B**; average $3,881 | $3,773 avg | $3,260 avg |
| Schedule C (self-employment) share | 28.3% | 24.4% | 19.2% |
| VITA share (free prep) | 1.36% | 1.11% | 0.97% |

  By county, the EITC claim rate is Starr 44.4%, Hidalgo 36.9%, Willacy 37.4% and Cameron 34.0%. **Starr has 68.9% paid-preparer use.** In TY2021 (expanded credits) the Valley EITC rate was 44.5%.
- **[DERIVED]** About 319k paid-prepared returns spread across roughly 770 prep businesses (139 employer and 631 nonemployer) is about 415 returns per shop per season. Most of those returns arrive in the six weeks around the EITC and ACTC refund release. That is the peak an overflow receptionist absorbs.
- **[HARD]** CBP measures employment in mid-March, so the 139 employer tax-prep establishments (LQ 1.93; 717 employees) include seasonal storefronts.
- **[SOFT]** Visible storefronts and chains include H&R Block (Rio Grande City), Jackson Hewitt (Hidalgo) and many local "income tax" shops (e.g. Raul's, Cantu's, Molina in Rio Grande City): https://www.hrblock.com/tax-offices/local/texas-tax-preparation/rio-grande-city-tax-professionals/ , https://office.jacksonhewitt.com/tax-preparation-services-locations/en/tx/hidalgo , https://www.riograndelocal.com/l/rio-grande-city-tx/tax-return-preparation
- **Gap:** I did not retrieve the IRS paid-preparer (PTIN) count by ZIP.

### 4.5 Veterinary and pet care

- **[HARD]** Supply:
  - Only **32 employer vet establishments** (LQ 0.37; per-capita index 0.22, about one-fifth of US density) and 21 nonemployer vets.
  - 9 of the 32 have 20 or more employees.
  - Pet care (grooming and boarding) has 30 employer and 186 nonemployer businesses (per-capita 0.28).
  - All vet establishments are in Hidalgo (19) and Cameron (13); Starr and Willacy have none.
- **[SOFT]** Demand indicators: the Valley has an estimated 750,000–1,000,000 stray animals. Hidalgo County's roughly 860 colonias each have 60–100 stray dogs (Texas Tribune, 2024-07-30): https://www.texastribune.org/2024/07/30/mcallen-texas-pet-population/ . RGV Humane Society takes in about 6,000 animals a year: https://www.rgvhs.org/
- **Independent vs corporate:** CBP does not record ownership, so this cannot be settled from CBP. **[SOFT]** Search results show mostly local names (Valley Animal Hospital, Companion Animal Hospital Brownsville, San Benito Animal Hospital) plus Banfield inside PetSmart. National consolidation keeps accelerating: Southern Veterinary Partners and Mission Veterinary Partners merged in late 2024 into 850+ hospitals, and Mars owns VCA, Banfield and BluePearl. https://news.vin.com/default.aspx?pid=210&catId=612&Id=12221520 , https://valleyanimal.net/services/ , https://cahrgv.com/
- **Reading:** this is an under-supplied, price-sensitive market. It has high demand for low-cost spay and neuter and few clinics. The clinics that exist are probably overloaded with calls, but there are only about 50 of them.

### 4.6 Real estate

- **[HARD]** TREC active licensees by county, queried 2026-09-25 (https://data.texas.gov/resource/s7ft-44qi):

| County | Sales agents | Individual brokers | Broker companies |
|---|---:|---:|---:|
| Hidalgo | 1,724 | 279 | 185 |
| Cameron | 854 | 204 | 97 |
| Starr | 27 | 4 | 2 |
| Willacy | 10 | 3 | 0 |
| **Valley total** | **2,615** | **490** | **284** |
| Texas total | 140,846 | 33,472 | 13,779 |

  The Valley holds 1.86% of Texas agents against 4.58% of its population, **0.41 times the per-capita density**. That matches the CBP data: 190 employer real-estate offices (LQ 0.46) and 1,306 nonemployers (NES LQ 0.31).
- **[SOFT]** The Greater McAllen Association of REALTORS claims "more than 460 members" and to be the Valley's largest and oldest (since 1949): https://www.gmar.org/about-us/ . The Valley has about three MLS databases (GMAR's, and the "RGV MLS" formed when the Brownsville and Harlingen MLSs merged): https://www.rgv-realty.com/mls-search.php
- **[HARD, association survey]** Texas-wide: about 7,500 international buyers bought Texas homes from April 2024 to March 2025. **30% were from Mexico**, and Texas takes 40% of all Mexican purchases in the US. International buyers were 2.3% of Texas sales. (Texas REALTORS / NAR, 2025-08-14: https://www.texasrealestate.com/about-us/newsroom/news-releases/international-homebuying-activity-in-texas-is-up/). There is no Valley breakdown.
- **[SOFT]** Marketplace (2019) reports affluent buyers from Monterrey and Reynosa in McAllen, with flows sensitive to border politics: https://www.marketplace.org/story/2019/03/14/border-life-unique-housing-market-mcallen
- **Reading:** this segment is small in the Valley, but each agent is busier.

### 4.7 Insurance

- **[HARD]** Texas Department of Insurance licensee data, filtered to physical ZIP 785xx (≈ the four counties) and compared with all Texas addresses, queried 2026-09-25 (https://data.texas.gov/resource/3yqc-fcdt and https://data.texas.gov/resource/kxv3-diwf). The index is RGV share of Texas ÷ RGV population share (4.58%):

| License type | RGV | Texas | RGV share | Per-capita index |
|---|---:|---:|---:|---:|
| General Lines **agencies** | 681 | 14,050 | 4.8% | 1.06 |
| **County Mutual agents** (Texas's non-standard-auto channel) | 275 | 2,267 | **12.1%** | **2.65** |
| **Life agent, ≤$25,000 face (burial and final-expense)** | 494 | 1,793 | **27.6%** | **6.0** |
| **Pre-need (prepaid funeral) agents** | 540 | 3,864 | **14.0%** | **3.05** |
| Limited Lines agents | 699 | 7,588 | 9.2% | 2.0 |
| Personal-lines P&C agents | 912 | 17,579 | 5.2% | 1.13 |
| General Lines agents (individuals) | 6,842 | 198,531 | 3.4% | 0.75 |
| Title agencies | 18 | 799 | 2.3% | 0.49 |

- **[HARD]** CBP: 524 employer insurance agencies (LQ 1.57; LQ vs Texas 1.38). 513 of them have 1–19 employees, which makes this **the largest non-HIPAA small-establishment count on the requested list.** NES adds 1,461 nonemployer agents.
- **[SOFT]** Texas county mutuals exist to write non-standard auto risks (https://corporate.findlaw.com/corporate-governance/texas-county-mutuals-their-tradition-and-their-future.html). Local agencies market bilingual quotes and accept matrícula consular, Mexican licences, ITIN and passports, e.g. https://alaautoinsurance.com/auto-insurance-mcallen
- **[SOFT]** A 2025 IRC study covers uninsured and underinsured motorists (report dated 2025-02-20), but the state figures sit behind a sign-in, so I could not confirm a Texas or Valley rate: https://insurance-research.org/uninsured-motorists/uninsured-and-underinsured-motorists-2017-2023
- **Reading:**
  - The agent-licence mix is itself the market signal: non-standard auto, burial life and pre-need funeral, sold face-to-face and by phone in Spanish.
  - Pair this with funeral homes, which have LQ 1.76 vs Texas. Those agents are often tied to funeral homes, so funeral homes plus burial and pre-need agents form a cluster.

### 4.8 Other segments concentrated in the Valley

**Licensed trades and personal-care supply (TDLR, all licences, Valley counties vs Texas, queried 2026-09-25, https://data.texas.gov/resource/7358-krk7) [HARD]:**

| License type | Valley | Texas | Per-capita index |
|---|---:|---:|---:|
| **Full-service (cosmetology/barber) establishments** | **2,204** | 35,611 | 1.35 |
| Manicurist establishments | 87 | 845 | 2.25 |
| Manicurist/esthetician, esthetician and mini establishments combined | 617 | — | mixed; mini establishments 0.14 |
| Class A barbers | 2,301 | — | 1.62 |
| Eyelash-extension specialists | 390 | — | 1.53 |
| A/C contractors | 732 | — | 0.78 |
| Electrical contractors | 413 | — | 0.64 |
| Used auto-parts recyclers | 77 | — | 2.26 |

- **Beauty:** CBP counts only about 238 employer beauty and barber establishments, but **TDLR licenses about 2,950 salon and barber premises.** The addressable count for booking software is roughly 12 times the CBP figure.
- **Trades:** licensed A/C and electrical contractors are under-represented in the Valley, which matches their low employer LQs.

**Finance:** installment lenders (270 establishments, LQ 8.9), pawn and title (94, LQ 4.0), check cashing and remittance (77, LQ 2.7), casas de cambio (23, LQ 11.5) and rent-to-own (25, LQ 2.25). **[SOFT]** Many of these are branches of multi-state chains; NAICS 522298 explicitly covers pawnshops and car-title lending. I could not find a Texas OCCC licensee file on data.texas.gov to separate independents from chains.

**Real estate and development:** land subdivision (44 establishments, LQ 4.0) is the colonia and owner-financed lot market, which is contract-heavy and Spanish-first. Lessors of other real estate (53, LQ 2.4) may include mobile-home and RV lots, including those serving Winter Texans.

---

## 5. What the numbers say

**Ranking rule.** Score = (published 1–19-employee establishments, CBP 2023) × (LQ vs US). I applied it to every 6-digit code with LQ ≥ 1.0, not just the requested list, after these exclusions:
- HIPAA-gated codes: 621\*, 622\*, 623\*, 624120, and health and personal-care stores.
- Codes flagged "reference": child day care (score 1,072), full- and limited-service restaurants (600 and 622), religious and civic organisations.
- Segments with no plausible BIS use (walk-in retail, commodity manufacturing, or chain-controlled, so no local buyer):
  - tortillerías: 762
  - dollar stores: 654
  - auto-parts chains: 388
  - gas stations: 336
  - banks: 242
  - casas de cambio: 207
  - check cashers: 204
  - snack bars: 179
  - HOAs: 173
  - hotels: 161
  - shrimpers: 154

The **12 most promising non-HIPAA segments**, in score order:

| # | NAICS | Segment | Score | Notes |
|---:|---|---|---:|---|
| 1 | 424480 | **Produce wholesalers and brokers** | 2,605 (165 × 15.79) | Pharr is the US gateway for Mexican produce. Bilingual phones, CRM and documents (PACA, bills of lading) fit; there is no booking use, so this is a CRM and documents sale, not a receptionist sale. |
| 2 | 522291 | **Consumer installment lenders** | 2,373 (266 × 8.92) | The most over-concentrated large finance segment; Spanish-first callers and document-heavy work. Caveat: many are chain branches, and outbound collection calls fall under TCPA/FDCPA. |
| 3 | 524210 | **Insurance agencies** | 804 (513 × 1.57) | The largest pure small-business pool. TDI shows 12% of Texas county-mutual agents and 28% of its burial-life agents here; the business is Spanish quote calls. **Best overall fit.** |
| 4 | 488510 | **Freight arrangement: customs brokers and forwarders** | 757 (190 × 3.99) | 1.17M northbound trucks through RGV ports in 2025, about 68 licensed customs brokers and 946 FMCSA brokers. Bilingual calls with Reynosa counterparts plus heavy paperwork. |
| 5 | 541110 | **Law offices** | 604 (490 × 1.23) | 1 attorney per about 800 residents vs 1:310 statewide means overflow intake. Must ship with the anti-notario and no-legal-advice guardrails in §4.3. |
| 6 | 484121 | **Truckload carriers** | 485 (255 × 1.90) | Plus 11,428 nonemployer truckers (NES LQ 2.61). Dispatch and broker calls; low revenue per account. Easier to reach through the freight brokers who dispatch to them. |
| 7 | 522298 | **Pawn and title lenders** | 365 (91 × 4.01) | Highly concentrated but chain-heavy, with little appointment need. Low priority. |
| 8 | 441120 | **Used-car dealers** | 303 (136 × 2.23) | Plus 1,462 nonemployer dealers (NES LQ 2.42). Spanish lead follow-up, credit applications and buy-here-pay-here paperwork, test-drive booking. Strong fit. |
| 9 | 541213 | **Tax preparers** | 261 (135 × 1.93) | Plus 631 nonemployers. EITC claim rate 2.4 times the US, 319k paid-prep returns, $1.8B in refunds. A sharp January–April peak where a receptionist pays for itself. |
| 10 | 531120 | **Nonresidential lessors (event halls as proxy)** | 209 (132 × 1.59) | About 11,900 girls turn 15 each year, plus weddings. Booking, deposits and contracts fit well. Party rental (532289, score 57) and panaderías (311811, score 85) are the adjacent vendors. |
| 11 | 236115 | **Residential general contractors and homebuilders** | 183 (162 × 1.13) | Lead intake, estimates and contracts. Only mildly concentrated. |
| 12 | 237210 | **Land subdivision and lot developers** | 151 (38 × 3.96) | Owner-financed colonia lots sold to Spanish-speaking buyers; contract-for-deed paperwork. A small count but very strong fit. |

**Just outside the 12:**
- bookkeeping (541219): 129
- lessors of other real estate (531190): 123
- retail bakeries: 85
- tire dealers: 77
- party rental: 57
- funeral homes (812210): 48. The raw score is low, but TDI data shows 3–6 times Texas concentration of pre-need and burial-life agents, which makes it a strong adjacent cluster with insurance.

**Two lenses the formula misses:**
1. **Nonemployer-heavy trades and personal services** have employer LQs below 1 but nonemployer LQs of 1.5–2.6. Examples: roofing, electrical, HVAC, auto repair, landscaping (4,321), janitorial (7,792), caterers and food trucks (3,314), party and personal services (3,677). Beauty and barber are the largest booking-software pool by licence count, about 2,950 TDLR-licensed premises. The number of businesses is large, but most are one-person operations that pay little.
2. **Weak spots:** vets, pet care, real estate and landscaping employers are thin on every measure. Do not lead with them in the Valley.

**How far to trust the ranking:** it rests on hard CBP counts but treats an LQ of 15 as 15 times better. That overweights produce wholesale and consumer lending, where the local business owner often is not the software buyer. Judged by fit to the product (bilingual CRM, AI receptionist, booking and documents together), the strongest first markets are:
1. insurance agencies
2. tax preparers
3. customs and freight brokers
4. used-car dealers
5. law offices, with guardrails
6. event venues and quince vendors

---

## 6. Gaps and things I could not verify

- Valley marriage counts: the Texas DSHS Table 39 data is rendered client-side and could not be scraped.
- County-level uninsured-motorist rate: the IRC data is paywalled.
- Share of callers who are Spanish-dominant: no survey found.
- Current pending immigration cases by Valley county of residence: TRAC's current tool is interactive; I have only the 2021 snapshot.
- IRS PTIN counts by ZIP were not pulled.
- A Texas OCCC lender licence list, needed to separate independent lenders from chains, was not found on the open data portal.
- The web-search budget for the session ran out near the end, so I could not re-check the Penal Code §38.123 citation.
- The ACS language-spoken-at-home share could not be pulled: the Census API now requires a key, and QuickFacts returned 403.

## Appendix A: Establishments by county (CBP 2023) with US and Texas bases

| NAICS | Industry | Hidalgo | Cameron | Starr | Willacy | US estabs | TX estabs |
|---|---|---:|---:|---:|---:|---:|---:|
| 541940 | Veterinary services | 19 | 13 | 0 | 0 | 34,296 | 2,707 |
| 812910 | Pet care (except veterinary) | 19 | 11 | 0 | 0 | 25,551 | 1,921 |
| 541110 | Offices of lawyers | 337 | 157 | 13 | 3 | 165,491 | 13,755 |
| 541191 | Title abstract & settlement offices | 12 | 14 | 0 | 0 | 9,825 | 839 |
| 524210 | Insurance agencies & brokerages | 345 | 163 | 16 | 0 | 133,728 | 12,147 |
| 541213 | Tax preparation services | 81 | 50 | 8 | 0 | 28,762 | 2,460 |
| 541211 | Offices of CPAs | 67 | 25 | 0 | 0 | 55,052 | 3,992 |
| 541219 | Other accounting services (bookkeeping) | 88 | 37 | 3 | 0 | 47,699 | 3,988 |
| 531210 | Offices of real estate agents & brokers | 118 | 69 | 3 | 0 | 163,894 | 11,327 |
| 531311 | Residential property managers | 82 | 35 | 0 | 3 | 60,818 | 4,848 |
| 531320 | Offices of real estate appraisers | 17 | 4 | 0 | 0 | 12,346 | 744 |
| 488510 | Freight transportation arrangement | 140 | 71 | 7 | 0 | 21,873 | 2,796 |
| 484 | Truck transportation (total) | 377 | 142 | 13 | 7 | 170,286 | 14,146 |
| 811111 | General automotive repair | 105 | 39 | 3 | 0 | 84,859 | 6,258 |
| 811121 | Automotive body, paint & interior repair | 28 | 15 | 0 | 0 | 35,029 | 2,632 |
| 811192 | Car washes | 24 | 16 | 0 | 0 | 19,807 | 1,766 |
| 441320 | Tire dealers (=441340 in NAICS 2022) | 49 | 15 | 0 | 0 | 20,250 | 1,671 |
| 4413 | Auto parts, accessories & tire retailers (parent) | 175 | 75 | 13 | 0 | 58,817 | 5,195 |
| 441120 | Used car dealers | 83 | 57 | 0 | 0 | 25,147 | 2,472 |
| 441110 | New car dealers | 42 | 33 | 3 | 0 | 21,910 | 1,625 |
| 561710 | Exterminating & pest control | 21 | 19 | 0 | 0 | 16,535 | 1,404 |
| 561730 | Landscaping services | 36 | 27 | 0 | 0 | 117,969 | 5,501 |
| 561720 | Janitorial services | 38 | 28 | 0 | 0 | 67,799 | 3,775 |
| 238220 | Plumbing, heating & A/C contractors | 138 | 71 | 4 | 0 | 111,207 | 8,909 |
| 238210 | Electrical contractors | 85 | 38 | 0 | 0 | 83,342 | 6,057 |
| 238160 | Roofing contractors | 21 | 17 | 0 | 0 | 25,519 | 2,370 |
| 812111 | Barber shops | 12 | 3 | 0 | 0 | 7,789 | 552 |
| 812112 | Beauty salons | 96 | 34 | 4 | 0 | 84,176 | 5,672 |
| 812113 | Nail salons | 17 | 9 | 0 | 0 | 34,417 | 1,823 |
| 812199 | Other personal care services (spas etc.) | 42 | 21 | 0 | 0 | 31,863 | 2,562 |
| 713940 | Fitness & recreational sports centers | 48 | 23 | 0 | 0 | 41,556 | 3,337 |
| 611610 | Fine arts schools | 17 | 6 | 0 | 0 | 16,284 | 1,095 |
| 611620 | Sports & recreation instruction | 17 | 9 | 0 | 0 | 20,916 | 1,711 |
| 611691 | Exam prep & tutoring | 9 | 3 | 0 | 0 | 9,820 | 833 |
| 611692 | Automobile driving schools | 6 | 3 | 0 | 0 | 2,648 | 177 |
| 812210 | Funeral homes & funeral services | 31 | 12 | 3 | 0 | 15,183 | 841 |
| 812320 | Drycleaning & laundry (except coin-op) | 14 | 4 | 0 | 0 | 15,801 | 1,366 |
| 531120 | Lessors of nonresidential buildings | 91 | 46 | 0 | 0 | 34,559 | 3,260 |
| 812990 | All other personal services | 26 | 8 | 0 | 0 | 24,681 | 1,697 |
| 541921 | Photography studios, portrait | 16 | 0 | 0 | 0 | 11,483 | 743 |
| 722320 | Caterers | 18 | 8 | 0 | 0 | 13,222 | 807 |
| 311811 | Retail bakeries | 29 | 16 | 3 | 0 | 9,219 | 645 |
| 624410 | Child day care services | 303 | 157 | 12 | 10 | 82,162 | 6,159 |
| 722511 | Full-service restaurants | 455 | 282 | 18 | 10 | 258,626 | 20,771 |
| 722513 | Limited-service restaurants | 522 | 311 | 37 | 11 | 270,088 | 24,319 |
| 621210 | Offices of dentists | 228 | 75 | 8 | 0 | 135,665 | 11,810 |
| 621111 | Offices of physicians (non-mental health) | 671 | 333 | 21 | 4 | 204,617 | 21,420 |
| 621340 | Offices of PT/OT/speech therapists & audiologists | 122 | 39 | 11 | 0 | 52,058 | 3,215 |
| 813110 | Religious organizations | 202 | 131 | 13 | 8 | 186,801 | 14,757 |
| 813 | Religious, grantmaking, civic, professional orgs (total) | 316 | 280 | 14 | 13 | 309,008 | 21,368 |
| 541810 | Advertising agencies | 15 | 4 | 0 | 0 | 15,512 | 1,220 |

## Appendix B: Reproduction

Working files are in `…/scratchpad/f/`:
- `cbp.py`: master table (`valley_master.csv`)
- `scan.py`: all-6-digit LQ scan (`scan6.csv`)
- `nes.py`: nonemployer join (`nes.json`)
- `codes.json`: requested codes

Filters used:
- CBP: `fipstate=="48"` and `fipscty in {215,061,427,489}`
- US file: `lfo=="-"`
- NAICS strings padded as `NNNNNN`, `NNNNN/`, `NNNN//`, `NNN///`

LQ bases: Valley 20,908; Texas 670,877; US 8,361,342 establishments.
