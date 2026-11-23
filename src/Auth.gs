/**
 * Auth.gs — team permission controls.
 *
 * Roles
 *   Owner  — everything, including Settings, going live, the DealMachine key, schedules, deleting buyers
 *   Rep    — day-to-day work: deals, buyers, distributions, offers, verification, follow-ups
 *   Viewer — read-only (dashboards, reports, pipeline)
 *
 * Single-user mode (TEAM_MEMBERS blank): the account that deployed the app is the Owner.
 * Team mode: list members in Settings → Team ("email: Role"). The deploying account is always Owner.
 * People must be identifiable: deploy the web app with "Who has access: Anyone within <your
 * Google Workspace domain>" (Google only reveals a visitor's email to apps in the same Workspace).
 * Background jobs (triggers) are not affected by roles.
 */

var ROLE_RANK = { Viewer: 1, Rep: 2, Owner: 3 };

function teamMembers_() {
  var out = {};
  String(getSettings_().TEAM_MEMBERS || '').split(/[\n;]+/).forEach(function (line) {
    var m = line.match(/([^\s:,<>]+@[^\s:,<>]+)\s*[:,\-]?\s*(owner|rep|viewer)?/i);
    if (!m) return;
    var role = m[2] ? m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase() : 'Rep';
    out[m[1].toLowerCase()] = role;
  });
  return out;
}

function ownerEmail_() {
  try { return lc_(Session.getEffectiveUser().getEmail()); } catch (e) { return ''; }
}

/** The signed-in person's role, or '' if they aren't allowed in. */
function role_() {
  var team = teamMembers_();
  var me = '';
  try { me = lc_(Session.getActiveUser().getEmail()); } catch (e) { me = ''; }
  if (!Object.keys(team).length) return 'Owner'; // single-user mode
  if (me && me === ownerEmail_()) return 'Owner';
  if (!me) return '';
  return team[me] || '';
}

function requireRole_(min) {
  var r = role_();
  if (!r) throw new Error('Your Google account isn\'t on the SameDayInvestments team. Ask the owner to add you in Settings → Team.');
  if (ROLE_RANK[r] < ROLE_RANK[min]) throw new Error('Your role (' + r + ') can\'t do this — it needs ' + min + ' access.');
  return r;
}

/** Who am I? (shown in the sidebar) */
function whoAmI() {
  var me = '';
  try { me = lc_(Session.getActiveUser().getEmail()); } catch (e) { me = ''; }
  return { email: me || currentUser_(), role: role_(), teamMode: Object.keys(teamMembers_()).length > 0 };
}
