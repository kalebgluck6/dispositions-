# SameDayInvestments — Investor Deal Distribution System

Send every property you get under contract to your investor network with one click.

The system runs on **Google Sheets** (the database) and **Google Apps Script** (the app and email engine). There's no server to host and no extra subscription. Emails go out from your own Gmail or Google Workspace account.

| | |
|---|---|
| **Investor database** | Import your existing list from any Google Sheet (columns are matched automatically). You can add, edit, deactivate, delete, tier and categorize investors one at a time or in bulk. Each investor stores a buy box: markets, property types and a price range. |
| **Deal submission** | Address, property type, asking price, assignment price, ARV, repairs, square footage, beds/baths, lot size, year built, photos, video walkthrough, description, closing date and access instructions. Spread, all-in % of ARV and price per square foot are calculated as you type. |
| **SEND TO INVESTOR NETWORK** | Sends to all active investors, chosen tiers/categories/markets, or investors you pick by hand. It can limit the send to investors whose buy box matches the deal and skip anyone who already received it. You preview the email, send yourself a test, then confirm. |
| **Privacy** | Every investor gets their **own** email with a single recipient. There's no CC, BCC or group send, so no investor ever sees another investor's address. |
| **Tracking** | Records which investors received each deal and when, logs replies automatically from your Gmail inbox (*Interested*, *Offer* with the amount, *Not interested*, *Unsubscribe*), and has a follow-up pipeline for each response. Deals can be marked **Available / Pending / Sold**. |
| **New buyers, daily** | Every morning the system finds new buyers from four sources: your VIP buyer signup form, a Google Sheet you or a VA keep updated, a cash-buyer export from public records, and Gmail inquiries. It fills in their buy box and puts them in a **review queue**. Nobody receives a deal until you approve them. |
| **Safety** | **Test mode is on by default.** To go live you type `GO LIVE`, and every live send also needs you to type `SEND`. |

---

## How it works

```
Google Sheet (database)                 Apps Script web app (private to you)
├── Investors           ◄────────────── Investors · Import · Bulk edit
├── Deals               ◄────────────── Submit Deal · Photos/Video → Google Drive
├── Distribution Jobs   ◄────────────── SEND TO INVESTOR NETWORK
├── Distribution Log    ◄──── one row per investor per send ──► Gmail (1 email / investor)
├── Responses           ◄──── inbox scanner (every 15 min) ◄── investor replies
└── Settings
```

