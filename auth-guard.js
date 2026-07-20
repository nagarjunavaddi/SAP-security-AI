/**
 * auth-guard.js
 * Include this on any page that requires login.
 * Optionally set `window.REQUIRED_ROLE = 'requester' | 'approver'` before
 * this script runs to also enforce role-specific access.
 */
(function () {
  fetch('/api/session')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.loggedIn) {
        window.location.href = 'login.html';
        return;
      }
      window.currentUser = data;

      if (window.REQUIRED_ROLE && data.role !== window.REQUIRED_ROLE) {
        // Logged in, but wrong role for this page — send them to their own home.
        window.location.href = (data.role === 'approver') ? 'approvals.html' : 'new-request.html';
        return;
      }

      document.dispatchEvent(new CustomEvent('auth-ready', { detail: data }));
    })
    .catch(function () {
      window.location.href = 'login.html';
    });

  window.logout = function () {
    fetch('/api/logout', { method: 'POST' }).then(function () {
      window.location.href = 'login.html';
    });
  };
})();
