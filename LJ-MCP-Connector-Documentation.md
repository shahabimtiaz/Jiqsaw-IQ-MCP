# L&J MCP Connector — Technical Documentation
## Section 1: Core Integration — Shopify · Triple Whale · Klaviyo

**Version:** 1.4.0
**Status:** Production-ready — all tools live
**Date:** 2026-02-21

---

## Objective

Build and deploy a remote Model Context Protocol (MCP) server that grants Claude
controlled, read-oriented access to Larsson & Jennings' three core business
platforms: Shopify (orders, inventory, customers), Triple Whale (marketing
analytics), and Klaviyo (email and flow performance).

The integration enables cross-platform business intelligence queries from within
Claude — without exposing raw API credentials, granting write access beyond a
single explicitly scoped operation, or providing access to billing, account
configuration, or discount controls.

---

## Scope

### Included

| Platform | Capabilities |
|---|---|
| Shopify | Read orders, products, inventory, and customer records |
| Triple Whale | Read Summary Page metrics (revenue, ad spend, ROAS, profit, customer splits); discover all available metric IDs |
| Klaviyo | Read flows, lists, segments, metrics, metric aggregate data, and campaign performance |

### Explicitly Excluded

- No access to Shopify billing, payment settings, or store configuration
- No access to Shopify discount codes, gift cards, or price rules
- No ability to create, update, or delete Shopify orders or customers
- No access to Triple Whale account settings, user management, or billing
- No access to Klaviyo account settings, billing, or template management
- No ability to send emails or trigger flows via Klaviyo
- No API keys exposed in any tool response or log output

---

## Architecture Overview

```
Claude (claude.ai)
       │
       │  HTTPS POST /mcp
       ▼
┌─────────────────────────────────┐
│       L&J MCP Server            │
│   Node.js · TypeScript          │
│   Express · MCP SDK 1.x         │
│                                 │
│  ┌──────────┐ ┌──────────────┐  │
│  │ Shopify  │ │ Triple Whale │  │
│  │  Tools   │ │    Tools     │  │
│  └──────────┘ └──────────────┘  │
│  ┌──────────────────────────┐   │
│  │      Klaviyo Tools       │   │
│  └──────────────────────────┘   │
│                                 │
│  Input validation layer         │
│  In-memory response cache       │
│  Rate limiter (120 req/min)      │
└─────────────────────────────────┘
       │           │           │
       ▼           ▼           ▼
  Shopify     Triple Whale   Klaviyo
  Admin API   API v2         API
  REST 2025-01               Rev 2026-01-15
```

**Transport:** Streamable HTTP (stateless — no session persistence between requests)
**Per-request lifecycle:** Each MCP request instantiates a fresh server and transport
instance. No state is shared between calls.

---

## API Endpoints Used

### Shopify Admin REST API (`/admin/api/2025-01`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/orders.json` | GET | Sales summary, top products, recent orders |
| `/orders/{id}.json` | GET | Single order detail |
| `/products.json` | GET | Inventory status |
| `/customers/{id}.json` | GET | Customer lookup |
| `/customers/search.json` | GET | Customer search by email or name |
| `/admin/oauth/access_token` | POST | Token refresh (called automatically on 401) |

### Triple Whale API (`https://api.triplewhale.com/api/v2`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/summary-page/get-data` | POST | Full dashboard metrics (revenue, ROAS, ad spend, profit); also used to enumerate all available metric IDs |
| `/order-tracking/enrich-products` | POST | Push COGS data for gross profit calculations |
| `/users/api-keys/me` | GET | API key validation |

### Klaviyo API (`https://a.klaviyo.com/api`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/flows` | GET | Automated flow list and status |
| `/lists` | GET | Subscriber list names and IDs |
| `/segments` | GET | Segment definitions and profile counts |
| `/metrics` | GET | Available metric event types |
| `/metric-aggregates` | POST | Aggregate metric data for a date range |
| `/campaigns` | GET | Campaign list (email + SMS, merged) |
| `/campaign-values-reports` | POST | Campaign performance metrics |

---

## Authentication

All credentials are stored exclusively as server-side environment variables.
No credential is passed through any tool response or included in any log.

| Platform | Method | Header |
|---|---|---|
| Shopify | Private app access token | `X-Shopify-Access-Token` |
| Triple Whale | API key | `x-api-key` |
| Klaviyo | Private API key | `Authorization: Klaviyo-API-Key` |

Credentials are injected at server startup from environment variables:
`SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`,
`TRIPLE_WHALE_API_KEY`, `KLAVIYO_API_KEY`.

---

## Data Permissions Enforced

### Shopify
The private app token is scoped to read-only access for orders, products, and
customers. No write scopes are provisioned.

### Triple Whale
The API key holds two scopes:
- `summary-page:read` — read dashboard metrics
- `products:write` — push COGS values only (no other write access)

Explicitly not provisioned: account management, user administration, billing,
attribution enterprise endpoints.

