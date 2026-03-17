import "dotenv/config";

// ============================================================
// Configuration - reads environment variables
// ============================================================

export const config = {
  // Shopify
  shopifyStoreUrl: process.env.SHOPIFY_STORE_URL || "larsson-jennings.myshopify.com",
  shopifyAccessToken: process.env.SHOPIFY_ACCESS_TOKEN || "",

  // Shopify OAuth credentials — used to auto-refresh the access token on 401.
  // Optional: if absent, a 401 will surface as an error instead of auto-refreshing.
  shopifyClientId: process.env.SHOPIFY_CLIENT_ID || "",
  shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET || "",

  // Triple Whale
  tripleWhaleApiKey: process.env.TRIPLE_WHALE_API_KEY || "",

  // Klaviyo
  klaviyoApiKey: process.env.KLAVIYO_API_KEY || "",

  // Server
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // Shopify API version (REST API still works for custom/private apps)
  shopifyApiVersion: "2025-01",

  // Klaviyo API revision
  klaviyoApiRevision: "2026-01-15",
};

export function validateConfig(): string[] {
  const missing: string[] = [];
  if (!config.shopifyAccessToken) missing.push("SHOPIFY_ACCESS_TOKEN");
  if (!config.tripleWhaleApiKey) missing.push("TRIPLE_WHALE_API_KEY");
  if (!config.klaviyoApiKey) missing.push("KLAVIYO_API_KEY");
  return missing;
}
