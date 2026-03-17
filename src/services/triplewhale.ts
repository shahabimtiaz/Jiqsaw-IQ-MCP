// ============================================================
// Triple Whale API service
//
// Endpoints in use:
//   GET  /users/api-keys/me              — validate key (no scope)
//   POST /summary-page/get-data          — read dashboard metrics (summary-page:read)
//   POST /order-tracking/enrich-products — push COGS data (products:write)
//
// Excluded endpoints:
//   /attribution/get-orders-with-journeys-v2 — Enterprise plan only, returns 403
//   /order-tracking/bulk-create-orders etc.  — not needed for Shopify native brands
// ============================================================

import { config } from "../config.js";
import { apiFetch } from "./http.js";

const BASE = "https://api.triplewhale.com/api/v2";

const headers = () => ({
  "x-api-key": config.tripleWhaleApiKey,
});

// ─────────────────────────────────────────────
// DATA-OUT: Summary Page
// ─────────────────────────────────────────────

/**
 * Fetch the Triple Whale Summary Page metrics for a date range.
 * Scope required: summary-page:read
 *
 * This is the core read endpoint — returns every metric visible on the
 * TW dashboard: revenue, ad spend, ROAS, profit, new/returning splits, etc.
 */
export async function getSummaryPageData(startDate: string, endDate: string) {
  const data = await apiFetch<Record<string, unknown>>(
    `${BASE}/summary-page/get-data`,
    {
      method: "POST",
      headers: headers(),
      body: {
        shopDomain: config.shopifyStoreUrl,
        period: {
          start: startDate,
          end: endDate,
        },
      },
      cacheTTL: 120,
    }
  );

  return {
    period: { start: startDate, end: endDate },
    data,
  };
}

// ─────────────────────────────────────────────
// Summary Page: metric extraction helper
// ─────────────────────────────────────────────

/**
 * The raw Summary Page response is a large blob with a `metrics` array where
 * each entry has a `metricId`, `label`, and nested `values` object.
 *
 * This function pulls out the metrics Claude actually needs to answer business
 * questions and returns a clean, labelled object. If extraction fails for any
 * reason (TW changes their response shape), it falls back to the raw data so
 * nothing breaks silently.
 */
export function extractSummaryMetrics(raw: {
  period: { start: string; end: string };
  data: Record<string, unknown>;
}) {
  try {
    const metrics: any[] = (raw.data?.metrics as any[]) ?? [];

    // Helper: find a metric and return both current and comparison period values.
    const valWithComparison = (id: string) => {
      const m = metrics.find((x: any) => x?.metricId === id);
      if (!m) return null;
      return {
        current: m?.values?.current ?? null,
        previous: m?.values?.comparison ?? null,
        change_pct: m?.values?.percentChange ?? null,
      };
    };

    const extracted = {
      period: raw.period,

      // ── Revenue ──────────────────────────────────────────────────────────
      revenue: {
        order_revenue_gross: valWithComparison("totalSales"),   // gross before discounts
        net_sales: valWithComparison("netSales"),
        gross_profit: valWithComparison("grossProfit"),
        net_profit: valWithComparison("totalNetProfit"),
        cogs: valWithComparison("totalProductCostsOrders"),
      },

      // ── Orders & Customers ────────────────────────────────────────────────
      orders: {
        total_orders: valWithComparison("totalOrders"),
        unique_customers: valWithComparison("getUniqueCustomerCount"),
        aov: valWithComparison("shopifyAov"),                   // average order value
        conversion_rate_pct: valWithComparison("conversionRate"),
      },

      // ── New vs Returning ──────────────────────────────────────────────────
      customer_split: {
        new_customer_revenue: valWithComparison("newCustomerSales"),
        new_customer_orders: valWithComparison("newCustomersOrders"),
        new_customer_cpa: valWithComparison("newCustomersCpa"),
        new_customer_roas: valWithComparison("newCustomersRoas"),
        new_customers_pct: valWithComparison("newCustomersPercent"),
        returning_customer_revenue: valWithComparison("rcRevenue"),
        returning_customer_orders: valWithComparison("returningCustomerOrders"),
      },

      // ── Ad Spend & ROAS (blended) ─────────────────────────────────────────
      advertising: {
        total_ad_spend: valWithComparison("blendedAds"),
        blended_roas: valWithComparison("totalRoas"),
        blended_attributed_roas: valWithComparison("blendedAttributedRoas"),
        mer: valWithComparison("mer"),                          // marketing efficiency ratio
      },

      // ── Facebook — all 31 metrics confirmed present in Summary Page ───────
      // Metric IDs discovered via list_available_metrics (2026-02-21).
      facebook: {
        // Core spend & returns
        spend: valWithComparison("fb_ads_spend"),
        roas: valWithComparison("fb_ads_purchase_roas"),
        cpa: valWithComparison("facebookCpa"),
        benchmark_roas: valWithComparison("benchmarksFacebookRoas"),

        // Conversion value (three attribution windows TW tracks)
        conversion_value: valWithComparison("facebookConversionValue"),
        web_conversion_value: valWithComparison("facebookWebConversionValue"),
        meta_conversion_value: valWithComparison("facebookMetaConversionValue"),

        // Purchases
        purchases: valWithComparison("facebookPurchases"),
        web_purchases: valWithComparison("facebookWebPurchases"),
        meta_purchases: valWithComparison("facebookMetaPurchases"),

        // Traffic & reach
        impressions: valWithComparison("facebookImpressions"),
        clicks: valWithComparison("facebookClicks"),
        outbound_clicks: valWithComparison("facebookOutboundClicks"),
        website_clicks: valWithComparison("facebookWebsiteClicks"),
        reach: valWithComparison("facebookReach"),
        revenue_per_click: valWithComparison("facebookRevenuePerClick"),

        // Cost efficiency
        cpc: valWithComparison("averageFacebookCpc"),
        cpm: valWithComparison("averageFacebookCpm"),
        ctr: valWithComparison("facebookCtr"),
        cost_per_outbound_click: valWithComparison("facebookCostPerOutboundClick"),

        // View-through attribution
        view_through_conversions: valWithComparison("facebookViewThrough"),
        view_through_roas: valWithComparison("facebookViewThroughRoas"),
        view_through_cpa: valWithComparison("facebookViewThroughCpa"),

        // TW attribution signals
        tw_enquiry: valWithComparison("totalFacebookEnq"),
        tw_known: valWithComparison("totalFacebookKno"),

        // Social engagement
        likes: valWithComparison("facebookLikes"),
        comments: valWithComparison("facebookComments"),
        shares: valWithComparison("facebookShares"),
        posts: valWithComparison("facebookPosts"),
        followers: valWithComparison("facebookFollowers"),
        social_impressions: valWithComparison("facebookSocialImpressions"),
        social_avg: valWithComparison("facebookSocialAvg"),
        profile_views: valWithComparison("facebookProfileView"),
      },

      // ── Google ────────────────────────────────────────────────────────────
      google: {
        spend: valWithComparison("ga_adCost"),
        roas: valWithComparison("ga_ROAS"),
        conversion_value: valWithComparison("googleConversionValue"),
      },

      // ── TikTok ───────────────────────────────────────────────────────────
      tiktok: {
        spend: valWithComparison("tiktok_spend"),
        roas: valWithComparison("tiktok_complete_payment_roas"),
      },

      // ── Klaviyo ──────────────────────────────────────────────────────────
      klaviyo: {
        revenue: valWithComparison("klaviyoPlacedOrderSales"),
        revenue_pct: valWithComparison("totalKlaviyoPlacedOrderSalesPercent"),
        flows_pct: valWithComparison("totalKlaviyoPlacedOrderSalesPercentFlows"),
        campaigns_pct: valWithComparison("totalKlaviyoPlacedOrderSalesPercentCampaigns"),
      },

      _metrics_available: metrics.length,
    };

    return extracted;
  } catch {
    // If extraction fails for any reason, return the raw response unchanged.
    return {
      period: raw.period,
      _extraction_failed: true,
      _note: "Could not extract structured metrics — returning raw response.",
      data: raw.data,
    };
  }
}

