# Checkout case study

A mobile-first demo checkout for **Case Co.**, built with [Checkout.com Flow](https://www.checkout.com/docs/payments/accept-payments/accept-a-payment-on-your-website/get-started-with-flow) (Web Components). Shoppers review two iPhone cases, enter contact and delivery details, then pay with card, Apple Pay, or Google Pay in the sandbox.

## What this demonstrates

- **Payment Sessions** created server-side with billing, shipping, line items, and redirect URLs
- **Flow** embedded on the same page after the customer form is submitted
- **Success handling** via redirect query params and the `onPaymentCompleted` callback (no redirect required for completion UI)
- **Secrets kept out of git** — API keys live in `.env`; the browser loads only the public key from `/api/config`

## Tech stack

- Node.js + Express (`server.js`)
- Static frontend in `public/` (`index.html`, `app.js`, `style.css`)
- Checkout Web Components SDK (loaded from Checkout.com CDN)

## Prerequisites

- Node.js 18+ (or any recent LTS with `fetch` available globally; this project uses `node-fetch` v2 for broad compatibility)
- A [Checkout.com sandbox](https://www.checkout.com/) account with:
  - Secret key (`sk_sbox_…`)
  - Public key (`pk_sbox_…`)
  - Processing channel ID (`pc_…`)

## Setup

```bash
cd checkout_page
npm install
cp .env.example .env
```

Edit `.env` and set your sandbox values:

| Variable | Used for |
|----------|----------|
| `CHECKOUT_SECRET_KEY` | Server calls to Payment Sessions and Payments API |
| `CHECKOUT_PUBLIC_KEY` | Initializing Flow in the browser |
| `CHECKOUT_PROCESSING_CHANNEL_ID` | Payment session `processing_channel_id` |

Start the server:

```bash
npm start
```

Open [http://localhost:3001](http://localhost:3001) (or the port set in `PORT`).

## Project layout

```
checkout_page/
├── server.js           # API + Payment Session creation
├── public/
│   ├── index.html      # Checkout page structure
│   ├── app.js          # Products, form, Flow mount, success UI
│   ├── style.css       # Mobile-first layout and theme
│   └── product_*.jpeg/jpg
├── .env.example        # Template for local secrets (commit this)
└── .env                # Your keys (never commit — see .gitignore)
```

## API routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/products` | Product list and order total |
| `GET` | `/api/config` | Public key for Flow |
| `POST` | `/create-payment-sessions` | Creates a sandbox payment session from the customer form |
| `GET` | `/api/payments/:id` | Payment status plus `response_code` / `response_summary` (from payment actions when needed) |

## Testing payments

Use [Checkout.com sandbox test cards](https://www.checkout.com/docs/developer-resources/testing/test-cards). Use any future expiry and any 3-digit CVV (4-digit for American Express). Never use real card numbers in sandbox.

Successful payments show an on-page confirmation with payment ID and status. Declines return to `?status=failed` and the fail toast shows **Payment Failure, please try again**, then `Error code {response_code} — {response_summary}` when those fields are available.

Sessions are created with 3DS enabled (`challenge_requested` for HK, `challenge_requested_mandate` for NL). A decline card can still go through 3DS first. NL’s mandate can force a challenge even on a frictionless test PAN.

Apple Pay generally will not complete on `localhost` (HTTPS, domain verification, and Dashboard enablement are required).

### Happy path

| Card | Number | Expected |
|------|--------|----------|
| Visa credit | `4242424242424242` | `10000` Approved |

### Issuer declines

| Code | Meaning | Number |
|------|---------|--------|
| `20012` | Invalid transaction | `4024007103573027` |
| `200R3` | Issuer stop payment (revocation) for all authorizations | `4567361325981788` |
| `200N7` | Decline for CVV2 failure | `4734868958733862` |
| `2005C` | Transaction not supported / blocked by issuer | `4276038578596818` |
| `20020` | Default-card decline (`20020`) | `4916301720257093` |

### 3DS2 frictionless

| Result | Visa number |
|--------|-------------|
| Authentication successful | `4485040371536584` |
| Not authenticated | `4539628347117863` |
| Authentication rejected | `4275765574319271` |

### 3DS2 challenge

If the 3DS simulator appears, enter password **`Checkout1!`**.

| Result | Number |
|--------|--------|
| Authentication successful | Mastercard `5385308360135181` |
| Not authenticated | Visa `4243754271700719` |
| Authentication rejected | Amex `375982239796002` |

## Security notes

- Do **not** commit `.env` or put the secret key in frontend code.
- If keys were ever committed to a public repository, rotate them in the Checkout.com dashboard.
- Product images in sessions use absolute URLs based on the request host, so local testing works on `localhost`; production deploys need a stable public URL for `image_url` fields.

## License

ISC
