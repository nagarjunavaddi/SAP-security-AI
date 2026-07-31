const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// Load .env manually (dotenv may not be installed)
try {
  const envPath = path.join(__dirname, '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
} catch (e) { /* .env not found — skip */ }

const USERS_FILE = path.join(__dirname, 'data', 'ikaegis-users.json');

// Create transporter (reusable)
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.log('  [IKAegis-Mail] SMTP not configured — emails disabled');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,
    auth: { user: user, pass: pass }
  });
  console.log('  [IKAegis-Mail] SMTP configured: ' + user + ' via ' + host);
  return transporter;
}

// Lookup user email from ikaegis-users.json
function getUserEmail(username) {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const user = data.users.find(function(u) {
      return u.username.toUpperCase() === username.toUpperCase();
    });
    return user && user.email ? user.email : null;
  } catch (e) { return null; }
}

// Send email (non-blocking, never throws)
function sendMail(to, subject, htmlBody) {
  var t = getTransporter();
  if (!t || !to) {
    console.log('  [IKAegis-Mail] Skipped: no transporter or no recipient (' + to + ')');
    return Promise.resolve(false);
  }
  var from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return t.sendMail({
    from: from,
    to: to,
    subject: subject,
    html: htmlBody
  }).then(function(info) {
    console.log('  [IKAegis-Mail] Sent to ' + to + ': ' + subject);
    return true;
  }).catch(function(err) {
    console.error('  [IKAegis-Mail] Failed to ' + to + ': ' + err.message);
    return false;
  });
}

// =============================================
// EMAIL TEMPLATES
// =============================================

// 1. Request submitted — notify requester + manager
function notifyRequestSubmitted(request) {
  var requesterEmail = getUserEmail(request.requestedBy);
  var managerEmail = getUserEmail(request.approver);

  var subjectReq = 'IKAegis — Your access request ' + request.id + ' submitted';
  var bodyReq = '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;">'
    + '<div style="background:#15263F;padding:20px 24px;border-top:3px solid #FFC000;">'
    + '<span style="font-family:Sora,sans-serif;font-weight:800;font-size:20px;color:#EEF1F6;">'
    + '<span style="color:#FFC000;">IK</span>Aegis</span></div>'
    + '<div style="padding:24px;background:#F5F7FA;">'
    + '<h2 style="color:#1F497D;margin:0 0 12px;">Request Submitted</h2>'
    + '<p style="color:#5A6A85;font-size:14px;line-height:1.6;">Your access request has been submitted and is awaiting manager approval.</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;width:140px;">Request ID</td><td style="padding:8px 12px;">' + request.id + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">SAP User</td><td style="padding:8px 12px;">' + (request.sapUsername || request.requestedBy) + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Role</td><td style="padding:8px 12px;">' + request.role + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Approver</td><td style="padding:8px 12px;">' + request.approver + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Status</td><td style="padding:8px 12px;color:#C1811E;font-weight:600;">PENDING</td></tr>'
    + '</table></div>'
    + '<div style="background:#15263F;padding:12px 24px;border-top:2px solid #FFC000;">'
    + '<span style="color:#8FA3C4;font-size:11px;">IKAegis — SAP Access Governance Platform</span></div></div>';

  var subjectMgr = 'IKAegis — New request ' + request.id + ' pending your approval';
  var bodyMgr = '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;">'
    + '<div style="background:#15263F;padding:20px 24px;border-top:3px solid #FFC000;">'
    + '<span style="font-family:Sora,sans-serif;font-weight:800;font-size:20px;color:#EEF1F6;">'
    + '<span style="color:#FFC000;">IK</span>Aegis</span></div>'
    + '<div style="padding:24px;background:#F5F7FA;">'
    + '<h2 style="color:#C33438;margin:0 0 12px;">Action Required: New Access Request</h2>'
    + '<p style="color:#5A6A85;font-size:14px;line-height:1.6;">' + request.requestedByName + ' has submitted an access request that requires your approval.</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;width:140px;">Request ID</td><td style="padding:8px 12px;">' + request.id + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Requested By</td><td style="padding:8px 12px;">' + request.requestedByName + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">SAP User</td><td style="padding:8px 12px;">' + (request.sapUsername || request.requestedBy) + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Role</td><td style="padding:8px 12px;">' + request.role + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Justification</td><td style="padding:8px 12px;">' + (request.justification || '—') + '</td></tr>'
    + '</table>'
    + '<p style="margin:16px 0 0;"><a href="http://localhost:3000/approvals.html" style="display:inline-block;background:#1F497D;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Review in IKAegis</a></p>'
    + '</div>'
    + '<div style="background:#15263F;padding:12px 24px;border-top:2px solid #FFC000;">'
    + '<span style="color:#8FA3C4;font-size:11px;">IKAegis — SAP Access Governance Platform</span></div></div>';

  sendMail(requesterEmail, subjectReq, bodyReq);
  sendMail(managerEmail, subjectMgr, bodyMgr);
}

