# L&J MCP Server – Remote Connector for Claude

A hosted remote MCP (Model Context Protocol) server that connects Claude AI to Larsson & Jennings' ecommerce data: **Shopify**, **Triple Whale**, and **Klaviyo**.

## What This Does

Once deployed and connected, Andrew (or anyone on the team) can ask Claude natural language questions like:

- *"What were L&J's sales last week?"*
- *"Show me top 10 products this month"*
- *"How is our email campaign performing?"*
- *"What's our inventory status?"*

Claude will automatically call this MCP server, fetch live data, and answer conversationally.

---

## Quick Start

### 1. Prerequisites

- **Node.js 18+** installed
- **Git** installed
- API credentials (Shopify token, Triple Whale key, Klaviyo key)

### 2. Clone & Install

```bash
git clone <your-repo-url>
cd lj-mcp-server
npm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your real credentials:

```env
SHOPIFY_STORE_URL=larsson-jennings.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_your_token_here
SHOPIFY_CLIENT_ID=your_shopify_client_id
SHOPIFY_CLIENT_SECRET=your_shopify_client_secret
TRIPLE_WHALE_API_KEY=your_triple_whale_api_key
KLAVIYO_API_KEY=pk_your_klaviyo_key_here
PORT=3000
NODE_ENV=production
```

> Tools only register if their corresponding API key is present. If a key is missing the server still starts, but that integration's tools will be unavailable.

### 4. Build & Run Locally

```bash
npm run build
npm start
```

Or for development with hot-reload:

```bash
npm run dev
```

### 5. Test It

```bash
# Health check
curl http://localhost:3000/health

# Test MCP initialize handshake
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'
```

---

## Deploy to Railway (Recommended)

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial LJ MCP server"
git remote add origin <your-github-repo-url>
git push -u origin main
```

### Step 2: Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your repository
4. Railway auto-detects Node.js

### Step 3: Set Environment Variables

In Railway dashboard → your service → **Variables** tab, add:

| Variable | Value |
|---|---|
| `SHOPIFY_STORE_URL` | `larsson-jennings.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | *(your Shopify Admin API access token)* |
| `SHOPIFY_CLIENT_ID` | *(your Shopify app client ID — used to auto-refresh the access token on expiry)* |
| `SHOPIFY_CLIENT_SECRET` | *(your Shopify app client secret — used to auto-refresh the access token on expiry)* |
| `TRIPLE_WHALE_API_KEY` | *(your Triple Whale API key)* |
| `KLAVIYO_API_KEY` | *(your Klaviyo private API key)* |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |

### Step 4: Deploy

Railway deploys automatically on push. Your URL will be something like:

```
https://lj-connector-production.up.railway.app
```

### Step 5: Verify

```bash
curl https://lj-connector-production.up.railway.app/health
```

---

## Deploy to Render (Alternative)

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Add environment variables (same as Railway table above)

---

## Connect to Claude

### For Individual Pro/Max Users:

1. Open **Claude** (web at claude.ai)
2. Go to **Settings** → **Connectors**
3. Click **"Add custom connector"**
4. Paste your MCP server URL: `https://your-app.up.railway.app/mcp`
5. Click **"Add"**

### For Team/Enterprise:

1. The workspace **Owner** adds the connector in **Settings** → **Connectors**
2. Team members then find it listed under Connectors and click **"Connect"**

---

## Available Tools (19 Total)

### Shopify (7 tools)

| Tool | Description |
|---|---|
| `get_sales_summary` | Revenue, orders, AOV for a date range |
| `get_top_products` | Top sellers ranked by revenue |
| `get_order_details` | Full details for a specific order |
| `get_inventory_status` | Stock levels, low-stock & out-of-stock alerts |
| `get_customer_data` | Customer profile by ID |
| `search_customers` | Find customers by email or name |
| `get_recent_orders` | Latest orders at a glance |

### Triple Whale (4 tools)

| Tool | Description |
|---|---|
| `get_analytics_overview` | Summary page metrics (revenue, ad spend, ROAS, profit, new vs returning splits) |
| `list_available_metrics` | Dump all metric IDs and labels from the Summary Page — supports keyword filter (e.g. `facebook`, `campaign`, `brand`) to discover what channel-level data is present |
| `enrich_product_costs` | Push COGS values for gross profit calculations (write-scoped) |
| `validate_tw_connection` | Verify API key is working |

