# Charm Architecture Documentation

## Table of Contents
1. [Data Model: SubscriptionIntent vs Subscription](#data-model)
2. [Agent System Architecture](#agent-system)
3. [API Routes](#api-routes)
4. [Common Issues & Solutions](#common-issues)

---

## Data Model: SubscriptionIntent vs Subscription

### Why Two Different Entities?

The codebase uses a **two-stage subscription system** to separate user intent from actual active subscriptions:

### 1. **SubscriptionIntent** (`intentId`)

**Purpose**: Represents the user's *desired* subscription before checkout

**Created when**: User says "subscribe me to dish soap every month"

**Schema** (`subscription_intent` table):
```typescript
{
  id: uuid;                    // intentId
  userId: uuid;
  title: string;               // "Monthly dish soap"
  productUrl: string;          // URL of product to subscribe to
  cadenceDays: number;         // 30 = monthly, 7 = weekly
  maxPriceCents?: number;      // Optional price cap
  constraints?: jsonb;         // { color: "blue", size: "large" }
  status: "active" | "paused" | "error";
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

**Use cases**:
- Storing user's subscription preferences
- Tracking what users *want* to subscribe to
- Managing subscription settings before first purchase
- Pausing/resuming subscription intents

---

### 2. **Subscription** (`subscriptionId`)

**Purpose**: Represents an *actual active* subscription after successful checkout

**Created when**: Agent successfully completes checkout and places first order

**Schema** (`subscription` table):
```typescript
{
  id: uuid;                           // subscriptionId
  userId: uuid;
  productId: uuid;                    // Link to actual Product record
  intentId?: uuid;                    // Back-reference to SubscriptionIntent
  stripeSubscriptionId?: string;      // For native subscriptions
  renewalFrequencyDays: number;       // Actual renewal frequency
  lastPriceCents?: number;            // Last purchase price
  status: "active" | "paused" | "canceled";
  addressId?: uuid;                   // Delivery address
  nextRenewalAt?: timestamp;          // When to auto-purchase next
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

**Use cases**:
- Tracking active subscriptions with actual purchases
- Scheduling future renewals
- Linking to order history
- Managing payment and delivery details

---

### The Flow

```
1. User Request
   "Subscribe me to dish soap every month"
   ↓
2. SubscriptionIntent Created
   { title: "Monthly dish soap", cadenceDays: 30, ... }
   ↓
3. Agent Checkout Process
   - Product discovery (if needed)
   - Address collection
   - Payment method setup
   - Automated purchase via Browserbase
   ↓
4. Subscription Created
   { intentId: <ref>, productId: <ref>, nextRenewalAt: ... }
   ↓
5. Orders Created
   Each renewal creates a new Order record
```

---

## Agent System Architecture

### Agent Run Lifecycle

```typescript
// Agent Run Status Flow
"plan" → "checkout" → "done"
                   ↓
                "failed"
```

### Agent Run Record

Tracks the execution of an agent job:

```typescript
{
  id: uuid;                       // runId
  intentId?: uuid;                // Link to SubscriptionIntent
  subscriptionId?: uuid;          // Link to Subscription (for renewals)
  phase: "plan" | "checkout" | "done" | "failed";
  input: jsonb;                   // Job input parameters
  output: jsonb;                  // Job result
  error?: string;                 // Error message if failed
  browserbaseSessionId?: string;  // Browserbase session for debugging
  createdAt: timestamp;
  endedAt?: timestamp;            // Set when done/failed
}
```

### Agent Types

1. **Plan Agent** (`planWithProductDiscovery`)
   - Extracts subscription intent from natural language
   - Searches for products if no URL provided
   - Creates SubscriptionIntent record

2. **Product Intelligence Agent** (`analyzeProductSubscriptionCapability`)
   - Analyzes product page for subscription options
   - Detects native Subscribe & Save availability
   - Extracts pricing and delivery options

3. **Checkout Agent** (`executeCheckout`)
   - Automated purchase flow via Browserbase
   - Fills shipping address
   - Selects payment method
   - Stops before final confirmation (requires manual approval)

---

## API Routes

### REST API Routes

#### `/api/agents/run` (POST)
Start a background agent job

**Request**:
```typescript
{
  type: "plan" | "product_intelligence" | "checkout";
  // ... job-specific parameters
}
```

**Response**:
```typescript
{
  runId: string;
  status: "running";
  message: string;
}
```

#### `/api/agents/status` (GET)
Poll agent job status

**Query params**: `?runId=<uuid>`

**Response**:
```typescript
{
  runId: string;
  status: "running" | "done" | "failed";
  phase: string;
  result?: any;           // When done
  error?: string;         // When failed
  createdAt: timestamp;
  endedAt?: timestamp;    // When done/failed
  durationMs?: number;
  browserbaseSessionId?: string;
}
```

#### `/api/chat` (POST)
Streaming chat with Claude + tools

**Tools available**:
- `searchProduct` - Find products without URL
- `getProductInfo` - Get product details
- `createSubscriptionIntent` - Create subscription intent
- `getMySubscriptions` - List user's subscriptions
- `updateSubscriptionIntent` - Modify subscription
- `pauseSubscription` - Pause deliveries
- `resumeSubscription` - Resume deliveries
- `cancelSubscription` - Cancel permanently
- `createAddress` - Add delivery address
- `getMyAddresses` - List addresses
- `analyzeProduct` - Analyze product capability
- `startCheckout` - Begin checkout process

---

## Common Issues & Solutions

### Issue #1: Spinning Circle Won't Stop

**Symptom**: Blue agent status box keeps spinning even after task completes

**Root Cause**: Two agent runs were being created - one by route handler, one by executeCheckout internally

**Solution**: 
- Pass `agentRunId` to `executeCheckout` to reuse existing run
- Only create new run if `agentRunId` not provided (backward compatibility)

**Files affected**:
- `/api/agents/run/route.ts` - Now passes agentRunId to executeCheckout
- `/server/agents/checkout.ts` - Accepts optional agentRunId parameter

---

### Issue #2: Wrong Table References

**Symptom**: Database queries fail or return wrong data

**Root Cause**: Mixing `subscription` and `subscriptionIntent` table references

**Example of bug**:
```typescript
// ❌ WRONG
const subscription = await db.query.subscription.findFirst({
  where: eq(subscriptionIntent.id, job.subscriptionId)
});

// ✅ CORRECT
const subscription = await db.query.subscription.findFirst({
  where: eq(subscription.id, job.subscriptionId)
});
```

**Solution**: Always import the correct schema table and use it in queries

---

### Issue #3: Parameter Name Confusion

**Symptom**: TypeScript errors or undefined values

**Root Cause**: Inconsistent naming of `subscriptionId` vs `subscriptionIntentId`

**Guidelines**:
- Use `intentId` or `subscriptionIntentId` for SubscriptionIntent references
- Use `subscriptionId` for Subscription references
- Be explicit in function signatures
- Add comments clarifying which entity is referenced

---

## File Organization

### Core Files

**Database**:
- `src/server/db/schema.ts` - All table definitions
- `src/server/db/queries.ts` - Database query functions (1051 lines)

**Agents**:
- `src/server/agents/plan.ts` - Plan agent implementation
- `src/server/agents/product-intelligence.ts` - Product analysis
- `src/server/agents/checkout.ts` - Checkout automation
- `src/server/agents/index.ts` - Agent exports

**API Routes**:
- `src/app/api/agents/run/route.ts` - Start agent jobs
- `src/app/api/agents/status/route.ts` - Poll agent status
- `src/app/api/chat/route.ts` - Streaming chat with tools

**tRPC Routers**:
- `src/server/api/routers/subscription.ts` - Subscription management
- `src/server/api/routers/agent.ts` - Agent operations
- `src/server/api/routers/product.ts` - Product operations
- `src/server/api/routers/address.ts` - Address management
- `src/server/api/routers/health.ts` - Health checks

**Client Hooks**:
- `src/hooks/use-agent-job.ts` - Poll agent job status
- `src/lib/agent-client.ts` - Agent API client functions

**UI Components**:
- `src/components/agent-job-status.tsx` - Agent status display
- `src/components/message.tsx` - Chat message rendering
- `src/app/dashboard/page.tsx` - Dashboard with subscriptions

---

## Best Practices

### When to Use SubscriptionIntent vs Subscription

Use **SubscriptionIntent** when:
- User is expressing desire to subscribe
- Collecting subscription preferences
- Before first purchase
- Managing subscription settings

Use **Subscription** when:
- After successful checkout
- Scheduling renewals
- Tracking order history
- Managing active subscriptions with purchases

### Agent Development

1. **Always update agent run status**:
   ```typescript
   await db.update(agentRun).set({
     phase: "done",
     output: result,
     endedAt: new Date()
   });
   ```

2. **Handle errors properly**:
   ```typescript
   try {
     // agent work
   } catch (error) {
     await db.update(agentRun).set({
       phase: "failed",
       error: error.message,
       endedAt: new Date()
     });
   }
   ```

3. **Use consistent parameter names**:
   - `subscriptionIntentId` for SubscriptionIntent
   - `subscriptionId` for Subscription
   - Add JSDoc comments clarifying which entity

### Database Queries

1. **Always use correct schema imports**:
   ```typescript
   const { subscription } = await import("~/server/db/schema");
   const sub = await db.query.subscription.findFirst({
     where: eq(subscription.id, subscriptionId)
   });
   ```

2. **Use query functions from queries.ts**:
   - More maintainable
   - Consistent error handling
   - Proper typing

---

## Future Improvements

### Scheduled Tasks (TODO)

Create cron jobs for:
- `getSubscriptionsDueForRenewal()` - Check for upcoming renewals
- Auto-trigger checkout agent for due subscriptions
- Send renewal notifications

### Bulk Operations (TODO)

Implement UI for:
- `bulkUpdateSubscriptionStatus()` - Pause/resume multiple
- `bulkDeleteSubscriptions()` - Mass cleanup

### Enhanced Monitoring

Add agent observability:
- Success/failure rates
- Average completion time
- Error tracking
- Browserbase session logs

---

*Last updated: 2024*

