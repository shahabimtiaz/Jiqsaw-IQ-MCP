// ============================================================
// Shopify Admin REST API service
// ============================================================

import { config } from "../config.js";
import { apiFetch, apiFetchPaginated } from "./http.js";

const base = () =>
  `https://${config.shopifyStoreUrl}/admin/api/${config.shopifyApiVersion}`;

// headers() is a function (not a constant) so it always picks up the latest
// token from config — including one freshly written by refreshAccessToken().
const headers = () => ({
  "X-Shopify-Access-Token": config.shopifyAccessToken,
});

// ─────────────────────────────────────────────
// Token refresh
// ─────────────────────────────────────────────

/**
 * Use the stored OAuth client credentials to obtain a new Shopify access token
 * and write it back into config so all subsequent requests use it immediately.
 *
 * The new token is also logged to stdout so the operator can persist it to the
 * SHOPIFY_ACCESS_TOKEN environment variable before the next cold start.
 */
async function refreshAccessToken(): Promise<void> {
  if (!config.shopifyClientId || !config.shopifyClientSecret) {
    throw new Error(
      "Shopify access token expired and SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET " +
      "are not configured — cannot auto-refresh. Add these to your environment variables."
    );
  }

  console.warn("[shopify] Access token expired (401). Attempting OAuth refresh…");

  const res = await fetch(
    `https://${config.shopifyStoreUrl}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.shopifyClientId,
        client_secret: config.shopifyClientSecret,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shopify token refresh failed: HTTP ${res.status} ${res.statusText}. ${body}`
    );
  }

  const json = (await res.json()) as { access_token: string };
  config.shopifyAccessToken = json.access_token;

  // Log so the operator can update SHOPIFY_ACCESS_TOKEN in the deployment env.
  console.log(
    `[shopify] Token refreshed successfully. ` +
    `Update SHOPIFY_ACCESS_TOKEN in your environment to: ${json.access_token}`
  );
}

/**
 * Run fn(), and if it throws a Shopify 401, refresh the access token and
 * retry exactly once. Any other error is re-thrown immediately.
 */
async function withTokenRefresh<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const is401 =
      err instanceof Error &&
      err.message.startsWith("HTTP 401") &&
      err.message.includes("myshopify.com");

    if (!is401) throw err;

    await refreshAccessToken();
    return fn();
  }
}

// ---------- Types (minimal, for what we need) ----------

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancel_reason: string | null;
  line_items: {
    id: number;
    title: string;
    quantity: number;
    price: string;
    sku: string;
    variant_title: string;
  }[];
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
  };
  shipping_address?: {
    country: string;
    city: string;
  };
}

interface ShopifyProduct {
  id: number;
  title: string;
  vendor: string;
  product_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  variants: {
    id: number;
    title: string;
    price: string;
    sku: string;
    inventory_quantity: number;
  }[];
  images: { src: string }[];
}

interface ShopifyCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  orders_count: number;
  total_spent: string;
  created_at: string;
  tags: string;
  note: string | null;
}

// ---------- Private pagination helpers ----------

/**
 * Fetch all orders in a date range using Shopify's Link-header cursor pagination.
 *
 * Why cursor pagination instead of since_id:
 *   since_id can silently skip orders that arrive between page fetches.
 *   Link-header cursors are a stable snapshot — no orders are missed.
 *
 * Revenue accuracy:
 *   - Excludes cancelled orders (cancel_reason !== null)
 *   - Excludes voided orders (authorization was never captured)
 *   - Excludes fully-refunded orders (money was returned to customer)
 *   Remaining statuses (paid, partially_paid, partially_refunded) represent
 *   actual revenue received.
 */
