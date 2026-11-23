/**
 * SameDayInvestments — Investor Deal Distribution System
 * Config.gs — sheet names, column schemas and default settings.
 *
 * Each entity is described by a FIELD MAP: { clientKey: 'Sheet Column Header' }.
 * The order of the map is the column order used when a sheet is first created.
 * Columns are always looked up by header name, so you can reorder columns
 * in the spreadsheet or add your own extra columns without breaking anything.
 */

var APP_NAME = 'SameDayInvestments';
var APP_VERSION = '1.0.0';

var SHEET = {
  SETTINGS: 'Settings',
  INVESTORS: 'Investors',
  DEALS: 'Deals',
  JOBS: 'Distribution Jobs',
  LOG: 'Distribution Log',
  RESPONSES: 'Responses',
  INTAKE: 'Buyer Intake Log',
  OFFERS: 'Offers',
  FOLLOWUPS: 'Follow-Ups'
};

var INVESTOR_MAP = {
  id: 'Investor ID',
  firstName: 'First Name',
  lastName: 'Last Name',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  tier: 'Tier',
  categories: 'Categories',
  markets: 'Preferred Markets',
  propertyTypes: 'Property Types',
  minPrice: 'Min Price',
  maxPrice: 'Max Price',
  criteria: 'Buying Criteria',
  status: 'Status',
  optOut: 'Email Opt-Out',
  source: 'Source',
  dateAdded: 'Date Added',
  updated: 'Last Updated',
  lastSent: 'Last Deal Sent',
  dealsReceived: 'Deals Received',
  notes: 'Notes',
  mailingAddress: 'Mailing Address',
  purchases: 'Recent Purchases',
  purchaseCount: 'Purchase Count',
  lastPurchase: 'Last Purchase Date',
  // ---- buy box profile ----
  zips: 'Preferred Zip Codes',
  minAcres: 'Min Acreage',
  maxAcres: 'Max Acreage',
  condition: 'Rehab Preference',
  funding: 'Funding',
  minRoi: 'Preferred ROI %',
  closeDays: 'Typical Close (days)',
  lastDealBought: 'Last Deal Bought (SDI)',
  // ---- verification ----
  pofAmount: 'POF Amount',
  pofExpires: 'POF Expires',
  pofFileUrl: 'POF File',
  pofVerifiedOn: 'POF Verified On',
  dealsClosed: 'Deals Closed With Us',
  defaults: 'Contract Defaults',
  reliability: 'Reliability Rating'
};

var DEAL_MAP = {
  id: 'Deal ID',
  status: 'Status',
  address: 'Address',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  market: 'Market',
  propertyType: 'Property Type',
  askingPrice: 'Asking Price',
  assignmentPrice: 'Assignment Price',
  showAssignment: 'Show Assignment Price',
  arv: 'ARV',
  repairs: 'Estimated Repairs',
  sqft: 'Square Feet',
  beds: 'Bedrooms',
  baths: 'Bathrooms',
  lotSize: 'Lot Size',
  yearBuilt: 'Year Built',
  description: 'Description',
  closingDate: 'Closing Date',
  access: 'Access Instructions',
  showAccess: 'Show Access Instructions',
  photoIds: 'Photo IDs',
  folderId: 'Photo Folder ID',
  videoUrl: 'Video URL',
  videoFileId: 'Video File ID',
  created: 'Created',
  updated: 'Updated',
  lastDistributed: 'Last Distributed',
  timesDistributed: 'Times Distributed',
  totalRecipients: 'Total Recipients',
  responses: 'Responses',
  interested: 'Interested',
  buyer: 'Buyer',
  soldPrice: 'Sold Price',
  soldDate: 'Sold Date',
  internalNotes: 'Internal Notes',
  // ---- pipeline & land ----
  stage: 'Pipeline Stage',
  stageUpdated: 'Stage Updated',
  rep: 'Disposition Rep',
  contractPrice: 'Contract Price (Seller)',
  offerDeadline: 'Offer Deadline',
  acres: 'Acreage',
  parcelId: 'Parcel ID',
  zoning: 'Zoning',
  buyerInvestorId: 'Buyer Investor ID',
  emdAmount: 'EMD Amount',
  emdReceived: 'EMD Received On',
  assignmentSigned: 'Assignment Signed On'
};

