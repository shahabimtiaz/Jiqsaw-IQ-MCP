// ============================================================
// Klaviyo API service (revision set in config.ts)
// Auth: Authorization: Klaviyo-API-Key <private_key>
// ============================================================

import { config } from "../config.js";
import { apiFetch } from "./http.js";

const BASE = "https://a.klaviyo.com/api";

const headers = () => ({
  Authorization: `Klaviyo-API-Key ${config.klaviyoApiKey}`,
  revision: config.klaviyoApiRevision,
  Accept: "application/json",
});

// ---------- Campaigns ----------

/**
 * List campaigns across all channels (email + SMS).
 * Revision 2026-01-15 requires an explicit channel filter — fetch both
 * channels separately and merge into a single list sorted by updated_at.
 */
export async function getCampaigns() {
  const fetchChannel = (channel: "email" | "sms") =>
    apiFetch<{ data: KlaviyoCampaign[] }>(
      `${BASE}/campaigns?sort=-updated_at&filter=equals(messages.channel,"${channel}")`,
      { headers: headers(), cacheTTL: 120 }
    );

  const [emailRes, smsRes] = await Promise.all([
    fetchChannel("email"),
    fetchChannel("sms"),
  ]);

  const all = [...emailRes.data, ...smsRes.data].sort(
    (a, b) =>
      new Date(b.attributes.updated_at).getTime() -
      new Date(a.attributes.updated_at).getTime()
  );

  return all.map((c) => ({
    id: c.id,
    name: c.attributes.name,
    status: c.attributes.status,
    channel: c.attributes.send_strategy?.channel || "email",
    createdAt: c.attributes.created_at,
    updatedAt: c.attributes.updated_at,
    scheduledAt: c.attributes.scheduled_at,
    sendTime: c.attributes.send_time,
  }));
}

/**
 * Get performance metrics for a specific campaign using the Reporting API.
 * conversion_metric_id must be a real Klaviyo metric ID — look up "Placed Order"
 * dynamically so this works across any account without hardcoding.
 */
export async function getCampaignPerformance(campaignId: string) {
  try {
    // Look up the Placed Order metric ID for this account (cached 10 min).
    const metricsData = await apiFetch<{ data: KlaviyoMetric[] }>(
      `${BASE}/metrics`,
      { headers: headers(), cacheTTL: 600 }
    );
    const placedOrderMetric = metricsData.data.find(
      (m) => m.attributes.name === "Placed Order"
    );
    if (!placedOrderMetric) {
      return {
        campaignId,
        error: "Could not find 'Placed Order' metric in this Klaviyo account.",
      };
    }

    const data = await apiFetch<Record<string, unknown>>(
      `${BASE}/campaign-values-reports`,
      {
        method: "POST",
        headers: headers(),
        body: {
          data: {
            type: "campaign-values-report",
            attributes: {
              timeframe: { key: "last_12_months" },
              conversion_metric_id: placedOrderMetric.id,
              statistics: [
                "recipients",
                "delivered",
                "opens",
                "open_rate",
                "clicks",
                "click_rate",
                "unsubscribes",
                "bounced",
                "spam_complaints",
                "conversion_value",
              ],
              filter: `equals(campaign_id,"${campaignId}")`,
            },
          },
        },
        cacheTTL: 120,
      }
    );
    return { campaignId, performance: data };
  } catch (err) {
    return {
      campaignId,
      error: `Failed to get campaign performance: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------- Flows ----------

/**
 * Get flows (automated email sequences).
 */
export async function getFlows() {
  const data = await apiFetch<{ data: KlaviyoFlow[] }>(
    `${BASE}/flows?sort=-updated`,
    { headers: headers(), cacheTTL: 180 }
  );

  return data.data.map((f) => ({
    id: f.id,
    name: f.attributes.name,
    status: f.attributes.status,
    createdAt: f.attributes.created,
    updatedAt: f.attributes.updated,
    triggerType: f.attributes.trigger_type,
  }));
}

// ---------- Lists & Segments ----------

/**
 * Get all lists with profile counts.
 * profile_count is requested explicitly via the fields sparse fieldset parameter.
 */
export async function getLists() {
  const data = await apiFetch<{ data: KlaviyoList[] }>(
    `${BASE}/lists?fields[list]=name,created,updated,profile_count`,
    { headers: headers(), cacheTTL: 300 }
  );

  return data.data.map((l) => ({
    id: l.id,
    name: l.attributes.name,
    createdAt: l.attributes.created,
    updatedAt: l.attributes.updated,
    profileCount: l.attributes.profile_count ?? null,
  }));
}

/**
 * Get segments with profile counts.
 * profile_count is requested explicitly via the fields sparse fieldset parameter.
 */
export async function getSegments() {
  const data = await apiFetch<{ data: KlaviyoSegment[] }>(
    `${BASE}/segments?fields[segment]=name,created,updated,profile_count`,
    { headers: headers(), cacheTTL: 300 }
  );

  return data.data.map((s) => ({
    id: s.id,
    name: s.attributes.name,
    createdAt: s.attributes.created,
    updatedAt: s.attributes.updated,
    profileCount: s.attributes.profile_count,
  }));
}

// ---------- Metrics ----------

/**
 * Get all metrics (event types) in the account.
 */
export async function getMetrics() {
  const data = await apiFetch<{ data: KlaviyoMetric[] }>(
    `${BASE}/metrics`,
    { headers: headers(), cacheTTL: 600 }
  );

  return data.data.map((m) => ({
    id: m.id,
    name: m.attributes.name,
    integration: m.attributes.integration?.name || "unknown",
  }));
}

/**
 * Query aggregate metric data for a metric by name.
 */
export async function queryMetricAggregates(
  metricId: string,
  startDate: string,
  endDate: string
) {
  try {
    const data = await apiFetch<Record<string, unknown>>(
      `${BASE}/metric-aggregates`,
      {
        method: "POST",
        headers: headers(),
        body: {
          data: {
            type: "metric-aggregate",
            attributes: {
              metric_id: metricId,
              measurements: ["count", "sum_value", "unique"],
              filter: [
                `greater-or-equal(datetime,${startDate}T00:00:00)`,
                `less-than(datetime,${endDate}T23:59:59)`,
              ],
              interval: "day",
              page_size: 500,
            },
          },
        },
        cacheTTL: 120,
      }
    );
    return { metricId, period: { start: startDate, end: endDate }, data };
  } catch (err) {
    return {
      metricId,
      error: `Metric query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------- Minimal Type Definitions ----------

interface KlaviyoCampaign {
  id: string;
  attributes: {
    name: string;
    status: string;
    send_strategy?: { channel?: string };
    created_at: string;
    updated_at: string;
    scheduled_at?: string;
    send_time?: string;
  };
}

interface KlaviyoFlow {
  id: string;
  attributes: {
    name: string;
    status: string;
    created: string;
    updated: string;
    trigger_type: string;
  };
}

interface KlaviyoList {
  id: string;
  attributes: {
    name: string;
    created: string;
    updated: string;
    profile_count?: number;
  };
}

interface KlaviyoSegment {
  id: string;
  attributes: {
    name: string;
    created: string;
    updated: string;
    profile_count?: number;
  };
}

interface KlaviyoMetric {
  id: string;
  attributes: {
    name: string;
    integration?: { name: string };
  };
}