> `get_attribution_data` is excluded — it requires an Enterprise plan and returns 403 on Starter. `query_triple_whale_ai` (Moby) is not available via the REST API.

### Klaviyo (8 tools)

| Tool | Description |
|---|---|
| `get_email_campaigns` | List recent email and SMS campaigns |
| `get_campaign_performance` | Opens, clicks, revenue for a specific campaign |
| `get_email_flows` | Automated flow sequences and their status |
| `get_subscriber_lists` | All subscriber lists with IDs |
| `get_subscriber_count` | Profile counts per subscriber list |
| `get_segments` | Segments with profile counts |
| `get_klaviyo_metrics` | Available metric event types |
| `query_klaviyo_metric` | Aggregate metric data over a date range |

---

## Architecture

```
Claude AI  →  HTTPS  →  This MCP Server  →  Shopify REST API
                                          →  Triple Whale API
                                          →  Klaviyo API
```

- **Stateless** Streamable HTTP transport (no sessions needed)
- **In-memory caching** with configurable TTL to reduce API calls
- **Automatic retry** with exponential backoff for rate limits
- **Graceful error handling** – tools return error messages instead of crashing
- **CORS restriction** – requests accepted only from `claude.ai`, `*.anthropic.com`, and localhost

---

## Project Structure

```
lj-mcp-server/
├── src/
│   ├── index.ts              # Express server + MCP wiring
│   ├── config.ts             # Environment variable config
│   ├── stdio.ts              # stdio transport entry point
│   ├── services/
│   │   ├── http.ts           # Shared fetch helper (retry, cache)
│   │   ├── shopify.ts        # Shopify API integration
│   │   ├── triplewhale.ts    # Triple Whale API integration
│   │   └── klaviyo.ts        # Klaviyo API integration
│   ├── tools/
│   │   ├── shopify-tools.ts      # Shopify MCP tool definitions
│   │   ├── triplewhale-tools.ts  # Triple Whale MCP tool definitions
│   │   └── klaviyo-tools.ts      # Klaviyo MCP tool definitions
│   └── utils/
│       └── validation.ts     # Input validation helpers
├── dist/                     # Compiled output (git-ignored)
├── package.json
├── tsconfig.json
├── Dockerfile
├── Procfile
├── .env.example
└── README.md
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server + Streamable HTTP transport |
| `express` | HTTP server |
| `cors` | CORS middleware (restricts to Anthropic/Claude origins) |
| `express-rate-limit` | Rate limiting (120 req/min per IP) |
| `node-cache` | In-memory response caching |
| `zod` | Input schema validation |
| `dotenv` | Environment variable loading |
| `tsx` | TypeScript dev runner (dev only) |

---

## Troubleshooting

**"429 Too Many Requests" from Shopify**
- The server automatically retries with backoff. Shopify allows 2 req/sec for the REST API.

**Shopify returns 401 (token expired)**
- If `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are set, the server auto-refreshes the token and retries the request transparently. The new token is printed to stdout — update `SHOPIFY_ACCESS_TOKEN` in your deployment env to persist it across restarts.
- If the OAuth credentials are not set, a 401 will surface as an error. Add `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` to enable auto-refresh.

**Triple Whale returns 404 or 403**
- Verify your API key has the correct scopes: `summary-page:read` and `products:write`.
- The `get_attribution_data` endpoint is Enterprise-only and is intentionally not included.

**Klaviyo tools not appearing**
- Ensure `KLAVIYO_API_KEY` is set. Tools only register if the corresponding API key is present.

**Claude can't reach the server**
- Verify the URL ends in `/mcp` (e.g., `https://your-app.railway.app/mcp`)
- Check the `/health` endpoint returns `"status": "ok"`
- Ensure the origin is `claude.ai` or `*.anthropic.com` — other origins are blocked in production

**Health check shows an integration as `false`**
- The `/health` endpoint reports which integrations are active. A `false` value means that integration's API key is missing from environment variables.

---

## Cost

- **Railway**: ~$5–10/month for this workload
- **Render**: Free tier available (with cold starts), paid from $7/month
