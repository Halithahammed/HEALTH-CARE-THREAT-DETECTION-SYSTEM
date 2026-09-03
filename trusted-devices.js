// trusted-devices.js
// Admin page for managing trusted devices: trust, untrust, block, unblock.

(function () {
  const token = sessionStorage.getItem("htd_token");
  if (!token) {
    window.location.href = "/admin-login.html";
    return;
  }

  const els = {
    devicesTableBody: document.getElementById("devicesTableBody"),
    logoutButton: document.getElementById("logoutButton"),
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function authHeaders() {
    return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  }

  function addDeviceRow(device) {
    const placeholder = els.devicesTableBody.querySelector('td[colspan]');
    if (placeholder) placeholder.parentElement.remove();
    const row = document.createElement("tr");
    row.dataset.deviceId = device.device_id;
    const trustedBadge = device.is_blocked
      ? '<span class="risk-badge medium">Blocked</span>'
      : '<span class="risk-badge low">Trusted</span>';
    const blockedBadge = device.is_blocked
      ? '<span class="risk-badge high">Yes</span>'
      : '<span class="risk-badge low">No</span>';

    let actions = "";
    if (device.is_blocked) {
      actions += `<button class="btn btn-outline btn-sm" data-action="unblock" data-device-id="${escapeHtml(device.device_id)}">Unblock</button> `;
    } else {
      actions += `<button class="btn btn-outline btn-sm" data-action="untrust" data-device-id="${escapeHtml(device.device_id)}">Untrust</button> `;
      actions += `<button class="btn btn-outline btn-sm" data-action="block" data-device-id="${escapeHtml(device.device_id)}">Block</button>`;
    }

    row.innerHTML = `
      <td>${escapeHtml(device.full_name || device.username || "—")}</td>
      <td>${escapeHtml(device.device_name || "—")}</td>
      <td>${escapeHtml(device.browser || "—")}</td>
      <td>${escapeHtml(device.operating_system || "—")}</td>
      <td>${escapeHtml(device.first_seen || "—")}</td>
      <td>${escapeHtml(device.last_seen || "—")}</td>
      <td>${trustedBadge}</td>
      <td>${blockedBadge}</td>
      <td class="device-actions">${actions}</td>`;
    els.devicesTableBody.prepend(row);

    row.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", handleDeviceAction);
    });
  }

  async function handleDeviceAction(e) {
    const action = e.target.dataset.action;
    const deviceId = e.target.dataset.deviceId;
    const url = `/api/admin/devices/${encodeURIComponent(deviceId)}/${action}`;

    e.target.disabled = true;
    try {
      const res = await fetch(url, { method: "POST", headers: authHeaders() });
      if (!res.ok) {
        alert("Action failed");
        e.target.disabled = false;
        return;
      }
      loadDevices();
    } catch {
      alert("Unable to reach the server");
      e.target.disabled = false;
    }
  }

  async function loadDevices() {
    try {
      const res = await fetch("/api/admin/trusted-devices", { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      els.devicesTableBody.innerHTML = "";
      (data.devices || []).forEach(addDeviceRow);
    } catch { /* ignore */ }
  }

  function logout() {
    sessionStorage.removeItem("htd_token");
    sessionStorage.removeItem("htd_user");
    window.location.href = "/admin-login.html";
  }

  // Verify admin session first.
  (async () => {
    try {
      const res = await fetch("/api/auth/me", { headers: authHeaders() });
      if (!res.ok) return (window.location.href = "/admin-login.html");
      const data = await res.json();
      if (!data.success || data.user.role !== "admin") return (window.location.href = "/admin-login.html");
      loadDevices();
    } catch {
      window.location.href = "/admin-login.html";
    }
  })();

  els.logoutButton.addEventListener("click", logout);
})();
