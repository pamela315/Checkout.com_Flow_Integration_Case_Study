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

const PRODUCTS = [
  {
    id: "product_1",
    name: "Good morning",
    unitPrice: 15900,
    quantity: 1,
    currency: "HKD",
    image: "/product_1.jpeg",
  },
  {
    id: "product_2",
    name: "Goodbye",
    unitPrice: 15900,
    quantity: 1,
    currency: "HKD",
    image: "/product_2.jpg",
  },
];

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/api/config", (_req, res) => {
  res.json({ publicKey: PUBLIC_KEY });
});

app.get("/api/products", (_req, res) => {
  res.json({
    products: PRODUCTS,
    totalAmount: PRODUCTS.reduce(
      (sum, p) => sum + p.unitPrice * p.quantity,
      0,
    ),
    currency: "HKD",
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
    country = "HK",
  } = req.body || {};

  if (!name?.trim() || !email?.trim() || !addressLine1?.trim() || !city?.trim()) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Name, email, address, and city are required.",
    });
  }

  const totalAmount = PRODUCTS.reduce(
    (sum, p) => sum + p.unitPrice * p.quantity,
    0,
  );

  const phoneDigits = (phone || "").replace(/\D/g, "");
  const countryCode = country === "NL" ? "+31" : "+852";

  const sessionBody = {
    amount: totalAmount,
    currency: "HKD",
    processing_channel_id: PROCESSING_CHANNEL_ID,
    reference: `ORD-${Date.now()}`,
    description: "iPhone cases — Good morning & Goodbye",
    display_name: "Case Co.",
    enabled_payment_methods: ["card", "applepay","googlepay"],
    billing_descriptor: {
      name: "Case Co.",
      city: city.trim(),
    },
    customer: {
      email: email.trim(),
      name: name.trim(),
    },
    shipping: {
      address: {
        address_line1: addressLine1.trim(),
        address_line2: addressLine2?.trim() || undefined,
        city: city.trim(),
        country,
      },
      phone: phoneDigits
        ? { number: phoneDigits, country_code: countryCode }
        : undefined,
    },
    billing: {
      address: {
        address_line1: addressLine1.trim(),
        address_line2: addressLine2?.trim() || undefined,
        city: city.trim(),
        country,
      },
      phone: phoneDigits
        ? { number: phoneDigits, country_code: countryCode }
        : undefined,
    },
    success_url: `${baseUrl}/?status=succeeded`,
    failure_url: `${baseUrl}/?status=failed`,
    items: PRODUCTS.map((p) => ({
      name: p.name,
      quantity: p.quantity,
      unit_price: p.unitPrice,
      image_url: `${baseUrl}${p.image}`,
    })),
    metadata: {
      products: PRODUCTS.map((p) => p.id).join(","),
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

  res.json({
    id: payment.id,
    status: payment.status,
    approved: payment.approved,
    amount: payment.amount,
    currency: payment.currency,
    reference: payment.reference,
  });
});

app.listen(PORT, () => {
  console.log(`Checkout server: http://localhost:${PORT}/`);
});
