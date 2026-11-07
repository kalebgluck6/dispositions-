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
  RESPONSES: 'Responses'
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
  notes: 'Notes'
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
  internalNotes: 'Internal Notes'
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
  error: 'Error'
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
SCHEMAS[SHEET.RESPONSES] = RESPONSE_MAP;

/** Columns that must be stored as plain text (zip codes, phones, IDs, dates-as-text). */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.INVESTORS] = ['Investor ID', 'Phone'];
TEXT_COLUMNS[SHEET.DEALS] = ['Deal ID', 'Zip', 'Closing Date', 'Photo IDs', 'Lot Size'];
TEXT_COLUMNS[SHEET.LOG] = ['Log ID', 'Job ID', 'Deal ID', 'Investor ID'];
TEXT_COLUMNS[SHEET.RESPONSES] = ['Response ID', 'Deal ID', 'Investor ID', 'Message ID'];

var DEAL_STATUSES = ['Available', 'Pending', 'Sold'];
var INVESTOR_STATUSES = ['Active', 'Inactive'];
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
  ['DRIVE_FOLDER_ID', '', 'Managed automatically — root Drive folder for deal photos and videos.']
];