### Shopify token auto-refresh
Two additional environment variables enable automatic token refresh on 401:
- `SHOPIFY_CLIENT_ID` — OAuth app client ID
- `SHOPIFY_CLIENT_SECRET` — OAuth app client secret

When a Shopify API call returns 401, the server calls
`POST /admin/oauth/access_token` with `grant_type=client_credentials`, writes
the new token into memory, and retries the original request once — all
transparently to the caller. The new token is logged to stdout so the operator
can update `SHOPIFY_ACCESS_TOKEN` in the deployment environment to persist it
across restarts. If the OAuth credentials are absent, a 401 surfaces as an
error to the user instead.

### Klaviyo
The private API key holds:
- `flows:read`
- `lists:read`
- `segments:read`
- `metrics:read`
- `campaigns:read`

Not provisioned: any write scope, send permissions, template access, account
settings, or billing access.

---

## Security Considerations

| Control | Implementation |
|---|---|
| CORS restriction | Requests accepted only from `claude.ai`, `*.anthropic.com`, and localhost. All other origins are blocked in production. |
| Rate limiting | 120 requests per minute per IP via `express-rate-limit`. |
| Input validation | All tool inputs validated before reaching API calls: date format, date range ordering, numeric ID format, string length bounds, future-date rejection. |
| No credential exposure | API keys are never returned in tool responses or passed to Claude's context. Exception: when a Shopify access token is auto-refreshed, the new token is logged to stdout (by design, so the operator can persist it). The underlying client secret and all other API keys are never logged. |
| Stateless design | No session tokens, no persistent user state, no cross-request data leakage. |
| Response size control | Triple Whale raw chart data is stripped before returning to Claude — only structured metric summaries are returned (reduced from ~600 KB to ~3.5 KB per response). |
| Error messages | API errors return the HTTP status and message only — no stack traces, no internal configuration details. |

---

## Current Status

| Tool | Status | Notes |
|---|---|---|
| `get_sales_summary` | ✅ Live | |
| `get_top_products` | ✅ Live | |
| `get_order_details` | ✅ Live | |
| `get_inventory_status` | ✅ Live | |
| `get_customer_data` | ✅ Live | |
| `search_customers` | ✅ Live | |
| `get_recent_orders` | ✅ Live | |
| `get_analytics_overview` | ✅ Live | Expanded to 31 Facebook metrics (CPC, CPM, CTR, impressions, clicks, reach, purchases, view-through attribution, social engagement); Google, TikTok, Klaviyo also structured |
| `list_available_metrics` | ✅ Live | Dumps all metric IDs/labels from Summary Page; optional keyword filter for discovery |
| `enrich_product_costs` | ✅ Live | Write-scoped; updates COGS values only |
| `validate_tw_connection` | ✅ Live | |
| `get_email_flows` | ✅ Live | Klaviyo rev 2026-01-15 pagination fix applied |
| `get_subscriber_lists` | ✅ Live | Klaviyo rev 2026-01-15 pagination fix applied |
| `get_subscriber_count` | ✅ Live | |
| `get_segments` | ✅ Live | |
| `get_klaviyo_metrics` | ✅ Live | |
| `query_klaviyo_metric` | ✅ Live | |
| `get_email_campaigns` | ✅ Live | Fetches email + SMS campaigns; channel filter applied (rev 2026-01-15 requirement) |
| `get_campaign_performance` | ✅ Live | Placed Order metric ID resolved dynamically; statistics updated for rev 2026-01-15 |

---

## Test References

### Cross-Platform Test

Validation was performed using live cross-platform scenarios requiring simultaneous
data retrieval from multiple integrations.

**Scenarios tested:**

1. Full business overview — Shopify revenue + Triple Whale analytics + Klaviyo email performance in a single response
2. Revenue reconciliation — Shopify vs Triple Whale side-by-side comparison with variance analysis
3. Product and inventory crossover — top-selling products from Shopify orders mapped against live inventory levels
4. Marketing channel analysis — Triple Whale ad performance alongside Klaviyo email metrics in a unified view

All scenarios returned accurate, coherent answers drawing on live data from the correct source.

**Reference:** https://claude.ai/share/910bed1e-a9d6-4f9b-8b61-fc6a851a9d4f

---

### Triple Whale Integration Test

Dedicated validation of the Triple Whale integration covering analytics overview,
ROAS breakdown, ad spend by channel, new vs returning customer splits, and
profit metrics.

**Reference:** https://claude.ai/share/40e51fc6-d11e-497e-8ab4-4d56c07d3f32

---

### Shopify Integration Test

Dedicated validation of the Shopify integration covering sales summaries, order
details, top products, inventory status, and customer lookup.

**Reference:** https://claude.ai/share/e85f396e-856d-4e9b-9ae0-526e9a3b6f8d

---

### Klaviyo Integration Test

Dedicated validation of the Klaviyo integration covering campaign performance,
flow status, subscriber lists, segments, and metric aggregate queries.

**Reference:** https://claude.ai/chat/2bb318bf-2b8c-4202-be76-90d3c113c864
