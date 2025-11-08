# Stripe Subscription & Invoice Flow Guide

## Local Development Flow

### Prerequisites

1. **Environment Variables** (`.env.local`):
   ```bash
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_SERVICE_FEE_PRICE_ID=price_1SR00wLMrSAlFZaKDiuA7fld
   STRIPE_WEBHOOK_SECRET=whsec_...  # From Stripe CLI (see step 2)
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

2. **Stripe CLI installed and logged in**:
   ```bash
   brew install stripe/stripe-cli/stripe
   stripe login
   ```

### Step-by-Step Local Testing Flow

#### Step 1: Start Development Server
```bash
pnpm dev
```
Server runs on `http://localhost:3000`

#### Step 2: Forward Webhooks to Local Server
In a **separate terminal**, start Stripe CLI webhook forwarding:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

**Important**: Copy the `whsec_...` signing secret that appears and add it to `.env.local`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

Keep this terminal running - it will forward all Stripe webhooks to your local server.

#### Step 3: Test the Flow

**Scenario A: User WITHOUT Active Subscription (First Purchase)**

1. **User creates subscription intent** (via chat):
   - User: "Subscribe me to dish soap every 2 weeks"
   - Model creates subscription intent

2. **User confirms purchase**:
   - User: "Yes, proceed with checkout"
   - Model calls `startCheckout` tool

3. **Checkout completes successfully**:
   - Agent completes checkout on merchant site
   - System checks: User has NO active subscription
   - **Result**: Checkout Session URL is created and returned
   - Model sends message: "Checkout completed! Please complete your subscription setup: [Checkout URL]"

4. **User clicks Checkout URL**:
   - Redirected to Stripe Checkout page
   - Enters payment method (use test card: `4242 4242 4242 4242`)
   - Completes subscription setup

5. **Webhook fires** (`checkout.session.completed`):
   - Stripe CLI forwards webhook to local server
   - Handler saves subscription to `charmv2_stripe_fee` table
   - Status: `active`

6. **Webhook fires** (`customer.subscription.created`):
   - Handler checks for pending subscription intents
   - Finds the intent from step 1 (has successful checkout)
   - Appends invoice item with prorated cost
   - Invoice item added to next monthly invoice

7. **Verify in Stripe Dashboard**:
   - Go to: https://dashboard.stripe.com/test/customers
   - Find your test customer
   - Check subscription is active
   - Check invoice items: https://dashboard.stripe.com/test/invoiceitems
   - Check upcoming invoice: https://dashboard.stripe.com/test/invoices/upcoming

**Scenario B: User WITH Active Subscription (Subsequent Purchase)**

1. **User creates subscription intent** (via chat):
   - User: "Subscribe me to paper towels every month"
   - Model creates subscription intent

2. **User confirms purchase**:
   - User: "Yes, proceed"
   - Model calls `startCheckout` tool

3. **Checkout completes successfully**:
   - Agent completes checkout
   - System checks: User HAS active subscription
   - **Result**: Invoice item immediately appended
   - Model sends message: "Checkout completed! ~1.00x per month (every 30 days) has been added to your monthly invoice."

4. **Verify immediately**:
   - Check Stripe Dashboard → Invoice Items
   - Should see new invoice item with prorated amount
   - Will appear on next monthly invoice

### Testing Webhooks Manually

You can trigger test webhooks to verify handlers:

```bash
# Test successful payment
stripe trigger invoice.payment_succeeded

# Test subscription created
stripe trigger customer.subscription.created

# Test checkout session completed
stripe trigger checkout.session.completed
```

Watch your terminal running `stripe listen` to see events being forwarded, and check your dev server logs for handler execution.

### Database Verification

Check records were created correctly:

```sql
-- Check Stripe customer
SELECT * FROM charmv2_stripe_customer WHERE "userId" = 'YOUR_USER_ID';

-- Check service subscription
SELECT * FROM charmv2_stripe_fee WHERE "userId" = 'YOUR_USER_ID';

-- Check subscription intents
SELECT * FROM charmv2_subscription_intent WHERE "userId" = 'YOUR_USER_ID';

-- Check agent runs (checkout history)
SELECT * FROM charmv2_agent_run WHERE "intentId" = 'YOUR_INTENT_ID';

-- Check invoice items (via Stripe Dashboard is easier)
```

---

## Production Setup

### Required Changes

#### 1. Environment Variables (Vercel)

Add/update these in Vercel Dashboard → Settings → Environment Variables:

```bash
STRIPE_SECRET_KEY=sk_live_...  # Production key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...  # Production key
STRIPE_SERVICE_FEE_PRICE_ID=price_1SR00wLMrSAlFZaKDiuA7fld  # Same price ID (or create new for prod)
STRIPE_WEBHOOK_SECRET=whsec_...  # From Stripe Dashboard (see step 2)
NEXT_PUBLIC_APP_URL=https://your-domain.com  # Your production domain
```

