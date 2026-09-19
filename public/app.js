/* global CheckoutWebComponents */

const publicKeyPromise = fetch("/api/config")
  .then((res) => {
    if (!res.ok) throw new Error("Could not load checkout config");
    return res.json();
  })
  .then((config) => config.publicKey);

const formatter = new Intl.NumberFormat("en-HK", {
  style: "currency",
  currency: "HKD",
});

let flowComponent = null;

function triggerToast(id) {
  const element = document.getElementById(id);
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 5000);
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

/**
 * Single place to tell the shopper payment finished.
 * Used after redirect (?status=succeeded) and after onPaymentCompleted (no redirect).
 */
async function showPaymentSuccess(paymentId) {
  const checkoutMain = document.getElementById("checkout-main");
  const successPanel = document.getElementById("success-panel");
  const idEl = document.getElementById("success-payment-id");
  const statusEl = document.getElementById("success-payment-status");

  if (paymentId) {
    idEl.textContent = paymentId;
  }

  checkoutMain.hidden = true;
  successPanel.hidden = false;
  successPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  triggerToast("successToast");

  if (!paymentId) {
    statusEl.textContent = "Completed (no id returned)";
    return;
  }

  try {
    const response = await fetch(`/api/payments/${paymentId}`);
    const payment = await response.json();
    if (response.ok) {
      statusEl.textContent = payment.status || (payment.approved ? "Approved" : "Pending");
    } else {
      statusEl.textContent = "Completed (verify in Dashboard)";
    }
  } catch {
    statusEl.textContent = "Completed (could not verify)";
  }
}

async function loadProducts() {
  const response = await fetch("/api/products");
  const data = await response.json();
  const list = document.getElementById("product-list");
  const totalEl = document.getElementById("order-total");

  list.innerHTML = data.products
    .map(
      (p) => `
    <li class="product-card">
      <img src="${p.image}" alt="${p.name}" width="80" height="80" loading="lazy" />
      <div class="product-card__info">
        <span class="product-card__name">${p.name}</span>
        <span class="product-card__meta">Qty ${p.quantity}</span>
        <span class="product-card__price">${formatter.format(p.unitPrice / 100)}</span>
      </div>
    </li>`,
    )
    .join("");

  totalEl.textContent = formatter.format(data.totalAmount / 100);
}

async function mountFlow(paymentSession) {
  const publicKey = await publicKeyPromise;
  const checkout = await CheckoutWebComponents({
    publicKey,
    environment: "sandbox",
    locale: "en-GB",
    paymentSession,
    appearance: {
      colorAction: "#8C9E6E",
      colorBackground: "#FFFFFD",
      colorFormBackground: "#FFFFFD",
      colorFormBorder: "#8C9E6E",
      colorPrimary: "#323416",
    },
    onPaymentCompleted: (_component, paymentResponse) => {
      showPaymentSuccess(paymentResponse.id);
    },
    onError: (component, error) => {
      console.error("Flow error", component?.type, error);
    },
  });

  if (flowComponent) {
    flowComponent.unmount();
  }

  flowComponent = checkout.create("flow");
  flowComponent.mount(document.getElementById("flow-container"));
}

async function createSessionFromForm(form) {
  const formError = document.getElementById("form-error");
  const sessionError = document.getElementById("session-error");
  const continueBtn = document.getElementById("continue-btn");

  showError(formError, "");
  showError(sessionError, "");

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const payload = Object.fromEntries(new FormData(form).entries());
  continueBtn.disabled = true;
  continueBtn.textContent = "Preparing payment…";

  try {
    const response = await fetch("/create-payment-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const paymentSession = await response.json();

    if (!response.ok) {
      const message =
        paymentSession.message ||
        paymentSession.error_codes?.join(", ") ||
        "Could not create payment session.";
      showError(formError, message);
      return;
    }

    document.getElementById("payment-section").hidden = false;
    document.getElementById("payment-section").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    await mountFlow(paymentSession);
  } catch (err) {
    showError(formError, "Network error. Please try again.");
    console.error(err);
  } finally {
    continueBtn.disabled = false;
    continueBtn.textContent = "Continue to payment";
  }
}

document.getElementById("customer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  createSessionFromForm(e.target);
});

loadProducts();

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("status") === "succeeded") {
  showPaymentSuccess(urlParams.get("cko-payment-id"));
}
if (urlParams.get("status") === "failed") {
  triggerToast("failedToast");
}