var JOB_MAP = {
  id: 'Job ID',
  dealId: 'Deal ID',
  property: 'Property',
  mode: 'Mode',
  audience: 'Audience',
  created: 'Created',
  createdBy: 'Created By',
  total: 'Total',
  sent: 'Sent',
  failed: 'Failed',
  simulated: 'Simulated',
  status: 'Status',
  completed: 'Completed',
  notes: 'Notes'
};

// NOTE: Status → Error must stay contiguous (the queue writes them as one block).
var LOG_MAP = {
  id: 'Log ID',
  jobId: 'Job ID',
  dealId: 'Deal ID',
  investorId: 'Investor ID',
  investorName: 'Investor Name',
  investorEmail: 'Investor Email',
  tier: 'Tier',
  mode: 'Mode',
  status: 'Status',
  queuedAt: 'Queued At',
  sentAt: 'Sent At',
  deliveredTo: 'Delivered To',
  error: 'Error',
  wave: 'Wave',
  sendAfter: 'Send After',
  matchScore: 'Match Score'
};

var RESPONSE_MAP = {
  id: 'Response ID',
  dealId: 'Deal ID',
  property: 'Property',
  investorId: 'Investor ID',
  investorName: 'Investor Name',
  investorEmail: 'Investor Email',
  received: 'Received',
  type: 'Type',
  offerAmount: 'Offer Amount',
  message: 'Message',
  source: 'Source',
  followUp: 'Follow-Up Status',
  notes: 'Notes',
  messageId: 'Message ID'
};

var SCHEMAS = {};
SCHEMAS[SHEET.INVESTORS] = INVESTOR_MAP;
SCHEMAS[SHEET.DEALS] = DEAL_MAP;
SCHEMAS[SHEET.JOBS] = JOB_MAP;
SCHEMAS[SHEET.LOG] = LOG_MAP;
var INTAKE_MAP = {
  id: 'Intake ID',
  received: 'Received',
  source: 'Source',
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  result: 'Result',
  investorId: 'Investor ID',
  details: 'Details',
  ref: 'Reference'
};

SCHEMAS[SHEET.RESPONSES] = RESPONSE_MAP;
SCHEMAS[SHEET.INTAKE] = INTAKE_MAP;

var OFFER_MAP = {
  id: 'Offer ID',
  dealId: 'Deal ID',
  property: 'Property',
  investorId: 'Investor ID',
  investorName: 'Investor Name',
  investorEmail: 'Investor Email',
  received: 'Received',
  amount: 'Offer Amount',
  assignmentFee: 'Assignment Fee',
  emd: 'EMD Amount',
  inspectionDays: 'Inspection Period (days)',
  closingDate: 'Proposed Closing Date',
  financing: 'Financing',
  pof: 'Proof of Funds',
  status: 'Contract Status',
  counter: 'Counter Amount',
  source: 'Source',
  notes: 'Notes',
  updated: 'Updated',
  responseId: 'Response ID'
};
SCHEMAS[SHEET.OFFERS] = OFFER_MAP;

var FOLLOWUP_MAP = {
  id: 'Follow-Up ID',
  key: 'Rule Key',
  type: 'Type',
  dealId: 'Deal ID',
  property: 'Property',
  investorId: 'Investor ID',
  investorName: 'Investor Name',
  to: 'Sent To',
  channel: 'Channel',
  subject: 'Subject',
  sentAt: 'Sent At',
  status: 'Status',
  mode: 'Mode'
};
SCHEMAS[SHEET.FOLLOWUPS] = FOLLOWUP_MAP;