// 2. Manager approved — notify role owner
function notifyManagerApproved(request) {
  var roleOwnerEmail = getUserEmail(request.roleOwner);

  var subject = 'IKAegis — Request ' + request.id + ' pending your approval (Level 2)';
  var body = '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;">'
    + '<div style="background:#15263F;padding:20px 24px;border-top:3px solid #FFC000;">'
    + '<span style="font-family:Sora,sans-serif;font-weight:800;font-size:20px;color:#EEF1F6;">'
    + '<span style="color:#FFC000;">IK</span>Aegis</span></div>'
    + '<div style="padding:24px;background:#F5F7FA;">'
    + '<h2 style="color:#C33438;margin:0 0 12px;">Action Required: Role Owner Approval</h2>'
    + '<p style="color:#5A6A85;font-size:14px;line-height:1.6;">Manager <strong>' + (request.managerDecidedBy || request.approver) + '</strong> has approved this request. Your approval is now required as the Role Owner.</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;width:140px;">Request ID</td><td style="padding:8px 12px;">' + request.id + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Requested By</td><td style="padding:8px 12px;">' + request.requestedByName + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">SAP User</td><td style="padding:8px 12px;">' + (request.sapUsername || request.requestedBy) + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Role</td><td style="padding:8px 12px;">' + request.role + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Manager Comments</td><td style="padding:8px 12px;">' + (request.managerComments || '—') + '</td></tr>'
    + '</table>'
    + '<p style="margin:16px 0 0;"><a href="http://localhost:3000/approvals.html" style="display:inline-block;background:#1F497D;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Review in IKAegis</a></p>'
    + '</div>'
    + '<div style="background:#15263F;padding:12px 24px;border-top:2px solid #FFC000;">'
    + '<span style="color:#8FA3C4;font-size:11px;">IKAegis — SAP Access Governance Platform</span></div></div>';

  sendMail(roleOwnerEmail, subject, body);
}

// 3. Final decision — notify requester
function notifyFinalDecision(request) {
  var requesterEmail = getUserEmail(request.requestedBy);
  var isApproved = request.status === 'approved';

  var subject = 'IKAegis — Request ' + request.id + ' ' + (isApproved ? 'APPROVED' : 'REJECTED');
  var statusColor = isApproved ? '#00B050' : '#C33438';
  var statusText = isApproved ? 'APPROVED' : 'REJECTED';
  var message = isApproved
    ? 'Your access request has been fully approved. The role will be assigned in SAP shortly.'
    : 'Your access request has been rejected.';

  var body = '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;">'
    + '<div style="background:#15263F;padding:20px 24px;border-top:3px solid #FFC000;">'
    + '<span style="font-family:Sora,sans-serif;font-weight:800;font-size:20px;color:#EEF1F6;">'
    + '<span style="color:#FFC000;">IK</span>Aegis</span></div>'
    + '<div style="padding:24px;background:#F5F7FA;">'
    + '<h2 style="color:' + statusColor + ';margin:0 0 12px;">Request ' + statusText + '</h2>'
    + '<p style="color:#5A6A85;font-size:14px;line-height:1.6;">' + message + '</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;width:140px;">Request ID</td><td style="padding:8px 12px;">' + request.id + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Role</td><td style="padding:8px 12px;">' + request.role + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Status</td><td style="padding:8px 12px;color:' + statusColor + ';font-weight:700;">' + statusText + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Decided By</td><td style="padding:8px 12px;">' + (request.decidedBy || '—') + '</td></tr>'
    + '<tr><td style="padding:8px 12px;background:#EDF2F8;font-weight:600;">Comments</td><td style="padding:8px 12px;">' + (request.comments || '—') + '</td></tr>'
    + '</table></div>'
    + '<div style="background:#15263F;padding:12px 24px;border-top:2px solid #FFC000;">'
    + '<span style="color:#8FA3C4;font-size:11px;">IKAegis — SAP Access Governance Platform</span></div></div>';

  sendMail(requesterEmail, subject, body);
}

// 4. Rejection at any stage — notify requester
function notifyRejection(request) {
  notifyFinalDecision(request);
}

module.exports = {
  notifyRequestSubmitted: notifyRequestSubmitted,
  notifyManagerApproved: notifyManagerApproved,
  notifyFinalDecision: notifyFinalDecision,
  notifyRejection: notifyRejection,
  sendMail: sendMail,
  getUserEmail: getUserEmail
};

console.log('  [IKAegis-Mail] Email service loaded');