async function fetchAllOrders(since: string, until: string): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let url: string | null =
    `${base()}/orders.json` +
    `?status=any` +
    `&created_at_min=${since}` +
    `&created_at_max=${until}` +
    `&limit=250`;

  while (url) {
    const pageUrl: string = url;
    const { data, nextUrl }: { data: { orders: ShopifyOrder[] }; nextUrl: string | null } =
      await apiFetchPaginated<{ orders: ShopifyOrder[] }>(pageUrl, {
        headers: headers(),
        cacheTTL: 60,
      });
    allOrders.push(...data.orders);
    url = nextUrl;
  }

  // Keep only revenue-generating orders:
  //   - Not cancelled (cancel_reason is null on non-cancelled orders)
  //   - Not voided (payment authorisation was reversed before capture)
  //   - Not fully refunded (customer was reimbursed in full)
  return allOrders.filter(
    (o) =>
      o.cancel_reason === null &&
      o.financial_status !== "voided" &&
      o.financial_status !== "refunded"
  );
}

/**
 * Fetch all products using Shopify's Link-header cursor pagination.
 * The previous implementation capped at 250 products — this fetches all pages.
 */
async function fetchAllProducts(productTitle?: string): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let url: string | null = `${base()}/products.json?limit=250`;
  if (productTitle) {
    url += `&title=${encodeURIComponent(productTitle)}`;
  }

  while (url) {
    const pageUrl: string = url;
    const { data, nextUrl }: { data: { products: ShopifyProduct[] }; nextUrl: string | null } =
      await apiFetchPaginated<{ products: ShopifyProduct[] }>(pageUrl, {
        headers: headers(),
        cacheTTL: 120,
      });
    allProducts.push(...data.products);
    url = nextUrl;
  }

  return allProducts;
}

// ---------- Public helpers ----------

/**
 * Get orders within a date range and compute sales summary.
 * Only includes paid, partially-paid, and partially-refunded orders.
 * Cancelled, voided, and fully-refunded orders are excluded.
 */
export async function getSalesSummary(startDate: string, endDate: string) {
  return withTokenRefresh(async () => {
    const since = new Date(startDate).toISOString();
    const until = new Date(endDate + "T23:59:59").toISOString();

    const allOrders = await fetchAllOrders(since, until);

    const totalRevenue = allOrders.reduce(
      (sum, o) => sum + parseFloat(o.total_price),
      0
    );
    const totalTax = allOrders.reduce(
      (sum, o) => sum + parseFloat(o.total_tax),
      0
    );
    const totalDiscounts = allOrders.reduce(
      (sum, o) => sum + parseFloat(o.total_discounts),
      0
    );
    const currency = allOrders[0]?.currency || "GBP";

    return {
      period: { start: startDate, end: endDate },
      totalOrders: allOrders.length,
      totalRevenue: totalRevenue.toFixed(2),
      averageOrderValue:
        allOrders.length > 0
          ? (totalRevenue / allOrders.length).toFixed(2)
          : "0.00",
      totalTax: totalTax.toFixed(2),
      totalDiscounts: totalDiscounts.toFixed(2),
      currency,
      ordersByStatus: countBy(allOrders, (o) => o.financial_status),
      fulfillmentBreakdown: countBy(
        allOrders,
        (o) => o.fulfillment_status || "unfulfilled"
      ),
      note: "Excludes cancelled, voided, and fully-refunded orders. Figures reflect actual revenue received.",
    };
  });
}

/**
 * Get top selling products for a given period.
 */
