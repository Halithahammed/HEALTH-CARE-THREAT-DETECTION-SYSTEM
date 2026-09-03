// admin-login.js
// Handles the admin login form: posts credentials, stores the JWT, redirects.

(function () {
  const form = document.getElementById("adminLoginForm");
  const errorBox = document.getElementById("errorMessage");
  const loginButton = document.getElementById("loginButton");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username || !password) {
      showError("Please enter both username and password.");
      return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, expectedRole: "admin" }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        showError(data.message || "Login failed.");
        return;
      }

      sessionStorage.setItem("htd_token", data.token);
      sessionStorage.setItem("htd_user", JSON.stringify(data.user));
      window.location.href = "/admin-dashboard.html";
    } catch (err) {
      showError("Unable to reach the server. Please try again.");
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Sign In as Administrator";
    }
  });
})();
