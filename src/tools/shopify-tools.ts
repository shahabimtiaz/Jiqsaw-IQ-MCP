// ============================================================
// Shopify Tools – registered with the MCP server
// ============================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as shopify from "../services/shopify.js";
import {
  validateDateRange,
  validateNumericId,
  validatePositiveInt,
} from "../utils/validation.js";

export function registerShopifyTools(server: McpServer) {
  // 1. Sales Summary
  server.registerTool(
    "get_sales_summary",
    {
      title: "Sales Summary",
      description:
        "Get a summary of Larsson & Jennings Shopify sales for a date range. Returns total orders, revenue, average order value, tax, discounts, and status breakdowns.",
      inputSchema: {
        start_date: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        end_date: z
          .string()
          .describe("End date in YYYY-MM-DD format"),
      },
    },
    async ({ start_date, end_date }) => {
      try {
        const { start, end } = validateDateRange(start_date, end_date);
        const result = await shopify.getSalesSummary(start, end);
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

  // 2. Top Products
  server.registerTool(
    "get_top_products",
    {
      title: "Top Products",
      description:
        "Get the top-selling products by revenue for a given period. Shows rank, title, units sold, and revenue.",
      inputSchema: {
        start_date: z
          .string()
          .describe("Start date in YYYY-MM-DD format"),
        end_date: z
          .string()
          .describe("End date in YYYY-MM-DD format"),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Number of top products to return (default 10)"),
      },
    },
    async ({ start_date, end_date, limit }) => {
      try {
        const { start, end } = validateDateRange(start_date, end_date);
        const safeLimit = validatePositiveInt(limit, "limit", 50);
        const result = await shopify.getTopProducts(start, end, safeLimit);
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

  // 3. Order Details
  server.registerTool(
    "get_order_details",
    {
      title: "Order Details",
      description:
        "Get full details for a specific Shopify order by its order ID (numeric).",
      inputSchema: {
        order_id: z
          .string()
          .describe("The Shopify order ID (numeric, e.g. '5123456789')"),
      },
    },
    async ({ order_id }) => {
      try {
        const safeId = validateNumericId(order_id, "order_id");
        const result = await shopify.getOrderDetails(safeId);
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

  // 4. Inventory Status
  server.registerTool(
    "get_inventory_status",
    {
      title: "Inventory Status",
      description:
        "Get current inventory levels for all products or search by product title. Shows stock quantities, low-stock items, and out-of-stock items.",
      inputSchema: {
        product_title: z
          .string()
          .optional()
          .describe(
            "Optional product title to filter by (partial match)"
          ),
      },
    },
    async ({ product_title }) => {
      try {
        const result = await shopify.getInventoryStatus(product_title);
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

  // 5. Customer Data
  server.registerTool(
    "get_customer_data",
    {
      title: "Customer Details",
      description:
        "Look up a Shopify customer by their customer ID. Returns name, email, order count, total spent, and tags.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("The Shopify customer ID (numeric)"),
      },
    },
    async ({ customer_id }) => {
      try {
        const safeId = validateNumericId(customer_id, "customer_id");
        const result = await shopify.getCustomerData(safeId);
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

  // 6. Search Customers
  server.registerTool(
    "search_customers",
    {
      title: "Search Customers",
      description:
        "Search for Shopify customers by email address or name.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Search query – email address, name, or partial match"
          ),
      },
    },
    async ({ query }) => {
      try {
        if (!query.trim()) {
          throw new Error("Search query cannot be empty.");
        }
        const result = await shopify.searchCustomers(query.trim());
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

  // 7. Recent Orders
  server.registerTool(
    "get_recent_orders",
    {
      title: "Recent Orders",
      description:
        "Get the most recent Shopify orders. Shows order name, total, status, and customer info.",
      inputSchema: {
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Number of recent orders to return (default 10, max 50)"),
      },
    },
    async ({ limit }) => {
      try {
        const safeLimit = validatePositiveInt(limit, "limit", 50);
        const result = await shopify.getRecentOrders(safeLimit);
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