* **Photos** are resized in your browser, stored in a Google Drive folder for each deal, and **embedded directly in the email**, so they display without public hosting. If you want, investors can also get a link to the full Drive gallery.
* **Buttons in the email** (*I'm Interested*, *Make an Offer*, *Not for me*, *Unsubscribe*) open a reply with the deal ID already in the subject. That lets the inbox scanner classify each reply and attach it to the right deal and investor.
* **Large lists and sending limits:** Google caps daily email sends at about 100/day on a free Gmail account and about 1,500/day on Google Workspace. If a distribution runs past the limit, the rest is queued and sends automatically when the limit resets. Long sends also continue in the background.

---

## Setup (about 10 minutes)

### 1. Create the database sheet
1. Create a new Google Sheet, for example **"SameDayInvestments — Deal Database"**, using the Google account you want deals to be emailed from.
2. Open **Extensions → Apps Script**.

### 2. Add the code
**Option A: copy and paste 3 files (easiest)**
The [`dist/`](dist) folder has the whole app in 3 files:
1. Project Settings ⚙ → tick **"Show 'appsscript.json' manifest file in editor"**, then replace `appsscript.json` with [`dist/appsscript.json`](dist/appsscript.json).
2. Replace everything in `Code.gs` with [`dist/Code.gs`](dist/Code.gs).
3. Click **+ → HTML**, name it `Index`, and replace its contents with [`dist/Index.html`](dist/Index.html).
4. Click 💾 Save.

(Rebuild these after code changes with `node tools/build-bundle.js`.)

**Option B: copy and paste the individual source files**
1. In the Apps Script editor, open **Project Settings ⚙** and tick **"Show 'appsscript.json' manifest file in editor"**.
2. Replace the contents of `appsscript.json` with [`src/appsscript.json`](src/appsscript.json). If you're not in the US Eastern time zone, change `timeZone`.
3. For each `.gs` file in [`src/`](src), click **+ → Script**, give it the same name (without `.gs`), and paste in the contents:
   `Code`, `Config`, `Data`, `Settings`, `Investors`, `Import`, `Deals`, `Email`, `Distribution`, `Responses`. Delete the default `Code.gs` contents first.
4. For each `.html` file, click **+ → HTML** and use the same name: `Index`, `Styles`, `App`.

**Option C: clasp (command line)**
```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # then put your script ID in it (Apps Script → Project Settings → Script ID)
clasp push
```

### 3. Run setup
1. In the editor, select the function **`setup`** and click **Run**.
2. Approve the permissions. The app needs access to Sheets (database), Drive (deal photos and videos), Gmail (sending and reading replies) and triggers (background sending and reply tracking). Everything runs inside your own Google account.
3. Setup creates the tabs (Investors, Deals, Distribution Jobs, Distribution Log, Responses, Settings) and a Drive folder for deal media. Running it again later is safe and never deletes data.

### 4. Deploy the web app
1. Click **Deploy → New deployment → ⚙ → Web app**.
2. Set **Execute as: Me** and **Who has access: Only myself**. If teammates on the same Google Workspace domain need it, choose your domain instead.
3. Click **Deploy** and bookmark the **Web app URL**. That URL is your Deal Distribution app.
4. Reload the Sheet. A **SameDayInvestments** menu appears with a link to the app.

> After any code change: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

### 5. Configure (in the app → Settings)
* **Company & Contact:** contact name, phone, email, website and **mailing address**. A physical address is legally required in commercial email (CAN-SPAM), and the app won't go live without one.
* **Email:** from name, reply-to address and subject line. Keep `{{DEAL_ID}}` in the subject so replies are tracked automatically.
* **Investor lists:** your tiers, categories, property types and **markets**.
* **Response tracking:** click **Turn on** to scan the inbox for investor replies every 15 minutes.

### 6. Import your investors
In **Import Investors**, paste the link to your existing investor Google Sheet and pick the tab. Then check the column matches and import. The importer:
* finds the header row automatically and maps common column names (`Name`, `E-mail Address`, `Cell`, `Buyer Type`, `Areas`, `Max Budget`, …)
* splits a single "Full Name" column into first and last name
* reads prices like `$250,000`, `180k` or `1.2M`
* skips invalid emails and duplicates, and can update investors who already exist (matched by email)

### 7. Test, then go live
1. Submit a deal with photos.
2. On the deal page, open **Email Preview** and click **Send test email**.
3. Click **SEND TO INVESTOR NETWORK** while still in test mode. The whole distribution runs, but only the first 3 emails are delivered, all to your test address. Each one has a yellow banner naming the investor it would have gone to. Nobody else is emailed.
4. When you're happy with it: **Settings → Switch to LIVE mode**, then type `GO LIVE`.

---

## Daily use

1. **Submit Deal**: fill in the property and numbers, then drag in photos and add a video link or upload a video.
2. Click **SEND TO INVESTOR NETWORK** on the deal card or deal page:
   1. **Audience**: all active investors, tiers/categories/markets, or hand-picked investors. Optionally limit to buy-box matches and skip previous recipients. The recipient count and list update live.
   2. **Preview**: the exact email each investor receives, plus a "send me a test" button.
   3. **Confirm**: a summary of the deal, audience, recipient count and remaining daily quota. In live mode you type **SEND** before the button unlocks.
3. Watch **Responses** for interested buyers and offers, and move each one through *New → Contacted → Showing Scheduled → Offer Received → Under Contract → Closed*.
4. Mark the deal **Pending** (with the buyer) and then **Sold** (with the final price). Sold deals can't be distributed again.

Everything is also visible directly in the Google Sheet, so you can filter, sort and build pivot tables there.

## Disposition engine (matching, offers, verification, follow-ups, pipeline)

The sidebar is organized as **Main Navigation**, **Buyer Management**, **Distribution & Communication** and **Operations**.

### Buyer buy-box profiles
Each investor profile holds:
* preferred cities/markets and **zip codes**
* property types, min/max price and **min/max acreage**
* **rehab vs. turnkey** preference
* **funding** (cash, hard money, private lender, conventional)
* **preferred ROI %** and **typical closing speed**
* last deal bought from you, plus purchase history from public records
* verification status (see below)

### Smart Buyer Matching
Every buyer is scored 0–100 against each deal:

| Factor | Points |
|---|---|
| Location: zip / city or market / has bought there | 30 / 25 / 20 |
| Property type | 20 |
| Price within budget | 15 |
| Acreage (land) | 10 |
| Tier | up to 10 |
| Rehab vs. turnkey | 5 |
| ROI | 5 |
| Responsiveness | 5 |
| Verified proof of funds | 3 |
| Each deal closed with you | +2 (up to +8) |
| Each contract default | −10 |

Buyers outside what they told you they buy are **excluded**, for example: outside their areas, a property type they don't buy, over their maximum price, or acreage outside their range. Fit levels are strong (70+), good (at or above your minimum, 50 by default) and weak.

**Example:** a 2-acre parcel in Suffolk matches the developers who buy land in Suffolk or 23434, and residential flippers are excluded. See it under **Buyer Matching** or on any deal's **Matches** tab.

**SEND TO INVESTOR NETWORK** now defaults to **Smart match** with **priority waves**:
* **Wave 1:** your top-tier matched buyers, sent immediately.
* **Wave 2:** the other matched buyers, 24 hours later.
* **Wave 3 (optional):** everyone else, 48 hours later.

The delays are adjustable in Settings. The distribution log records each buyer's wave and match score.

### Disposition Pipeline
Every deal has one of 11 live stages: Ready for Disposition → Distributed → Buyer Interested → Offer Received → Negotiating → Buyer Selected → Assignment Signed → EMD Received → Closing Scheduled → Closed, or Dead Deal.

* **Automatic moves:** a deal advances when it's distributed, when a buyer says they're interested, when an offer arrives and when you accept an offer. You can set any stage by hand from the deal's stage bar or the **Disposition Pipeline** board.
* **Status follows stage:** Available, Pending, Sold or Dead.
* **Stuck deals:** a deal with no stage change in 7 days is flagged.
* **Contract & Closing Tracker:** shows the assignment, EMD and closing countdown for every deal under contract. Closing a deal records a completed transaction on the buyer's profile.

### Offers & Negotiations
* **Capture:** replies like "OFFER - SDI-…" become offer records automatically, including the amount, EMD, inspection period, closing timeline, financing and whether proof of funds was mentioned. Offers can also be logged by hand.
* **What's tracked:** offer amount, **your assignment fee** (offer − the deal's private contract price), EMD, inspection period, closing date, proof of funds and contract status (Received, Countered, Accepted, Backup, Under Contract, Closed, Rejected, Withdrawn, Fell Through).
* **Comparison:** each deal's **Offers** tab shows offers side by side, ranked by a strength score: fee 40, EMD 15, proof of funds 15, buyer reliability 10, closing speed 10, inspection period 10. The best value in each row is highlighted.
* **Accepting** an offer selects the buyer and moves the other open offers to Backup. **Fell through** records a failed closing on the buyer and reopens the deal.

