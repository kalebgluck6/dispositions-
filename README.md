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
npm test                 # runs the backend against an in-memory Apps Script mock (29 end-to-end checks)
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
