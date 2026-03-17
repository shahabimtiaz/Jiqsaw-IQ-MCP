// ============================================================
// LJ MCP Server – Main entry point
// Remote MCP server using Streamable HTTP transport (stateless)
// ============================================================

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { config, validateConfig } from "./config.js";
import { registerShopifyTools } from "./tools/shopify-tools.js";
import { registerTripleWhaleTools } from "./tools/triplewhale-tools.js";
import { registerKlaviyoTools } from "./tools/klaviyo-tools.js";

// ---- Validate configuration ----
const missing = validateConfig();
if (missing.length > 0) {
  console.warn(
    `⚠️  Missing env vars: ${missing.join(", ")}. Some tools may fail.`
  );
}

// ---- Create the MCP server & register all tools ----
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "lj-connector",
    version: "1.0.0",
  });

  // Register tool groups
  if (config.shopifyAccessToken) {
    registerShopifyTools(server);
    console.log("✅ Shopify tools registered");
  } else {
    console.warn("⚠️  Shopify tools skipped (no access token)");
  }

  if (config.tripleWhaleApiKey) {
    registerTripleWhaleTools(server);
    console.log("✅ Triple Whale tools registered");
  } else {
    console.warn("⚠️  Triple Whale tools skipped (no API key)");
  }

  if (config.klaviyoApiKey) {
    registerKlaviyoTools(server);
    console.log("✅ Klaviyo tools registered");
  } else {
    console.warn("⚠️  Klaviyo tools skipped (no API key)");
  }

  return server;
}

// ---- Express app ----
const app = express();
app.set("trust proxy", 1);
// CORS – restrict to Anthropic / Claude origins + local dev
const ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://www.claude.ai",
  "https://app.anthropic.com",
  /^https:\/\/.*\.anthropic\.com$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, health checks)
      if (!origin) return callback(null, true);
      const allowed = ALLOWED_ORIGINS.some((o) =>
        typeof o === "string" ? o === origin : o.test(origin)
      );
      if (allowed) return callback(null, true);
      // In production, block unknown origins; in dev, allow all
      if (config.nodeEnv === "development") return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "mcp-session-id",
      "mcp-protocol-version",
      "Authorization",
    ],
    exposedHeaders: ["mcp-session-id"],
  })
);

// Rate limiting – generous for MCP usage
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120, // 120 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Parse JSON bodies
app.use(express.json());

// ---- Request logging (structured, no sensitive data) ----
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const log = {
      ts: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
      ip: req.ip,
      ...(req.path === "/mcp" && req.body?.method
        ? { mcp_method: req.body.method, mcp_tool: req.body?.params?.name }
        : {}),
    };
    console.log(JSON.stringify(log));
  });
  next();
});

// ---- Health check ----
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "lj-connector",
    version: "1.0.0",
    uptime: process.uptime(),
    integrations: {
      shopify: !!config.shopifyAccessToken,
      tripleWhale: !!config.tripleWhaleApiKey,
      klaviyo: !!config.klaviyoApiKey,
    },
  });
});

// ---- Root info route ----
app.get("/", (_req, res) => {
  res.json({
    name: "Larsson & Jennings MCP Connector",
    version: "1.0.0",
    mcp_endpoint: "/mcp",
    health_endpoint: "/health",
    description:
      "Remote MCP server providing Claude with access to L&J Shopify, Triple Whale, and Klaviyo data.",
  });
});

// ---- MCP Streamable HTTP endpoint (stateless) ----
// Stateless = fresh server + transport per request, no session tracking.
// Each request gets its own McpServer + Transport so internal state never
// leaks between clients (fixes 500 errors on repeated `initialize` calls).

// POST /mcp – all MCP requests come here
app.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close().catch(() => { });
      server.close().catch(() => { });
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] Error handling request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET /mcp – SSE not supported in stateless mode
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: stateless mode" },
    id: null,
  });
});

// DELETE /mcp – no sessions to terminate in stateless mode
app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: stateless mode" },
    id: null,
  });
});

// ---- Start server ----
app.listen(config.port, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║  L&J MCP Server running                       ║
║  Port:     ${String(config.port).padEnd(35)}║
║  Env:      ${config.nodeEnv.padEnd(35)}║
║  MCP URL:  http://localhost:${config.port}/mcp${" ".repeat(Math.max(0, 18 - String(config.port).length))}║
╚════════════════════════════════════════════════╝
  `);
});