/** Columns that must be stored as plain text (zip codes, phones, IDs, dates-as-text). */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.INVESTORS] = ['Investor ID', 'Phone', 'POF Expires', 'Preferred Zip Codes'];
TEXT_COLUMNS[SHEET.DEALS] = ['Deal ID', 'Zip', 'Closing Date', 'Photo IDs', 'Lot Size', 'Offer Deadline', 'Parcel ID', 'Pipeline Stage'];
TEXT_COLUMNS[SHEET.LOG] = ['Log ID', 'Job ID', 'Deal ID', 'Investor ID'];
TEXT_COLUMNS[SHEET.RESPONSES] = ['Response ID', 'Deal ID', 'Investor ID', 'Message ID'];
TEXT_COLUMNS[SHEET.INTAKE] = ['Intake ID', 'Investor ID', 'Reference', 'Phone'];
TEXT_COLUMNS[SHEET.OFFERS] = ['Offer ID', 'Deal ID', 'Investor ID', 'Proposed Closing Date', 'Response ID'];
TEXT_COLUMNS[SHEET.FOLLOWUPS] = ['Follow-Up ID', 'Rule Key', 'Deal ID', 'Investor ID'];

var DEAL_STATUSES = ['Available', 'Pending', 'Sold', 'Dead'];

/** Disposition pipeline. Each stage implies a deal status (Available / Pending / Sold / Dead). */
var PIPELINE = [
  { stage: 'Ready for Disposition', status: 'Available' },
  { stage: 'Distributed', status: 'Available' },
  { stage: 'Buyer Interested', status: 'Available' },
  { stage: 'Offer Received', status: 'Available' },
  { stage: 'Negotiating', status: 'Available' },
  { stage: 'Buyer Selected', status: 'Pending' },
  { stage: 'Assignment Signed', status: 'Pending' },
  { stage: 'EMD Received', status: 'Pending' },
  { stage: 'Closing Scheduled', status: 'Pending' },
  { stage: 'Closed', status: 'Sold' },
  { stage: 'Dead Deal', status: 'Dead' }
];
var PIPELINE_STAGES = PIPELINE.map(function (p) { return p.stage; });
var OFFER_STATUSES = ['Received', 'Countered', 'Accepted', 'Backup', 'Under Contract', 'Closed', 'Rejected', 'Withdrawn', 'Fell Through'];
var CONDITION_PREFS = ['Rehab', 'Turnkey', 'Either'];
var FUNDING_TYPES = ['Cash', 'Hard money', 'Private lender', 'Conventional', 'Other'];
var PENDING_REVIEW = 'Pending Review';
var INVESTOR_STATUSES = ['Active', 'Inactive', PENDING_REVIEW];
var RESPONSE_TYPES = ['Interested', 'Offer', 'Question', 'Not Interested', 'Unsubscribe', 'Reply'];
var FOLLOW_UP_STATUSES = ['New', 'Contacted', 'Showing Scheduled', 'Offer Received', 'Under Contract', 'Closed', 'Dead'];

/** Max milliseconds a single execution spends sending before handing off to a trigger. */
var QUEUE_TIME_BUDGET_MS = 4.5 * 60 * 1000;

/**
 * Default settings: [key, default value, description].
 * These are written to the Settings sheet on setup and are editable there or in the app.
 */