### Buyer Verification Center
* **Proof of funds:** upload a document (stored in a private Drive folder that is never shared by link), then verify it with an amount and expiry date. The default validity is 90 days.
* **Also tracked:** entity name, contact details, purchase history, deals closed with you, contract defaults, and a **reliability rating** (automatic from closings vs. defaults, or set by hand).
* **Flags:** expired or expiring POF, unverified POF, **buyers with failed closings**, and **open offers without verified POF**.

### Automatic Follow-Ups
Runs every 2 hours, 8 AM–8 PM. Each reminder is sent **once**, to one buyer at a time, never to opted-out buyers, and to your test address while in test mode.

| Follow-up | When |
|---|---|
| Buyer received the deal, matched it, but no response | after 48h |
| Buyer interested but no offer | after 24h |
| Offer without verified proof of funds | after 24h, up to 3 reminders 48h apart |
| Offer deadline approaching | 24h before the deal's offer deadline |
| EMD not received | 2 days after buyer selected |
| Closing coming up | 3 days before closing |
| **Rep alert:** interested or selected buyer has gone quiet | 3 days |
| **Rep alert:** deal stuck in a stage | 7 days |

Rep alerts arrive as **one digest email per rep**. A deal's rep is set on the deal (pick from the reps listed in Settings); otherwise alerts go to your Reply-To address. **Follow-Up Center** shows what's due, the alerts and the full history, and has a **Send due follow-ups now** button.

