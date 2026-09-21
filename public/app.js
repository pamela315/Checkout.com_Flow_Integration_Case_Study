/* global CheckoutWebComponents */

const publicKeyPromise = fetch("/api/config")
  .then((res) => {
    if (!res.ok) throw new Error("Could not load checkout config");
    return res.json();
  })
  .then((config) => config.publicKey);

const FIELD_PLACEHOLDERS = {
  HK: { phone: "+852 9123 4567", postcode: "00000" },
  NL: { phone: "+31 6 12345678", postcode: "1012 AB" },
};

let flowComponent = null;
let currentMarket = { country: "HK", locale: "en-GB", currency: "HKD" };
let priceFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "HKD",
});

const FAILED_TOAST_PREFIX = "Payment Failure, please try again";

function triggerToast(id) {
  const element = document.getElementById(id);
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 5000);
}

document.getElementById("failed-toast-close").addEventListener("click", () => {
  document.getElementById("failedToast").classList.remove("show");
});

function showFailedToast(message) {
  document.getElementById("failed-toast-message").textContent = message;
  document.getElementById("failedToast").classList.add("show");
}

function failedPaymentDetails({ response_code: code, response_summary: summary }) {
  return [code && `Error code ${code}`, summary].filter(Boolean).join(" — ");
}

async function showFailedPaymentToast(paymentId) {
  showFailedToast(FAILED_TOAST_PREFIX);
  if (!paymentId) return;

  try {
    const response = await fetch(`/api/payments/${paymentId}`);
    const payment = await response.json();
    const details = response.ok ? failedPaymentDetails(payment) : "";
    if (details) {
      showFailedToast(`${FAILED_TOAST_PREFIX}: ${details}`);
    }
  } catch (err) {
    console.error(err);
  }
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

function applyMarket(market) {
  currentMarket = {
    country: market.country,
    locale: market.locale,
    currency: market.currency,
  };
  document.documentElement.lang = market.locale;
  priceFormatter = new Intl.NumberFormat(market.locale, {
    style: "currency",
    currency: market.currency,
  });
}

function resetPaymentSection() {
  document.getElementById("payment-section").hidden = true;
  showError(document.getElementById("session-error"), "");
  if (flowComponent) {
    flowComponent.unmount();
    flowComponent = null;
  }
  document.getElementById("flow-container").replaceChildren();
}

function updatePlaceholders(country) {
  const placeholders = FIELD_PLACEHOLDERS[country] || FIELD_PLACEHOLDERS.HK;
  document.querySelector('input[name="phone"]').placeholder = placeholders.phone;
  document.querySelector('input[name="postcode"]').placeholder = placeholders.postcode;
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

async function loadProducts(country) {
  const response = await fetch(
    `/api/products?country=${encodeURIComponent(country)}`,
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Could not load products");
  }

  applyMarket(data);
  updatePlaceholders(data.country);

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
        <span class="product-card__price">${priceFormatter.format(p.unitPrice / 100)}</span>
      </div>
    </li>`,
    )
    .join("");

  totalEl.textContent = priceFormatter.format(data.totalAmount / 100);
}

async function mountFlow(paymentSession) {
  const publicKey = await publicKeyPromise;
  const checkout = await CheckoutWebComponents({
    publicKey,
    environment: "sandbox",
    locale: currentMarket.locale,
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

function initialCountry() {
  const urlCountry = new URLSearchParams(window.location.search).get("country");
  if (urlCountry === "HK" || urlCountry === "NL") {
    return urlCountry;
  }
  const select = document.querySelector('select[name="country"]');
  return select?.value === "NL" ? "NL" : "HK";
}

const customerForm = document.getElementById("customer-form");
const countrySelect = customerForm.querySelector('select[name="country"]');

countrySelect.addEventListener("change", async () => {
  const country = countrySelect.value;
  resetPaymentSection();
  try {
    await loadProducts(country);
  } catch (err) {
    console.error(err);
  }
});

customerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  createSessionFromForm(e.target);
});

const startCountry = initialCountry();
countrySelect.value = startCountry;
loadProducts(startCountry).catch(console.error);

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("status") === "succeeded") {
  showPaymentSuccess(urlParams.get("cko-payment-id"));
}
if (urlParams.get("status") === "failed") {
  showFailedPaymentToast(urlParams.get("cko-payment-id"));
}
