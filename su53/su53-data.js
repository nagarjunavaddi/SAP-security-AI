// su53-data.js
// Mock reference data for the SU53 agent skeleton.
// Later: replace these lookups with live SUIM / AGR_1251 RFC queries.

// AGR_1251-like: which roles grant which auth object + field + value.
// Shape mirrors what a real AGR_1251 read would return.
const ROLE_AUTH = [
  // role, authObject, field, value, txDescription (context)
  { role: 'Z_FI_ACCOUNTANT',   authObject: 'F_BKPF_BUK', field: 'BUKRS', value: '1000', activity: '01/02/03' },
  { role: 'Z_FI_ACCOUNTANT',   authObject: 'S_TCODE',    field: 'TCD',   value: 'FB01', activity: '' },
  { role: 'Z_FI_DISPLAY',      authObject: 'F_BKPF_BUK', field: 'BUKRS', value: '1000', activity: '03' },
  { role: 'Z_FI_MANAGER',      authObject: 'F_BKPF_BUK', field: 'BUKRS', value: '*',    activity: '01/02/03' },
  { role: 'Z_MM_BUYER',        authObject: 'M_BEST_BSA', field: 'BSART', value: 'NB',   activity: '01/02' },
  { role: 'Z_BASIS_ADMIN',     authObject: 'S_TCODE',    field: 'TCD',   value: '*',    activity: '' },
];

// User → user group (governs which roles are appropriate to suggest).
const USER_GROUP = {
  'NAG':  { userGroup: 'FI_USERS',  fullName: 'Nagarjuna V' },
  'RAVI': { userGroup: 'MM_USERS',  fullName: 'Ravi K' },
  'DEMO': { userGroup: 'FI_USERS',  fullName: 'Demo User' },
};

// Which roles are allowed for which user group (appropriateness filter).
const GROUP_ROLES = {
  'FI_USERS': ['Z_FI_ACCOUNTANT', 'Z_FI_DISPLAY', 'Z_FI_MANAGER'],
  'MM_USERS': ['Z_MM_BUYER'],
};

// Existing SoD conflict pairs (mirrors your SoD engine's ruleset, mock subset).
// If assigning a role would combine with a user's existing role to form one of
// these pairs, flag it.
const SOD_CONFLICTS = [
  { a: 'Z_FI_ACCOUNTANT', b: 'Z_MM_BUYER', risk: 'Create vendor invoice + create PO (P2P conflict)' },
  { a: 'Z_FI_MANAGER',    b: 'Z_MM_BUYER', risk: 'Approve payments + create PO' },
];

// Mock: user's currently assigned roles (later from AGR_USERS).
const USER_ROLES = {
  'NAG':  ['Z_MM_BUYER'],   // note: NAG already has MM_BUYER → SoD demo
  'RAVI': [],
  'DEMO': [],
};

module.exports = { ROLE_AUTH, USER_GROUP, GROUP_ROLES, SOD_CONFLICTS, USER_ROLES };
