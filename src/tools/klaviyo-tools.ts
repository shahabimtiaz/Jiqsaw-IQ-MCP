// ============================================================
// Klaviyo Tools – registered with the MCP server
// ============================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as klaviyo from "../services/klaviyo.js";
import { validateDateRange, validateStringId } from "../utils/validation.js";

export function registerKlaviyoTools(server: McpServer) {
  // 1. List Campaigns
  server.registerTool(
    "get_email_campaigns",
    {
      title: "Email Campaigns (Klaviyo)",
      description:
        "Get a list of recent Klaviyo email/SMS campaigns. Shows name, status, channel, and dates.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await klaviyo.getCampaigns();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // 2. Campaign Performance
  server.registerTool(
    "get_campaign_performance",
    {
      title: "Campaign Performance (Klaviyo)",
      description:
        "Get performance metrics (opens, clicks, revenue, etc.) for a specific Klaviyo campaign by its ID.",
      inputSchema: {
        campaign_id: z
          .string()
          .describe("The Klaviyo campaign ID"),
      },
    },
    async ({ campaign_id }) => {
      try {
        const safeId = validateStringId(campaign_id, "campaign_id");
        const result = await klaviyo.getCampaignPerformance(safeId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // 3. Flows
  server.registerTool(
    "get_email_flows",
    {
      title: "Email Flows (Klaviyo)",
      description:
        "Get all Klaviyo automated flows (welcome series, abandoned cart, post-purchase, etc.). Shows name, status, and trigger type.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await klaviyo.getFlows();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // 4. Lists
  server.registerTool(
    "get_subscriber_lists",
    {
      title: "Subscriber Lists (Klaviyo)",
      description:
        "Get all Klaviyo subscriber lists.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await klaviyo.getLists();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // 5. Subscriber Count (via segments)
  server.registerTool(
    "get_subscriber_count",
    {
      title: "Subscriber Count (Klaviyo)",
      description:
        "Get subscriber/profile counts from Klaviyo segments. Returns all segments with their profile counts, giving you total subscriber numbers and audience sizes.",
      inputSchema: {},
    },
    async () => {
      try {
        const segments = await klaviyo.getSegments();
        const totalProfiles = segments.reduce(
          (sum, s) => sum + (s.profileCount || 0),
          0
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  totalProfilesAcrossSegments: totalProfiles,
                  note: "Total is sum across all segments. Individual profiles may appear in multiple segments.",
                  segments: segments.map((s) => ({
                    name: s.name,
                    profileCount: s.profileCount ?? "unknown",
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // 6. Segments
  server.registerTool(
    "get_segments",
    {
      title: "Segments (Klaviyo)",
      description:
        "Get all Klaviyo segments with their profile counts. Useful for understanding audience sizes.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await klaviyo.getSegments();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // 7. Metrics list
  server.registerTool(
    "get_klaviyo_metrics",
    {
      title: "Available Metrics (Klaviyo)",
      description:
        "List all available metrics (event types) in the Klaviyo account. Use this to find metric IDs for querying aggregate data.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await klaviyo.getMetrics();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // 8. Query Metric Aggregates
  server.registerTool(
    "query_klaviyo_metric",
    {
      title: "Query Metric Data (Klaviyo)",
      description:
        "Query aggregate data for a specific Klaviyo metric (e.g., 'Placed Order', 'Opened Email') over a date range. You need the metric ID from get_klaviyo_metrics.",
      inputSchema: {
        metric_id: z
          .string()
          .describe("The Klaviyo metric ID"),
        start_date: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        end_date: z
          .string()
          .describe("End date in YYYY-MM-DD format"),
      },
    },
    async ({ metric_id, start_date, end_date }) => {
      try {
        const safeId = validateStringId(metric_id, "metric_id");
        const { start, end } = validateDateRange(start_date, end_date);
        const result = await klaviyo.queryMetricAggregates(safeId, start, end);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}
