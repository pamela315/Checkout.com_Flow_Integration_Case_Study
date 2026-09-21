require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

const SECRET_KEY = process.env.CHECKOUT_SECRET_KEY;
const PUBLIC_KEY = process.env.CHECKOUT_PUBLIC_KEY;
const PROCESSING_CHANNEL_ID = process.env.CHECKOUT_PROCESSING_CHANNEL_ID;

if (!SECRET_KEY || !PUBLIC_KEY || !PROCESSING_CHANNEL_ID) {
  console.error(
    "Missing CHECKOUT_SECRET_KEY, CHECKOUT_PUBLIC_KEY, or CHECKOUT_PROCESSING_CHANNEL_ID in .env (see .env.example).",
  );
  process.exit(1);
}

const MARKETS = {
  HK: {
    country: "HK",
    currency: "HKD",
    locale: "en-GB",
    phoneCountryCode: "+852",
    paymentMethods: ["card", "applepay", "googlepay"],
  },
  NL: {
    country: "NL",
    currency: "EUR",
    locale: "nl-NL",
    phoneCountryCode: "+31",
    paymentMethods: ["card", "applepay", "googlepay"],
  },
};

const CATALOG = [
  {
    id: "product_1",
    name: "Good morning",
    quantity: 1,
    image: "/product_1.jpeg",
    prices: { HK: 15900, NL: 1800 },
  },
  {
    id: "product_2",
    name: "Goodbye",
    quantity: 1,
    image: "/product_2.jpg",
    prices: { HK: 15900, NL: 1800 },
  },
];

function resolveMarket(country) {
  return country === "NL" ? MARKETS.NL : MARKETS.HK;
}

function productsForMarket(country) {
  const market = resolveMarket(country);
  const priceKey = market.country;
  return CATALOG.map((item) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    image: item.image,
    unitPrice: item.prices[priceKey],
    currency: market.currency,
  }));
}

function orderTotal(products) {
  return products.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0);
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/api/config", (_req, res) => {
  res.json({ publicKey: PUBLIC_KEY });
});

app.get("/api/products", (req, res) => {
  const market = resolveMarket(req.query.country);
  const products = productsForMarket(market.country);
  res.json({
    country: market.country,
    currency: market.currency,
    locale: market.locale,
    products,
    totalAmount: orderTotal(products),
  });
});

app.post("/create-payment-sessions", async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const {
    name,
    email,
    phone,
    addressLine1,
    addressLine2,
    city,
    postcode,
    country = "HK",
  } = req.body || {};

  if (country !== "HK" && country !== "NL") {
    return res.status(400).json({
      error: "invalid_request",
      message: "Country must be HK or NL.",
    });
  }

  if (
    !name?.trim() ||
    !email?.trim() ||
    !addressLine1?.trim() ||
    !city?.trim() ||
    !postcode?.trim()
  ) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Name, email, address, city, and postcode are required.",
    });
  }

  const market = resolveMarket(country);
  const products = productsForMarket(country);
  const totalAmount = orderTotal(products);

  const phoneDigits = (phone || "").replace(/\D/g, "");
  const address = {
    address_line1: addressLine1.trim(),
    address_line2: addressLine2?.trim() || undefined,
    city: city.trim(),
    zip: postcode.trim(),
    country: market.country,
  };

  const sessionBody = {
    amount: totalAmount,
    currency: market.currency,
    locale: market.locale,
    processing_channel_id: PROCESSING_CHANNEL_ID,
    reference: `ORD-${Date.now()}`,
    description: "iPhone cases — Good morning & Goodbye",
    display_name: "Case Co.",
    enabled_payment_methods: market.paymentMethods,
    billing_descriptor: {
      name: "Case Co.",
      city: city.trim(),
    },
    customer: {
      email: email.trim(),
      name: name.trim(),
    },
    shipping: {
      address,
      phone: phoneDigits
        ? {
            number: phoneDigits,
            country_code: market.phoneCountryCode,
          }
        : undefined,
    },
    billing: {
      address,
      phone: phoneDigits
        ? {
            number: phoneDigits,
            country_code: market.phoneCountryCode,
          }
        : undefined,
    },
    success_url: `${baseUrl}/?status=succeeded`,
    failure_url: `${baseUrl}/?status=failed`,
    items: products.map((p) => ({
      name: p.name,
      quantity: p.quantity,
      unit_price: p.unitPrice,
      image_url: `${baseUrl}${p.image}`,
    })),
    metadata: {
      products: products.map((p) => p.id).join(","),
      market: market.country,
    },
    "3ds": {
      enabled: true,
      challenge_indicator:
        market.country === "NL"
          ? "challenge_requested_mandate"
          : "challenge_requested",
    },
  };

  const request = await fetch(
    "https://api.sandbox.checkout.com/payment-sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionBody),
    },
  );

  const parsedPayload = await request.json();
  res.status(request.status).send(parsedPayload);
});

app.get("/api/payments/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || !/^pay_[\w]+$/.test(id)) {
    return res.status(400).json({ message: "Invalid payment id" });
  }

  const request = await fetch(
    `https://api.sandbox.checkout.com/payments/${id}`,
    {
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
      },
    },
  );

  const payment = await request.json();
  if (!request.ok) {
    return res.status(request.status).send(payment);
  }

  let responseCode = payment.response_code;
  let responseSummary = payment.response_summary;

  if (!responseCode && !responseSummary) {
    const actionsRequest = await fetch(
      `https://api.sandbox.checkout.com/payments/${id}/actions`,
      {
        headers: {
          Authorization: `Bearer ${SECRET_KEY}`,
        },
      },
    );
    const actions = await actionsRequest.json();
    if (actionsRequest.ok && Array.isArray(actions)) {
      const action =
        actions.find((item) => item.response_code || item.response_summary) ||
        actions[0];
      responseCode = action?.response_code;
      responseSummary = action?.response_summary;
    }
  }

  res.json({
    id: payment.id,
    status: payment.status,
    approved: payment.approved,
    amount: payment.amount,
    currency: payment.currency,
    reference: payment.reference,
    response_code: responseCode,
    response_summary: responseSummary,
  });
});

app.listen(PORT, () => {
  console.log(`Checkout server: http://localhost:${PORT}/`);
});
