import "dotenv/config";
import express from "express";
import Stripe from "stripe";

const app = express();
const port = Number(process.env.API_PORT ?? 8787);

const stripeKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeKey ? new Stripe(stripeKey) : null;

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "api-lite" });
});

app.post("/api/saves/checkpoint", express.json(), (req, res) => {
  // Optional v1 mirror endpoint; keep lightweight and deterministic.
  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ ok: false, error: "invalid_payload" });
  }
  return res.json({ ok: true, receivedAt: Date.now() });
});

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe || !webhookSecret) {
    return res.status(200).json({ ok: true, note: "stripe disabled" });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || Array.isArray(sig)) {
    return res.status(400).json({ ok: false, error: "missing_signature" });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    // Keep v1 side effects minimal; event logging only.
    console.log("stripe_event", event.type, event.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, error: "invalid_signature" });
  }
});

app.listen(port, () => {
  console.log(`api-lite listening on ${port}`);
});