**Important**: 
- Use **live** Stripe keys (not test keys)
- Create the `$1/month` price in **production** Stripe Dashboard if you haven't already
- Get the production price ID and update `STRIPE_SERVICE_FEE_PRICE_ID`

#### 2. Stripe Webhook Configuration

1. **Deploy your app** to Vercel first

2. **Add webhook endpoint in Stripe Dashboard**:
   - Go to: https://dashboard.stripe.com/webhooks
   - Click "Add endpoint"
   - **Endpoint URL**: `https://your-domain.com/api/webhooks/stripe`
   - **Description**: "Charm v2 Production Webhooks"

3. **Select events to listen for**:
   - ✅ `checkout.session.completed`
   - ✅ `customer.subscription.created`
   - ✅ `customer.subscription.updated`
   - ✅ `customer.subscription.deleted`
   - ✅ `invoice.payment_succeeded`
   - ✅ `invoice.payment_failed`
   - ✅ `invoice.created`
   - ✅ `payment_intent.succeeded`
   - ✅ `payment_intent.payment_failed`

4. **Copy signing secret**:
   - Click "Reveal" next to "Signing secret"
   - Copy the `whsec_...` value
   - Add to Vercel env vars as `STRIPE_WEBHOOK_SECRET`
   - **Redeploy** your app after adding the secret

#### 3. Verify Production Flow

1. **Test with real payment method** (or use test mode first):
   - Create subscription intent via production app
   - Complete checkout
   - Verify Checkout Session is created correctly
   - Complete subscription setup

2. **Monitor webhooks**:
   - Go to: https://dashboard.stripe.com/webhooks → Your endpoint → Logs
   - Verify webhooks are being received
   - Check for any errors

3. **Verify database records**:
   - Check `charmv2_stripe_fee` table has active subscription
   - Check invoice items are being created
   - Check upcoming invoices in Stripe Dashboard

### Production Checklist

- [ ] Deploy app to Vercel
- [ ] Set all environment variables in Vercel
- [ ] Create production price in Stripe Dashboard (if needed)
- [ ] Add webhook endpoint in Stripe Dashboard
- [ ] Configure webhook events
- [ ] Copy webhook signing secret to Vercel
- [ ] Redeploy app after adding webhook secret
- [ ] Test end-to-end flow with test payment
- [ ] Monitor webhook logs for errors
- [ ] Verify invoice items are being created correctly

### Differences: Local vs Production

| Aspect | Local Dev | Production |
|--------|-----------|------------|
| **Webhook Delivery** | Stripe CLI forwards to localhost | Stripe sends directly to your domain |
| **Stripe Keys** | Test keys (`sk_test_...`) | Live keys (`sk_live_...`) |
| **Webhook Secret** | From `stripe listen` | From Stripe Dashboard |
| **App URL** | `http://localhost:3000` | `https://your-domain.com` |
| **Price ID** | Test price ID | Production price ID (can be same) |
| **Testing** | Use test cards | Use real payment methods (or test mode) |

### Troubleshooting

**Webhooks not received in production:**
- Verify endpoint URL is correct and publicly accessible
- Check webhook secret matches between Stripe Dashboard and Vercel
- Verify webhook events are selected in Stripe Dashboard
- Check Vercel deployment logs for errors
- Verify `STRIPE_WEBHOOK_SECRET` is set correctly

**Invoice items not being created:**
- Check webhook logs in Stripe Dashboard
- Verify `customer.subscription.created` webhook is firing
- Check application logs for errors
- Verify subscription intent has `maxPriceCents` set
- Check that agent run phase is "done" (checkout completed)

**Checkout Session not created:**
- Verify `STRIPE_SERVICE_FEE_PRICE_ID` is correct
- Check Stripe customer is being created
- Verify `NEXT_PUBLIC_APP_URL` is set correctly
- Check application logs for errors

---

## Flow Diagram

```
User Confirms Purchase
        ↓
startCheckout Tool Executes
        ↓
Agent Completes Checkout
        ↓
Checkout Success?
        ↓
    ┌───┴───┐
    │       │
   NO      YES
    │       │
    │   Has Active Subscription?
    │       │
    │   ┌───┴───┐
    │   │       │
    │  NO      YES
    │   │       │
    │   │   Append Invoice Item
    │   │   (Immediately)
    │   │       │
    │   │   Return Success
    │   │   with Invoice Details
    │   │
    │   Create Checkout Session
    │       │
    │   Return Checkout URL
    │   (Model sends to user)
    │       │
    │   User Completes Checkout
    │       │
    │   Webhook: checkout.session.completed
    │   → Save subscription to DB
    │       │
    │   Webhook: customer.subscription.created
    │   → Find pending intents
    │   → Append invoice items
```

---

## Next Steps

1. **Test locally** with Stripe CLI forwarding
2. **Deploy to production** and configure webhooks
3. **Monitor** webhook logs and application logs
4. **Verify** invoice items are being created correctly
5. **Test** with real payment methods (start with small amounts)