## Performance, intelligence & automation (phase 2)

### Performance Reports (CEO dashboard)
An ownership view for you and your co-owner, filterable to the last 30, 90, 180 or 365 days. Each chart can be switched to a table.

**Headline numbers:**
* assignment revenue and average assignment fee
* deals distributed and average offers per deal
* average time to secure a buyer (first distribution → buyer selected)
* distribution → contract conversion
* buyer response rate and buyer → closing conversion

**Charts and lists:**
* revenue by month, by **market** and by **disposition rep**
* the pipeline right now
* top-performing investors
* **deals sitting too long without activity**

Revenue per deal = sale price − the deal's private contract price. If the contract price isn't entered, the deal's assignment price is used.

### Buyer intelligence
* **Heat score (0–100), per buyer:**

  | Factor | Points |
  |---|---|
  | Responsiveness | 35 |
  | Interest | 15 |
  | Offers | 20 |
  | Closings and public purchases | 30 |
  | Recent activity | 10 |
  | Each failed closing | −15 |

  Written to the *Heat Score* column nightly.
* **Buyer Activity History:** each investor's profile shows every deal they were sent and how they responded: no response, passed (with the reason), made an offer, selected or bought it.
* **Closing Performance:** response rate, interested deals, offers, closings, failed closings and close rate per buyer.
* **Best Buyer Predictor:** on every Matches view, *Likely to buy* blends buy-box fit (60%) with real behavior (heat, 40%). The most likely buyers are listed first.
* **Automatic Tier Upgrades (nightly, 2 AM):**
  * **Top tier:** 2+ deals closed with you, heat 60+, and reliability 4★ or better.
  * **Second tier:** 1+ closed, or heat 45+ with verified proof of funds.
  * **Demotion:** one tier after 2+ failed closings, at most once per 90 days.
  * Every change is noted on the buyer, the thresholds are in Settings, and **Buyer Tiers** shows recommended changes before they're applied.

### Distribution tools
* **Distribution Analytics:** for every deal blast, how many buyers received it, responded, were interested and made offers, plus how many are competing, pass reasons, time to first reply and wave breakdown. Overall pass reasons are also charted.
  * Opens and clicks are **not** tracked. They need a public tracking link, and your app is private to your Google account.