export async function getTopProducts(
  startDate: string,
  endDate: string,
  limit: number = 10
) {
  return withTokenRefresh(async () => {
    const since = new Date(startDate).toISOString();
    const until = new Date(endDate + "T23:59:59").toISOString();

    const allOrders = await fetchAllOrders(since, until);

    // Aggregate line items by product title
    const productMap = new Map<
      string,
      { title: string; quantity: number; revenue: number }
    >();

    for (const order of allOrders) {
      for (const item of order.line_items) {
        const key = item.title;
        const existing = productMap.get(key) || {
          title: key,
          quantity: 0,
          revenue: 0,
        };
        existing.quantity += item.quantity;
        existing.revenue += parseFloat(item.price) * item.quantity;
        productMap.set(key, existing);
      }
    }

    const sorted = [...productMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    return {
      period: { start: startDate, end: endDate },
      topProducts: sorted.map((p, i) => ({
        rank: i + 1,
        title: p.title,
        unitsSold: p.quantity,
        revenue: p.revenue.toFixed(2),
      })),
    };
  });
}

/**
 * Retrieve a single order by ID.
 */
export async function getOrderDetails(orderId: string) {
  return withTokenRefresh(async () => {
    const data = await apiFetch<{ order: ShopifyOrder }>(
      `${base()}/orders/${orderId}.json`,
      { headers: headers(), cacheTTL: 30 }
    );
    const o = data.order;
    return {
      id: o.id,
      name: o.name,
      createdAt: o.created_at,
      totalPrice: o.total_price,
      currency: o.currency,
      financialStatus: o.financial_status,
      fulfillmentStatus: o.fulfillment_status || "unfulfilled",
      cancelReason: o.cancel_reason,
      lineItems: o.line_items.map((li) => ({
        title: li.title,
        variant: li.variant_title,
        quantity: li.quantity,
        price: li.price,
        sku: li.sku,
      })),
      customer: o.customer
        ? {
            name: `${o.customer.first_name} ${o.customer.last_name}`,
            email: o.customer.email,
          }
        : null,
      shippingCountry: o.shipping_address?.country || "N/A",
    };
  });
}

/**
 * Get current inventory status across all products (fully paginated).
 */
export async function getInventoryStatus(productTitle?: string) {
  return withTokenRefresh(async () => {
    const products = await fetchAllProducts(productTitle);

    const inventory = products.map((p) => ({
      productId: p.id,
      title: p.title,
      status: p.status,
      variants: p.variants.map((v) => ({
        variantTitle: v.title,
        sku: v.sku,
        price: v.price,
        inventoryQuantity: v.inventory_quantity,
      })),
      totalInventory: p.variants.reduce(
        (sum, v) => sum + v.inventory_quantity,
        0
      ),
    }));

    const lowStock = inventory.filter((p) =>
      p.variants.some((v) => v.inventoryQuantity > 0 && v.inventoryQuantity <= 5)
    );
    const outOfStock = inventory.filter((p) =>
      p.variants.every((v) => v.inventoryQuantity <= 0)
    );

    return {
      totalProducts: inventory.length,
      lowStockProducts: lowStock.length,
      outOfStockProducts: outOfStock.length,
      products: inventory,
    };
  });
}

/**
 * Get customer details by ID.
 */
export async function getCustomerData(customerId: string) {
  return withTokenRefresh(async () => {
    const data = await apiFetch<{ customer: ShopifyCustomer }>(
      `${base()}/customers/${customerId}.json`,
      { headers: headers(), cacheTTL: 60 }
    );
    const c = data.customer;
    return {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      email: c.email,
      ordersCount: c.orders_count,
      totalSpent: c.total_spent,
      createdAt: c.created_at,
      tags: c.tags,
      note: c.note,
    };
  });
}

/**
 * Search customers by email or name.
 */
export async function searchCustomers(query: string) {
  return withTokenRefresh(async () => {
    const url = `${base()}/customers/search.json?query=${encodeURIComponent(query)}&limit=10`;
    const data = await apiFetch<{ customers: ShopifyCustomer[] }>(url, {
      headers: headers(),
      cacheTTL: 30,
    });
    return data.customers.map((c) => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      email: c.email,
      ordersCount: c.orders_count,
      totalSpent: c.total_spent,
    }));
  });
}

/**
 * Get recent orders (last N).
 */
export async function getRecentOrders(limit: number = 10) {
  return withTokenRefresh(async () => {
    const url = `${base()}/orders.json?status=any&limit=${limit}`;
    const data = await apiFetch<{ orders: ShopifyOrder[] }>(url, {
      headers: headers(),
      cacheTTL: 30,
    });

    return data.orders.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.created_at,
      totalPrice: o.total_price,
      currency: o.currency,
      financialStatus: o.financial_status,
      fulfillmentStatus: o.fulfillment_status || "unfulfilled",
      customerName: o.customer
        ? `${o.customer.first_name} ${o.customer.last_name}`
        : "Guest",
      itemCount: o.line_items.reduce((s, li) => s + li.quantity, 0),
    }));
  });
}

// ---------- Utility ----------

function countBy<T>(arr: T[], fn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of arr) {
    const key = fn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}
