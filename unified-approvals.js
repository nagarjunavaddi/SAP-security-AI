/*!
 * unified-approvals.js
 * ---------------------------------------------------------------------------
 * IK Kontrol - Unified Approval Queue (Level 1 queue + Level 2 drill-down)
 *
 * 100% ADDITIVE. This file NEVER touches the legacy IIFE inside approvals.html.
 * It only:
 *   - renders itself into <div id="ikUnifiedRoot"></div>
 *   - moves the existing legacy nodes (.section-header / .filter-bar / .panel)
 *     into a wrapper it creates at runtime, so the classic view can be shown
 *     or hidden by tab. The legacy DOM is preserved exactly - no innerHTML
 *     rewrite, no listener removal - so loadRequests/renderTable/_doAction
 *     keep working untouched.
 *
 * Level 1 : merged queue of
 *              /api/approval-requests       (Role requests)
 *              /api/user-create-requests    (User creation requests)
 *           Columns: Request #, Type, Status, Requested By, Submitted Date
 * Level 2 : click a row -> breadcrumb drill-down, fields rendered per type.
 *
 * Role approve/reject reuses the proven legacy path: window._doAction().
 * User-create approve/reject uses POST /api/user-create-requests/:id/action.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var ROOT_ID = 'ikUnifiedRoot';
  var ITEMS = [];          // normalised level-1 rows
  var VIEW = 'queue';      // 'queue' | 'detail'
  var CURRENT = null;      // selected normalised item
  var TYPE_FILTER = 'all'; // 'all' | 'role' | 'user_create'
  var MY_USERNAME = '';
  var MY_ROLE = '';
  var legacyWrap = null;
  var booted = false;

  /* ---------------------------------------------------------------- utils */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '\u2014';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() +
      ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function statusLabel(s) {
    if (s === 'sap_failed') return 'SAP failed';
    return String(s || '').replace(/_/g, ' ');
  }

  /* --------------------------------------------------------------- styles */

  function injectStyles() {
    if (document.getElementById('ikUnifiedStyles')) return;
    var css = document.createElement('style');
    css.id = 'ikUnifiedStyles';
    css.textContent = [
      '.ikq-tabs{display:flex;gap:4px;border-bottom:1px solid var(--ice-3);margin-bottom:24px;}',
      '.ikq-tab{font-family:var(--font-display);font-weight:600;font-size:13px;padding:10px 18px;border:none;background:none;color:var(--slate);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;}',
      '.ikq-tab:hover{color:var(--navy-corp);}',
      '.ikq-tab.active{color:var(--navy-corp);border-bottom-color:var(--gold);}',
      '.ikq-tab:focus-visible{outline:2px solid var(--navy-corp);outline-offset:2px;}',
      /* matches .crumb in uar-inbox.html */
      '.ikq-crumbs{font-family:var(--font-mono);font-size:12px;color:var(--slate);margin-bottom:16px;}',
      '.ikq-crumb{background:none;border:none;padding:0;font:inherit;color:var(--navy-corp);text-decoration:none;cursor:pointer;}',
      '.ikq-crumb:hover{text-decoration:underline;}',
      '.ikq-crumb:focus-visible{outline:2px solid var(--navy-corp);outline-offset:2px;}',
      'tr.ikq-row{cursor:pointer;}',
      'tr.ikq-row:focus-visible{outline:2px solid var(--navy-corp);outline-offset:-2px;}',
      '.ikq-type{font-family:var(--font-mono);font-size:10px;letter-spacing:.5px;padding:4px 10px;border-radius:20px;font-weight:600;display:inline-block;}',
      '.ikq-type.role{background:rgba(31,73,125,.1);color:var(--navy-corp);}',
      '.ikq-type.user_create{background:rgba(193,129,30,.12);color:var(--amber);}',
      '.ikq-type.user_lock{background:rgba(37,99,168,.12);color:var(--blue,#2563A8);}',
      '.status-badge.sap_failed{background:rgba(195,52,56,.12);color:var(--crimson);}',
      '.status-badge.manager_approved{background:rgba(31,73,125,.1);color:var(--navy-corp);}',
      '.ikq-detail{padding:26px 28px;}',
      '.ikq-detail h3{font-family:var(--font-display);font-weight:700;font-size:18px;color:var(--navy);margin-bottom:4px;}',
      '.ikq-detail-sub{font-family:var(--font-mono);font-size:11px;color:var(--slate-light);margin-bottom:22px;}',
      '.ikq-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 32px;}',
      '.ikq-field{min-width:0;}',
      '.ikq-field .k{font-family:var(--font-mono);font-size:10px;letter-spacing:.8px;color:var(--slate-light);margin-bottom:5px;}',
      '.ikq-field .v{font-family:var(--font-body);font-size:14px;color:var(--ink);font-weight:500;word-break:break-word;}',
      '.ikq-field.wide{grid-column:1 / -1;}',
      '.ikq-actions{margin-top:26px;padding-top:20px;border-top:1px solid var(--ice-3);display:flex;gap:10px;align-items:center;}',
      '.ikq-note{font-family:var(--font-mono);font-size:11px;color:var(--slate-light);}',
      '@media (max-width:640px){.ikq-grid{grid-template-columns:1fr;}}'
    ].join('\n');
    document.head.appendChild(css);
  }

  /* ------------------------------------------------- legacy view handling */

  function wrapLegacy() {
    if (legacyWrap) return;
    var main = document.querySelector('.main');
    var root = document.getElementById(ROOT_ID);
    if (!main || !root) return;

    var header = main.querySelector('.section-header');
    var filters = main.querySelector('.filter-bar');
    var panel = main.querySelector('.panel');
    if (!header || !filters || !panel) return;

    legacyWrap = document.createElement('div');
    legacyWrap.id = 'ikLegacyWrap';
    legacyWrap.style.display = 'none';
    main.insertBefore(legacyWrap, header);
    legacyWrap.appendChild(header);
    legacyWrap.appendChild(filters);
    legacyWrap.appendChild(panel);
  }

  function showLegacy(on) {
    if (legacyWrap) legacyWrap.style.display = on ? '' : 'none';
    var host = document.getElementById('ikqHost');
    if (host) host.style.display = on ? 'none' : '';
    var tabs = document.querySelectorAll('.ikq-tab');
    tabs.forEach(function (t) {
      var isLegacy = t.dataset.tab === 'classic';
      t.classList.toggle('active', on ? isLegacy : !isLegacy);
    });
  }

  /* --------------------------------------------------------- data loading */

  function normaliseRole(r) {
    return {
      key: 'role:' + r.id,
      id: r.id,
      type: 'role',
      typeLabel: 'Role',
      status: r.status,
      requestedBy: r.requestedByName || r.requestedBy || '\u2014',
      submittedAt: r.requestedAt,
      raw: r
    };
  }

  function normaliseUcr(r) {
    return {
      key: 'ucr:' + r.id,
      id: r.id,
      type: 'user_create',
      typeLabel: 'User Creation',
      status: r.status,
      requestedBy: r.requestedBy || '\u2014',
      submittedAt: r.createdAt,
      raw: r
    };
  }

  function normaliseUlr(r) {
    return {
      key: 'ulr:' + r.id,
      id: r.id,
      type: 'user_lock',
      typeLabel: 'User Lock',
      status: r.status,
      requestedBy: r.requestedBy || '\u2014',
      submittedAt: r.createdAt,
      raw: r
    };
  }

  function getJson(url) {
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error(url + ' returned ' + res.status);
        return res.json();
      })
      .catch(function (err) {
        console.warn('[unified-approvals] ' + err.message);
        return null;
      });
  }

  function loadAll() {
    return Promise.all([
      getJson('/api/approval-requests'),
      getJson('/api/user-create-requests'),
      getJson('/api/user-lock-requests')
    ]).then(function (out) {
      var roleRows = (out[0] && out[0].requests) || [];
      var ucrRows = (out[1] && out[1].requests) || [];
      var ulrRows = (out[2] && out[2].requests) || [];
      ITEMS = roleRows.map(normaliseRole).concat(ucrRows.map(normaliseUcr)).concat(ulrRows.map(normaliseUlr));
      ITEMS.sort(function (a, b) {
        var ap = a.status === 'pending' || a.status === 'manager_approved';
        var bp = b.status === 'pending' || b.status === 'manager_approved';
        if (ap !== bp) return ap ? -1 : 1;
        return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
      });
      if (CURRENT) {
        var again = ITEMS.filter(function (i) { return i.key === CURRENT.key; })[0];
        CURRENT = again || null;
        if (!CURRENT) VIEW = 'queue';
      }
      render();
    });
  }

  /* ------------------------------------------------------------ can act? */

  function canAct(item) {
    if (MY_ROLE === 'admin') return item.status === 'pending' || item.status === 'manager_approved';
    if (item.type === 'user_create' || item.type === 'user_lock') {
      return item.status === 'pending' &&
        String(item.raw.approver || '').toUpperCase() === MY_USERNAME;
    }
    if (item.status === 'pending') {
      return String(item.raw.approver || '').toUpperCase() === MY_USERNAME;
    }
    if (item.status === 'manager_approved') {
      return String(item.raw.roleOwner || '').toUpperCase() === MY_USERNAME;
    }
    return false;
  }

  /* -------------------------------------------------------------- render */

  function render() {
    var host = document.getElementById('ikqHost');
    if (!host) return;
    host.innerHTML = VIEW === 'detail' && CURRENT ? detailHtml(CURRENT) : queueHtml();
    bindHost();
  }

  function queueHtml() {
    var rows = TYPE_FILTER === 'all'
      ? ITEMS
      : ITEMS.filter(function (i) { return i.type === TYPE_FILTER; });

    var counts = {
      all: ITEMS.length,
      role: ITEMS.filter(function (i) { return i.type === 'role'; }).length,
      user_create: ITEMS.filter(function (i) { return i.type === 'user_create'; }).length,
      user_lock: ITEMS.filter(function (i) { return i.type === 'user_lock'; }).length
    };

    function chip(key, label) {
      return '<button class="filter-btn ikq-chip' + (TYPE_FILTER === key ? ' active' : '') +
        '" data-type="' + key + '">' + label +
        '<span class="filter-count">' + counts[key] + '</span></button>';
    }

    var body = rows.length === 0
      ? ''
      : rows.map(function (i) {
        return '<tr class="ikq-row" tabindex="0" data-key="' + esc(i.key) + '">' +
          '<td class="req-id">' + esc(i.id) + '</td>' +
          '<td><span class="ikq-type ' + i.type + '">' + esc(i.typeLabel) + '</span></td>' +
          '<td><span class="status-badge ' + esc(i.status) + '">' + esc(statusLabel(i.status)) + '</span></td>' +
          '<td class="req-user">' + esc(i.requestedBy) + '</td>' +
          '<td class="req-date">' + fmtDate(i.submittedAt) + '</td>' +
          '</tr>';
      }).join('');

    return '' +
      '<div class="section-header"><h2>All requests</h2><div class="section-line"></div></div>' +
      '<div class="filter-bar">' + chip('all', 'All') + chip('role', 'Role') + chip('user_create', 'User creation') + chip('user_lock', 'User lock') + '</div>' +
      '<div class="panel"><div class="table-scroll"><table class="data">' +
      '<thead><tr><th>Request #</th><th>Type</th><th>Status</th><th>Requested By</th><th>Submitted Date</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' +
      (rows.length ? '' :
        '<div class="empty-state"><h3>Nothing waiting on you</h3><p>No requests match this filter yet.</p></div>') +
      '</div>';
  }

  function field(k, v, wide) {
    return '<div class="ikq-field' + (wide ? ' wide' : '') + '"><div class="k">' + esc(k) +
      '</div><div class="v">' + esc(v == null || v === '' ? '\u2014' : v) + '</div></div>';
  }

  function detailHtml(i) {
    var r = i.raw;
    var fields;

    if (i.type === 'user_lock') {
      fields =
        field('SAP username', r.username) +
        field('Action', r.actionType) +
        field('Approver', r.approver) +
        field('Requested by', r.requestedBy) +
        field('Valid from', r.validFrom ? fmtDate(r.validFrom) : '\u2014') +
        field('Valid to', r.validTo ? fmtDate(r.validTo) : '\u2014') +
        field('Submitted', fmtDate(r.createdAt)) +
        field('Last updated', fmtDate(r.updatedAt)) +
        field('Status', statusLabel(r.status)) +
        (r.justification ? field('Justification', r.justification, true) : '') +
        (r.comments ? field('Comments', r.comments, true) : '') +
        (r.sapResult ? field('SAP result', r.sapResult, true) : '');
    } else if (i.type === 'user_create') {
      fields =
        field('SAP username', r.username) +
        field('Last name', r.lastName) +
        field('Password', 'Provided at submission, stored for provisioning') +
        field('Approver', r.approver) +
        field('Requested by', r.requestedBy) +
        field('Submitted', fmtDate(r.createdAt)) +
        field('Last updated', fmtDate(r.updatedAt)) +
        field('Status', statusLabel(r.status)) +
        (r.comments ? field('Comments', r.comments, true) : '') +
        (r.sapResult ? field('SAP result', r.sapResult, true) : '');
    } else {
      fields =
        field('Role', r.role) +
        field('SAP user', r.sapUsername || r.userId) +
        field('Role owner', r.roleOwner) +
        field('Manager / approver', r.approver) +
        field('Requested by', r.requestedByName || r.requestedBy) +
        field('Submitted', fmtDate(r.requestedAt)) +
        field('Status', statusLabel(r.status)) +
        field('Stage', r.status === 'pending' ? 'Manager approval'
          : r.status === 'manager_approved' ? 'Role owner approval' : 'Closed') +
        (r.justification ? field('Justification', r.justification, true) : '') +
        (r.sodConflicts ? field('SoD conflicts', Array.isArray(r.sodConflicts) ? r.sodConflicts.join(', ') : r.sodConflicts, true) : '') +
        (r.managerDecidedBy ? field('Manager decision', r.managerDecidedBy + (r.managerComments ? ' \u2014 ' + r.managerComments : ''), true) : '') +
        (r.decidedBy ? field('Final decision', r.decidedBy + (r.comments ? ' \u2014 ' + r.comments : ''), true) : '');
    }

    var actions;
    if (canAct(i)) {
      actions = '<div class="ikq-actions">' +
        '<button class="btn-approve" id="ikqApprove">Approve</button>' +
        '<button class="btn-reject" id="ikqReject">Reject</button></div>';
    } else if (i.status === 'pending' || i.status === 'manager_approved') {
      var waiting = (i.type === 'user_create' || i.type === 'user_lock') ? r.approver
        : (i.status === 'pending' ? r.approver : r.roleOwner);
      actions = '<div class="ikq-actions"><span class="ikq-note">Waiting on ' +
        esc(waiting || 'the assigned approver') + '</span></div>';
    } else {
      actions = '<div class="ikq-actions"><span class="ikq-note">This request is closed.</span></div>';
    }

    return '' +
      '<div class="ikq-crumbs">' +
      '<button class="ikq-crumb" id="ikqBack">All Requests</button>' +
      '&nbsp;/&nbsp; ' + esc(i.id) + '</div>' +
      '<div class="panel"><div class="ikq-detail">' +
      '<h3>' + esc(i.typeLabel) + ' request</h3>' +
      '<div class="ikq-detail-sub">' + esc(i.id) + ' \u00b7 raised by ' + esc(i.requestedBy) + '</div>' +
      '<div class="ikq-grid">' + fields + '</div>' +
      actions +
      '</div></div>';
  }

  /* -------------------------------------------------------------- events */

  function openItem(key) {
    var found = ITEMS.filter(function (i) { return i.key === key; })[0];
    if (!found) return;
    CURRENT = found;
    VIEW = 'detail';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToQueue() {
    CURRENT = null;
    VIEW = 'queue';
    render();
  }

  function bindHost() {
    var host = document.getElementById('ikqHost');
    if (!host) return;

    host.querySelectorAll('.ikq-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        TYPE_FILTER = b.dataset.type;
        render();
      });
    });

    host.querySelectorAll('.ikq-row').forEach(function (tr) {
      tr.addEventListener('click', function () { openItem(tr.dataset.key); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(tr.dataset.key); }
      });
    });

    var back = document.getElementById('ikqBack');
    if (back) back.addEventListener('click', backToQueue);

    var ap = document.getElementById('ikqApprove');
    var rj = document.getElementById('ikqReject');
    if (ap) ap.addEventListener('click', function () { act('approve'); });
    if (rj) rj.addEventListener('click', function () { act('reject'); });
  }

  /* -------------------------------------------------- user-create modal */
  /* Own modal, reusing the page's .modal-overlay / .modal styles so it looks
     identical to the role-approval modal. Kept separate from #actionModal
     because that one's confirm handler is hard-wired to the role endpoint. */

  var modalPending = null;

  function ensureModal() {
    if (document.getElementById('ikqModal')) return;
    var d = document.createElement('div');
    d.className = 'modal-overlay';
    d.id = 'ikqModal';
    d.innerHTML =
      '<div class="modal">' +
      '<div class="modal-header">' +
      '<h3 id="ikqModalTitle">Approve Request</h3>' +
      '<p id="ikqModalSub">UCR-XXXX</p>' +
      '</div>' +
      '<div class="modal-body">' +
      '<label for="ikqModalComments">Comments (optional)</label>' +
      '<textarea id="ikqModalComments" placeholder="Add a note for the requester..."></textarea>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="modal-cancel" id="ikqModalCancel">Cancel</button>' +
      '<button class="modal-confirm approve-action" id="ikqModalConfirm">Approve</button>' +
      '</div></div>';
    document.body.appendChild(d);

    document.getElementById('ikqModalCancel').addEventListener('click', closeModal);
    d.addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d.classList.contains('show')) closeModal();
    });
    document.getElementById('ikqModalConfirm').addEventListener('click', submitModal);
  }

  function closeModal() {
    var d = document.getElementById('ikqModal');
    if (d) d.classList.remove('show');
    modalPending = null;
  }

  function openModal(item, action) {
    ensureModal();
    modalPending = { item: item, action: action };

    document.getElementById('ikqModalTitle').textContent =
      action === 'approve' ? 'Approve Request' : 'Reject Request';
    document.getElementById('ikqModalSub').textContent =
      item.id + ' \u2014 ' + (item.raw.username || '');
    document.getElementById('ikqModalComments').value = '';

    var btn = document.getElementById('ikqModalConfirm');
    btn.textContent = action === 'approve' ? 'Approve' : 'Reject';
    btn.className = 'modal-confirm ' + (action === 'approve' ? 'approve-action' : 'reject-action');
    btn.disabled = false;

    document.getElementById('ikqModal').classList.add('show');
    setTimeout(function () { document.getElementById('ikqModalComments').focus(); }, 60);
  }

  function submitModal() {
    if (!modalPending) return;
    var item = modalPending.item;
    var action = modalPending.action;
    var comments = document.getElementById('ikqModalComments').value.trim();
    var btn = document.getElementById('ikqModalConfirm');

    btn.disabled = true;
    btn.textContent = 'Processing...';

    var endpoint = item.type === 'user_lock' ? '/api/user-lock-requests/' : '/api/user-create-requests/';
    fetch(endpoint + encodeURIComponent(item.id) + '/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, comments: comments })
    })
      .then(function (res) {
        return res.json().then(function (d) {
          if (!res.ok) throw new Error(d.error || 'Action failed');
          return d;
        });
      })
      .then(function (d) {
        closeModal();
        toast(d.message || (action === 'approve' ? 'Approved' : 'Rejected'),
          d.success === false ? 'error' : 'success');
        return loadAll();
      })
      .catch(function (err) {
        toast(err.message || 'Action failed', 'error');
        btn.disabled = false;
        btn.textContent = action === 'approve' ? 'Approve' : 'Reject';
      });
  }

  function act(action) {
    if (!CURRENT) return;

    // Role requests: hand straight back to the legacy modal + handler.
    if (CURRENT.type === 'role') {
      if (typeof window._doAction === 'function') {
        window._doAction(CURRENT.id, action, CURRENT.raw.role);
      } else {
        toast('Role approval is unavailable on this page.', 'error');
      }
      return;
    }

    openModal(CURRENT, action);
  }

  function toast(msg, type) {
    var t = document.getElementById('toast');
    if (!t) { console.log(msg); return; }
    t.textContent = msg;
    t.className = 'toast ' + (type || 'success') + ' show';
    setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  /* Legacy modal closes -> refresh our merged data too. */
  function watchLegacyModal() {
    var modal = document.getElementById('actionModal');
    if (!modal || typeof MutationObserver !== 'function') return;
    var wasOpen = modal.classList.contains('show');
    new MutationObserver(function () {
      var open = modal.classList.contains('show');
      if (wasOpen && !open) setTimeout(loadAll, 400);
      wasOpen = open;
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------------------------------------------------------------- boot */

  function boot(detail) {
    if (booted) return;
    var root = document.getElementById(ROOT_ID);
    if (!root) { console.warn('[unified-approvals] #' + ROOT_ID + ' not found - patch not applied?'); return; }
    booted = true;

    MY_USERNAME = String((detail && detail.username) || '').toUpperCase();
    MY_ROLE = (window.currentUser && window.currentUser.ikRole) ? window.currentUser.ikRole : '';

    injectStyles();
    wrapLegacy();

    root.innerHTML =
      '<div class="ikq-tabs">' +
      '<button class="ikq-tab active" data-tab="unified">Unified queue</button>' +
      '<button class="ikq-tab" data-tab="classic">Role requests (classic)</button>' +
      '</div><div id="ikqHost"></div>';

    root.querySelectorAll('.ikq-tab').forEach(function (t) {
      t.addEventListener('click', function () { showLegacy(t.dataset.tab === 'classic'); });
    });

    showLegacy(false);
    watchLegacyModal();
    loadAll();
  }

  document.addEventListener('auth-ready', function (e) { boot(e.detail || {}); });

  /* auth-ready may have fired before this script parsed. */
  setTimeout(function () {
    if (!booted && window.currentUser) boot(window.currentUser);
  }, 1200);

  window.ikUnifiedReload = loadAll;
})();