// ─────────────────────────────────────────────
// Summary Page: full metric catalogue dump
// ─────────────────────────────────────────────

/**
 * Return every metric entry from the Summary Page response as a flat list.
 * Each entry includes metricId, label, current value, and comparison value.
 *
 * Optionally filter by a keyword (case-insensitive) matched against metricId
 * or label — useful for hunting channel/campaign-specific metrics.
 */
export function dumpAllMetrics(
  raw: { period: { start: string; end: string }; data: Record<string, unknown> },
  filter?: string
): {
  period: { start: string; end: string };
  total_metrics: number;
  matched_metrics: number;
  filter_used: string | null;
  metrics: Array<{
    metricId: string;
    label: string;
    current: number | null;
    previous: number | null;
    change_pct: number | null;
  }>;
} {
  const all: any[] = (raw.data?.metrics as any[]) ?? [];

  const needle = filter?.toLowerCase() ?? null;
  const matched = needle
    ? all.filter(
        (m: any) =>
          String(m?.metricId ?? "").toLowerCase().includes(needle) ||
          String(m?.label ?? "").toLowerCase().includes(needle)
      )
    : all;

  return {
    period: raw.period,
    total_metrics: all.length,
    matched_metrics: matched.length,
    filter_used: filter ?? null,
    metrics: matched.map((m: any) => ({
      metricId: m?.metricId ?? null,
      label: m?.label ?? null,
      current: m?.values?.current ?? null,
      previous: m?.values?.comparison ?? null,
      change_pct: m?.values?.percentChange ?? null,
    })),
  };
}

// ─────────────────────────────────────────────
// DATA-IN: Product Cost Enrichment (COGS)
// ─────────────────────────────────────────────

export interface ProductVariantCost {
  variantId: string;
  cost: number;
}

export interface ProductCostRecord {
  productId: string;
  variants: ProductVariantCost[];
}

/**
 * Push variant-level COGS data to Triple Whale for existing Shopify products.
 * Scope required: products:write
 *
 * Without this data, TW cannot calculate Gross Profit or Contribution Margin.
 * Only works for products that already exist in TW via the Shopify integration.
 * Not supported for WooCommerce or BigCommerce products.
 */
export async function enrichProducts(products: ProductCostRecord[]) {
  const data = await apiFetch<Record<string, unknown>>(
    `${BASE}/order-tracking/enrich-products`,
    {
      method: "POST",
      headers: headers(),
      body: {
        shopDomain: config.shopifyStoreUrl,
        products,
      },
    }
  );
  return data;
}

// ─────────────────────────────────────────────
// Utility: Validate API Key
// ─────────────────────────────────────────────

/**
 * Validate the configured API key and return its metadata.
 * No special scope required.
 */
export async function validateApiKey() {
  try {
    const data = await apiFetch<Record<string, unknown>>(
      `${BASE}/users/api-keys/me`,
      {
        method: "GET",
        headers: headers(),
        cacheTTL: 300,
      }
    );
    return { valid: true, data };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}