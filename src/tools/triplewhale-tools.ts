// ============================================================
// Triple Whale MCP Tools
//
// Scoped to what actually works on the Starter plan for a
// Shopify-native brand (Larsson & Jennings).
//
// Tools:
//   1. get_analytics_overview   — full summary page metrics  (summary-page:read)
//   2. list_available_metrics   — dump all metric IDs/labels (summary-page:read)
//   3. enrich_product_costs     — push COGS for profit calcs (products:write)
//   4. validate_tw_connection   — check API key is live      (no scope required)
//
// Intentionally excluded:
//   - get_attribution_data: returns 403 on Starter plan (Enterprise only)
//   - push_orders / push_customer / push_subscription / push_product:
//       Shopify native integration already syncs this data automatically.
//       Pushing manually would create duplicates.
//   - push_ad_data: Facebook, Google, TikTok are natively integrated.
//       Only needed for non-native channels like Taboola.
//   - push_pps_response: only needed for custom survey tools with no
//       native TW integration.
//   - submit_compliance_deletion: operational/legal tool, not relevant
//       for answering business questions via Claude.
//   - enrich_order_shipping: niche — only matters if actual carrier cost
//       differs significantly from what Shopify reports.
// ============================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as tw from "../services/triplewhale.js";
import { validateDateRange } from "../utils/validation.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function errorResult(err: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

function successResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerTripleWhaleTools(server: McpServer) {

  // ── 1. Analytics Overview ──────────────────────────────────────────────────
  //
  // Primary tool. The TW Summary Page endpoint returns everything visible on
  // the dashboard: revenue, ad spend by channel, blended ROAS, net profit,
  // new vs returning customer splits, AOV, orders, and more.
  // This answers the vast majority of performance questions about L&J.

  server.registerTool(
    "get_analytics_overview",
    {
      title: "Analytics Overview (Triple Whale)",
      description:
        "Get performance metrics from Triple Whale for a given date range. " +
        "This is the primary tool for answering questions about L&J ecommerce performance. " +
        "Returns: total revenue, net sales, blended ROAS, net profit, gross profit, MER, " +
        "new vs returning customer splits, total orders, AOV, conversion rate, " +
        "AND full Facebook breakdown (31 metrics: spend, ROAS, CPA, CPC, CPM, CTR, impressions, " +
        "clicks, reach, purchases, conversion value, view-through attribution, social engagement), " +
        "Google (spend, ROAS, conversion value), TikTok (spend, ROAS), " +
        "and Klaviyo (revenue, flows %, campaigns %). " +
        "Use this for questions like: 'How did we perform last week?', " +
        "'What was our Facebook CPC or CPM?', 'How many impressions did we get on Meta?', " +
        "'What is our view-through ROAS?', 'Compare new vs returning customer revenue.'",
      inputSchema: {
        start_date: z
          .string()
          .describe(
            "Start of the reporting period in YYYY-MM-DD format. " +
            "Examples: 'last week' → Monday of last week; " +
            "'last month' → first day of last month; " +
            "'last 7 days' → today minus 7 days; " +
            "'yesterday' → yesterday's date."
          ),
        end_date: z
          .string()
          .describe(
            "End of the reporting period in YYYY-MM-DD format. " +
            "Examples: 'last week' → Sunday of last week; " +
            "'last month' → last day of last month; " +
            "single-day queries → same date as start_date."
          ),
      },
    },
    async ({ start_date, end_date }) => {
      try {
        const { start, end } = validateDateRange(start_date, end_date);
        const raw = await tw.getSummaryPageData(start, end);

        // extractSummaryMetrics pulls out the key metrics into a clean,
        // labelled structure so Claude receives readable data rather than
        // a raw blob. Falls back to the full raw response if extraction fails.
        const structured = tw.extractSummaryMetrics(raw);

        return successResult(structured);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── 2. List All Available Metrics ──────────────────────────────────────────
  //
  // Dumps every metric ID and label returned by the Summary Page endpoint.
  // Use this to discover what channel/campaign metrics are actually present
  // in the TW response before deciding whether a plan upgrade is needed.
  // Supports an optional keyword filter (e.g. "facebook", "campaign", "brand").

  server.registerTool(
    "list_available_metrics",
    {
      title: "List All Available Triple Whale Metrics",
      description:
        "Dump every metric ID and label from the Triple Whale Summary Page for a given date range. " +
        "Returns all available metrics with their current values so you can discover what data " +
        "is actually present in the response (e.g. channel-level or campaign-level fields). " +
        "Use the optional 'filter' parameter to search by keyword — e.g. 'facebook', 'google', " +
        "'campaign', 'brand', 'tiktok', 'creative'. " +
        "Use this to audit what metrics are available before deciding on a plan upgrade.",
      inputSchema: {
        start_date: z
          .string()
          .describe("Start of the reporting period in YYYY-MM-DD format."),
        end_date: z
          .string()
          .describe("End of the reporting period in YYYY-MM-DD format."),
        filter: z
          .string()
          .optional()
          .describe(
            "Optional keyword to filter results (case-insensitive). " +
            "Matched against both metricId and label. " +
            "E.g. 'facebook', 'campaign', 'brand', 'google', 'creative'."
          ),
      },
    },
    async ({ start_date, end_date, filter }) => {
      try {
        const { start, end } = validateDateRange(start_date, end_date);
        const raw = await tw.getSummaryPageData(start, end);
        return successResult(tw.dumpAllMetrics(raw, filter));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── 3. Enrich Product Costs (COGS) ─────────────────────────────────────────
  //
  // Pushes variant-level cost-of-goods data into TW. Without COGS, TW cannot
  // calculate Gross Profit or Contribution Margin. This is a write/admin tool —
  // Claude should only call it when explicitly asked to update cost data.

  server.registerTool(
    "enrich_product_costs",
    {
      title: "Update Product Cost (COGS) Data in Triple Whale",
      description:
        "Push variant-level cost-of-goods-sold (COGS) data to Triple Whale for existing Shopify products. " +
        "This unlocks Gross Profit and Contribution Margin calculations in the TW dashboard. " +
        "Only call this when explicitly asked to update product cost data — it is a write operation. " +
        "Requires 'products:write' scope. Only works for products already in Shopify.",
      inputSchema: {
        products: z
          .array(
            z.object({
              productId: z
                .string()
                .describe("Shopify product ID (numeric string, e.g. '8234567890123')"),
              variants: z
                .array(
                  z.object({
                    variantId: z
                      .string()
                      .describe("Shopify variant ID (numeric string)"),
                    cost: z
                      .number()
                      .describe(
                        "Cost of goods for this variant in the store's currency (GBP for L&J). " +
                        "This is the purchase/production cost, not the selling price."
                      ),
                  })
                )
                .describe("One entry per variant with its cost"),
            })
          )
          .describe("Array of products with COGS data to push"),
      },
    },
    async ({ products }) => {
      try {
        const result = await tw.enrichProducts(products);
        return successResult({
          success: true,
          productsUpdated: products.length,
          variantsUpdated: products.reduce((sum, p) => sum + p.variants.length, 0),
          response: result,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // ── 4. Validate Connection ─────────────────────────────────────────────────
  //
  // Lightweight health check — confirms the API key is live and returns its
  // metadata (name, scopes, last used). Use when debugging connection issues.

  server.registerTool(
    "validate_tw_connection",
    {
      title: "Validate Triple Whale Connection",
      description:
        "Check whether the configured Triple Whale API key is valid and active. " +
        "Returns the key's name, assigned scopes, and last-used timestamp. " +
        "Use this to diagnose connection issues or confirm which scopes are enabled.",
      inputSchema: {},
    },
    async () => {
      try {
        return successResult(await tw.validateApiKey());
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}