* **Deal Feedback:** the "Not for me" button asks why. Replies are classified as Price, Location, Condition, Numbers, Timing or Other, and logged calls can record a reason too.
* **Buyer Competition Tracker:** shows how many distinct buyers are interested or have open offers on each deal. When 2 or more are, follow-up emails say so (it's a real count).
* **Offer Deadline System:** the deal email shows "Offers due by …", buyers get a reminder 24 hours before, and the rep gets an alert once the deadline passes with the number of offers to review.
* **Price Reduction Alerts:** lower a deal's price and a **Send price-drop alert** button appears. It goes to everyone who received the deal plus current matches, with a "PRICE REDUCED $X → $Y" subject and banner. It uses the same confirmation as any send, and test mode applies.
* **Dead Deal Recovery:** a deal with no acceptable offer (fee below *Acceptable fee*, default $5,000, and offer below 95% of asking) 5 days after distribution is flagged. The rep gets an alert, and **Buyer Tiers → Re-send to next ring** sends it to weaker matches who haven't seen it yet. Set *Automatic recovery re-send* to Yes to have the nightly job do this on its own.
* **Investor Reactivation:** finds buyers who received 2+ deals but haven't responded in 90 days and sends them a "Still buying? Update your buy box" email that links to your signup form. Each buyer is contacted at most once per 90 days, and live sends need **SEND** typed.

### Land intelligence
* **Parcel and buildability details on each land deal:** acreage, parcel ID, zoning and zoning restrictions, potential lots, density, road frontage, road access, utilities, flood zone, wetlands and soil/septic. They're shown in the investor email.
* **Land Buyers & Builders:** a land-buyer database of builders, developers and land buyers, ranked by how much land they actually buy (public records plus deals bought from you), with their buy boxes.
* **Builder Activity by Market:** shows which builders are repeatedly buying lots in each market.
* **Land deal matching:** land deals are smart-matched only to land buyers, by geography and acreage.

### Buyer Tiers & Market Management
* **Buyer Tiers:** members and average heat per tier, recommended changes, dead-deal recovery and the reactivation campaign.
* **Market Management:** edit your markets list. For each market it shows active buyers, land buyers, buyers with verified funds, available deals, deals under contract, closings, revenue, average fee and top buyers.

### Team permissions
In **Settings → Team & Permissions**, list members one per line as `email: Role`:
* **Owner:** everything, including settings, going live, the DealMachine key, schedules and deleting buyers.
* **Rep:** day-to-day work.
* **Viewer:** read-only.

When the list is blank, the app is single-user and you are the Owner.

Teammates can sign in only if the web app is deployed with **Who has access: Anyone within your Google Workspace domain**, because Google only reveals a visitor's email to apps in the same Workspace. On a personal @gmail.com account, keep *Only myself*. Background jobs aren't affected by roles.

## New Buyers (daily intake)

Open **New Buyers** in the app. Turn on the sources you want and click **Turn on daily intake**, choosing the hour it runs (6 AM by default).

| Source | How it finds buyers | Buy box comes from |
|---|---|---|
| **VIP Buyer Signup Form** | Click **Create my VIP buyer signup form**, then share the link on Facebook groups, Instagram, your website, your email signature and at meetups. Signups are added the moment they submit. | Their answers: markets, property types, strategy, price range, buy box, funding. They also tick a box consenting to deal emails. |
| **Google Sheet Sync** | Paste the link to any sheet you or a VA keep adding buyers to. It needs an Email column. Each day only new rows are added. | Whatever columns the sheet has (same automatic matching as Import). |
| **Cash Buyers from Public Records** | Export recent cash sales for your area from PropStream, BatchLeads, PropertyRadar, DealMachine or county records into a Google Sheet and paste its link. Click **Check sheet** to confirm the columns were recognized. Financed purchases and sales older than the window are ignored. Sales are grouped by owner, so an LLC that bought 3 houses becomes one buyer. | What they actually bought: the cities, a price range (lowest purchase −20% to highest +20%), property types, and a list of the purchases. |
| **Gmail Buyer Inquiries** | Finds emails asking to join your list ("add me to your buyers list", "send me deals", "cash buyer"…). You can edit the phrases. Replies to your deal emails are excluded; those go to Responses. | Read from the email: phone number, your markets that are mentioned, property types, price range ("$80k–$250k", "under 200k") and strategy (flip, rental, BRRRR, cash). |

* Every new buyer is added with status **Pending Review**. Pending buyers never receive deals.
* **Approve** (optionally with a tier) or **Reject** each buyer, or select several at once. Approval requires an email address. Public-records owners often have none, so they show **⚠ Needs email**: skip trace them, click ✏️ and add the email, then approve.
* Duplicates are caught by email, or for owners without email by name plus mailing address. When a known cash buyer makes another purchase, their purchase history is updated instead of creating a second record.
* On days when new buyers are found, you get a summary email listing them, with a button to review. You can turn this off.
* Everything is recorded in the **Buyer Intake Log** sheet.
* **Direct data-provider connection:** the cash-buyer source currently reads an export sheet. A direct API connection to a provider such as BatchData, PropertyRadar or ATTOM can be added once you pick one and have an API key. That would also do skip tracing automatically.

## Automatic buyers from public records (morning + night)

Open **New Buyers** and click **Turn on morning + night intake**. The default times are 6 AM and 7 PM, and you can change them. Two sources pull active investors from recorded sales.

### DealMachine: all your areas
Covers 22 localities through DealMachine (needs an API key): Hampton Roads (Virginia Beach, Norfolk, Chesapeake, Portsmouth, Suffolk, Hampton, Newport News, **Poquoson**, York, Williamsburg, James City, Isle of Wight, Gloucester), **Richmond** (Richmond City, Henrico, Chesterfield, Hanover) and **Elizabeth City, NC** (Pasquotank, Camden, Currituck, Perquimans, Chowan). Click a chip to add or remove an area. Without DealMachine, the free public records below cover 16 of these.

Each run finds properties that **sold in the last 14 days** (adjustable) where the buyer:
* paid **cash**: no mortgage on the property, and the owner doesn't live there;
* used a **hard-money / private lender** (optional);
* is a **new-construction / land buyer**: a cash purchase of **residential vacant land or lots** by an owner who holds at least 2 properties, i.e. builders and developers rather than one-time lot buyers. These are tagged **Developer** with property type **Land**.

Sales by the same owner are combined into one buyer, and the buy box comes from what they bought. With "Get phone + email" on, DealMachine supplies the owner's contact details. Phones on the **Do-Not-Call** list are never stored as the contact number; they're noted instead.

**Connect it:** in DealMachine, go to **Settings → Developer** ([dealmachine.com/settings/developer](https://dealmachine.com/settings/developer)), click **Create API Key**, and paste the key into the DealMachine card. The key is stored privately in the script's properties, never in the spreadsheet, and is checked before it's saved. Your DealMachine plan must include API data access.

**Credits:** DealMachine charges 1 credit per property and 1 per contact, and never charges twice for the same record in a month. Each run only processes sales it hasn't seen before. You control spend with **Max properties per run** (shared fairly between cash, hard-money and land searches) and **Monthly credit limit**. **Preview matches (free)** shows how many sales match right now without using credits.

### Free public records: Hampton Roads, Richmond & NE North Carolina
Turned on by default in **New Buyers → Public Records**.

**Serious investors only.** Every investor purchase found is written to the **Purchase Ledger** sheet. A buyer is added to your review queue only after they make **3 or more purchases within 90 days**. You can change both numbers on the Public Records card.
* Owner-change areas refresh only every few months, so the bar scales with the refresh period. For example, a 6-month refresh needs 7 or more new parcels.
* Once a buyer qualifies, their later purchases keep being added to their history.
* **Logged:** companies, LLCs and investment trusts; individuals only for land or when they don't live at the property.
* **Never logged:** homeowners, family trusts living in the home, government, banks (foreclosures), churches and HOAs.
* **Tags:** purchases are labeled **Residential**, **Commercial** (tagged *Commercial Buyer*) or **Land** (tagged *Developer*).
* **One-time cleanup:** pending buyers added under the old one-purchase rule are moved to Inactive. They stay in the sheet with a note.

| Area | Source | How buyers are found |
|---|---|---|
| Norfolk | City of Norfolk open data | Live recorded sales (buyer, date, price) |
| York County / Yorktown | York County land-records layer | Live recorded sales with buyer, mailing address, date and price. Bulk deeds that repeat one total price on every parcel are split across the parcels. |
| Richmond City | City of Richmond parcel owners (updated about weekly) | Owner-change watch |
| Virginia Beach, Portsmouth, Suffolk, Newport News, Isle of Wight (Smithfield), Williamsburg, James City County, Gloucester County | HRGEO Hampton Roads regional parcels (refreshed about twice a year) | Owner-change watch |
| Elizabeth City (Pasquotank), Camden, Currituck (Moyock), Perquimans, Chowan | NC OneMap statewide parcels | Owner-change watch |

**Owner-change watch:** these localities publish who owns each parcel but not sale dates. The app keeps a private snapshot of every parcel's owner in a Drive folder that is never shared. Each time a locality refreshes its data, every parcel with a new owner counts as a purchase by that new owner.
* The **first run only saves the snapshot**, so buyers start appearing at the next refresh.
* Large cities take a few background runs (Virginia Beach is about 157,000 parcels).

**Not available for free:** Chesapeake, Hampton, Poquoson, Henrico, Chesterfield and Hanover don't publish owner names or sales in a feed that can be pulled. For those, use a cash-buyer export sheet (PropStream, BatchLeads, PropertyRadar) or DealMachine. Free records never show whether a purchase was paid in cash.

Why not Zillow: it forbids automated collection and doesn't publish who bought a property or whether they paid cash.

The same company found by several sources (for example DealMachine and Norfolk records) is kept as **one** buyer, and each new purchase is added to their history. Everyone still goes to **Waiting for your review**.

## The data (Google Sheet tabs)

| Tab | One row per… | Key columns |
|---|---|---|
| **Investors** | investor | ID, name, company, email, phone, tier, categories, preferred markets, property types, min/max price, buying criteria, status, email opt-out, deals received, last deal sent |
| **Deals** | deal | Deal ID (`SDI-2026-0001`), status, address, numbers, details, photo IDs, video, times distributed, investors reached, responses, interested, buyer, sold price/date, internal notes |
| **Distribution Jobs** | click of SEND | mode (TEST/LIVE), audience, total / sent / failed / simulated, status |
| **Distribution Log** | investor per send | investor, email, mode, status (Queued / Sent / Failed / Simulated / Skipped / Cancelled), sent at |
| **Buyer Intake Log** | buyer found by the daily intake | source, name, email, result (Added / Already in database / Updated / Skipped), details |
| **Responses** | reply or logged call | deal, investor, type, offer amount, message, source (Email auto / Manual), follow-up status, notes |
| **Settings** | setting | everything on the Settings page |

You can add your own columns to any tab, because the app finds columns by header name. Don't rename the existing headers.

## Safety and compliance details
* Test mode is **on** until you type `GO LIVE`. While it's on, every email is redirected to `TEST_EMAIL` and capped at `TEST_MODE_MAX_EMAILS` per distribution.
* Each live distribution needs you to type `SEND`. The server checks this too, not just the browser, using a one-time confirmation token that expires after 15 minutes. If you switch between test and live after reviewing, you have to review again.
* Opted-out and inactive investors are never emailed. Opt-outs are checked again right before each email goes out.
* Replies of **UNSUBSCRIBE** automatically opt the investor out.
* **Internal notes** are never emailed. The assignment price and access instructions each have their own "show in email" checkbox. Assignment price is hidden by default; don't put lockbox codes in access instructions if they're shown.
* Text entered in forms or imported is never run as a spreadsheet formula.

## Local development

You don't need any of this to *use* the system. It's for changing the code.

```bash
npm test                 # runs the backend against an in-memory Apps Script mock (63 end-to-end checks)
npm run preview          # builds preview/index.html — the real UI + real server code with sample data, nothing is emailed
```

`tools/` is never pushed to Apps Script (see `.claspignore`).

## Troubleshooting
| Problem | Fix |
|---|---|
| "No database spreadsheet is linked" | Open the Sheet → Extensions → Apps Script → run `setup`. |
| Import: "Could not open that spreadsheet" | The account running the app needs at least view access to the source Sheet. |
| Distribution says "Paused — daily email limit" | Nothing to do. It resumes automatically when the quota resets, and you can watch it under **Distributions**. |
| Investors can't open "View Full Photo Gallery" | Your Workspace admin may block link sharing. Photos are still embedded in the email, or you can set `SHARE_MEDIA_LINKS` to No. |
| Replies aren't being logged | Turn on auto-tracking in Settings. Replies must keep the deal ID (e.g. `SDI-2026-0001`) in the subject, which the email buttons do automatically. |
| Changes aren't showing in the app | Deploy a **New version** (see step 4). |