var DEFAULT_SETTINGS = [
  ['COMPANY_NAME', 'SameDayInvestments', 'Company name shown in emails and the app.'],
  ['CONTACT_NAME', '', 'Dispositions contact shown in emails.'],
  ['CONTACT_PHONE', '', 'Phone number shown in emails.'],
  ['CONTACT_EMAIL', '', 'Contact email shown in emails (defaults to Reply-To).'],
  ['WEBSITE', '', 'Website URL shown in emails (optional).'],
  ['COMPANY_ADDRESS', '', 'Physical mailing address — required in commercial email footers (CAN-SPAM).'],
  ['SENDER_NAME', 'SameDayInvestments Dispositions', 'The "From" display name on distribution emails.'],
  ['REPLY_TO', '', 'Where investor replies go. Defaults to the account running the script.'],
  ['FROM_ALIAS', '', 'Optional Gmail "Send mail as" alias to send from (must already be configured in Gmail).'],
  ['LOGO_URL', '', 'Optional public https URL of your logo image for the email header.'],
  ['TEST_MODE', 'TRUE', 'TRUE = every email is redirected to TEST_EMAIL. Set FALSE (Go Live) to email investors.'],
  ['TEST_EMAIL', '', 'Address that receives all emails while TEST_MODE is TRUE.'],
  ['TEST_MODE_MAX_EMAILS', '3', 'In test mode, only this many emails are actually delivered per distribution; the rest are simulated.'],
  ['SUBJECT_TEMPLATE', 'Off-Market Opportunity | {{ADDRESS}}, {{CITY}} {{STATE}} | {{PRICE}} [{{DEAL_ID}}]', 'Email subject. Tokens: {{ADDRESS}} {{CITY}} {{STATE}} {{PRICE}} {{ARV}} {{PROPERTY_TYPE}} {{DEAL_ID}}. Keep {{DEAL_ID}} so replies are auto-tracked.'],
  ['EMAIL_PHOTO_COUNT', '4', 'How many photos to embed in the email (cover photo + gallery).'],
  ['SHARE_MEDIA_LINKS', 'TRUE', 'TRUE = make the deal photo folder / uploaded video viewable by link so investors can open the full gallery.'],
  ['SHOW_ASSIGNMENT_DEFAULT', 'FALSE', 'Default for new deals: show the assignment price in investor emails.'],
  ['DISCLAIMER', 'All information is deemed reliable but not guaranteed. Buyers must perform their own due diligence. Figures for ARV and repairs are estimates only. We are assigning our contract interest in this property; this is not an offer to sell real estate.', 'Legal disclaimer shown at the bottom of every email.'],
  ['TIERS', 'Platinum, Gold, Silver, Bronze', 'Investor tiers (comma separated, highest first).'],
  ['CATEGORIES', 'Fix & Flip, Buy & Hold, Cash Buyer, BRRRR, Wholesaler, Hedge Fund / Institutional, Developer, Private Lender', 'Investor categories (comma separated).'],
  ['PROPERTY_TYPES', 'Single Family, Multi-Family (2-4), Multi-Family (5+), Condo / Townhouse, Mobile Home, Land, Commercial, Mixed Use', 'Property types (comma separated).'],
  ['MARKETS', '', 'Markets you operate in (comma separated, e.g. "Atlanta Metro, Dallas-Fort Worth"). Do not use commas inside a market name.'],
  ['RESPONSE_LOOKBACK_DAYS', '14', 'How many days back the inbox scanner looks for investor replies.'],
  ['DRIVE_FOLDER_ID', '', 'Managed automatically — root Drive folder for deal photos and videos.'],
  // ---- New buyer intake (daily) ----
  ['INTAKE_FORM_ON', 'TRUE', 'Add buyers who fill in your VIP buyer signup form.'],
  ['INTAKE_SHEET_ON', 'FALSE', 'Add new buyers from a Google Sheet you or a VA keep updated.'],
  ['INTAKE_SHEET_URL', '', 'Link to the Google Sheet of new buyers.'],
  ['INTAKE_SHEET_TAB', '', 'Tab name in that sheet (blank = first tab).'],
  ['INTAKE_CASH_ON', 'FALSE', 'Add cash buyers from a public-records export sheet (PropStream, BatchLeads, PropertyRadar, etc.).'],
  ['INTAKE_CASH_URL', '', 'Link to the Google Sheet holding your cash-buyer / recent-sales export.'],
  ['INTAKE_CASH_TAB', '', 'Tab name in that sheet (blank = first tab).'],
  ['INTAKE_CASH_LOOKBACK_DAYS', '365', 'Only count purchases made within this many days.'],
  ['INTAKE_CASH_MIN_PURCHASES', '1', 'Minimum purchases in the lookback window to be added as a buyer.'],
  ['INTAKE_GMAIL_ON', 'TRUE', 'Add people who email you asking to join your buyers list.'],
  ['INTAKE_GMAIL_DAYS', '3', 'How many days back the Gmail scan looks for buyer inquiries.'],
  ['INTAKE_GMAIL_KEYWORDS', 'buyers list, buyer list, cash buyer, buy box, buybox, add me to your list, looking for deals, send me deals, off market deals, off-market deals', 'Phrases that mark an email as a buyer inquiry (comma separated).'],
  ['INTAKE_SUMMARY_EMAIL', 'TRUE', 'Email me a summary each day new buyers are waiting for review.'],
  ['INTAKE_HOUR', '6', 'Morning hour (0–23, script time zone) the buyer intake runs.'],
  ['INTAKE_HOUR_PM', '19', 'Night hour (0–23, script time zone) the buyer intake runs.'],
  ['INTAKE_DM_ON', 'FALSE', 'Find recent cash / hard-money / land buyers through DealMachine (needs an API key).'],
  ['INTAKE_DM_COUNTIES', '51810, 51710, 51550, 51740, 51800, 51650, 51700, 51735, 51199, 51830, 51095, 51093, 51073, 51760, 51087, 51041, 51085, 37139, 37029, 37053, 37143, 37041', 'County FIPS codes DealMachine searches (Hampton Roads, Richmond, Elizabeth City areas).'],
  ['INTAKE_DM_DAYS', '14', 'Only sales recorded within this many days.'],
  ['INTAKE_DM_HARD_MONEY', 'TRUE', 'Also include investors who bought with a private / hard-money lender.'],
  ['INTAKE_DM_LAND', 'TRUE', 'Also include new-construction buyers: cash purchases of residential land / lots.'],
  ['INTAKE_DM_LAND_MIN_OWNED', '2', 'Land buyers must own at least this many properties (filters out one-time lot buyers).'],
  ['INTAKE_DM_LAND_MIN_PRICE', '5000', 'Ignore land sales below this price.'],
  ['INTAKE_DM_ABSENTEE', 'TRUE', 'Only buyers who do not live in the property (investors, not homeowners).'],
  ['INTAKE_DM_MIN_PRICE', '20000', 'Ignore house sales below this price (filters out $0 / $10 deed transfers).'],
  ['INTAKE_DM_CONTACTS', 'TRUE', 'Get the owner phone + email from DealMachine (uses people credits).'],
  ['INTAKE_DM_MAX_PER_RUN', '100', 'Most properties to pull per run (controls credit use).'],
  ['INTAKE_DM_MONTHLY_CAP', '1500', 'Stop pulling once this many DealMachine credits are used this month (0 = no cap).'],
  ['INTAKE_COUNTY_ON', 'TRUE', 'Find buyers in free City of Norfolk recorded-sales data.'],
  ['INTAKE_COUNTY_DAYS', '30', 'Only county sales recorded within this many days.'],
  ['INTAKE_COUNTY_MIN_PRICE', '20000', 'Ignore county sales below this price.'],
  ['INTAKE_COUNTY_ENTITIES_ONLY', 'TRUE', 'Only company / LLC / trust buyers (free records cannot show cash vs. financed).'],
  // ---- matching ----
  ['MATCH_MIN_SCORE', '50', 'Smart matching: minimum match score (0–100) for a buyer to count as a match.'],
  ['WAVE2_DELAY_HOURS', '24', 'Priority waves: hours after Wave 1 (top-tier matches) before other matched buyers receive the deal.'],
  ['WAVE3_DELAY_HOURS', '48', 'Priority waves: hours after Wave 1 before non-matching active buyers receive it (if included).'],
  // ---- follow-ups ----
  ['FU_ON', 'TRUE', 'Run automatic buyer follow-ups.'],
  ['FU_NORESP_HOURS', '48', 'Follow up once with matched buyers who received a deal but haven\'t responded after this many hours.'],
  ['FU_OFFER_HOURS', '24', 'Remind interested buyers to submit an offer after this many hours.'],
  ['FU_POF_HOURS', '24', 'Ask for proof of funds this many hours after an offer arrives without verified POF.'],
  ['FU_QUIET_DAYS', '3', 'Alert the rep when an interested buyer has gone quiet this many days.'],
  ['FU_CLOSING_DAYS', '3', 'Remind the selected buyer and the rep this many days before closing.'],
  ['FU_STUCK_DAYS', '7', 'Flag deals with no stage change in this many days.'],
  ['REPS', '', 'Disposition reps (comma separated "Name <email>").'],
  ['POF_VALID_DAYS', '90', 'Proof of funds is treated as expired after this many days.'],
  ['BUYER_FORM_ID', '', 'Managed automatically — your VIP buyer signup form.'],
  ['BUYER_FORM_URL', '', 'Managed automatically — public link to your VIP buyer signup form.']
];
