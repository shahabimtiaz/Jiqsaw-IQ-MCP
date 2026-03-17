import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config, validateConfig } from "./config.js";
import { registerShopifyTools } from "./tools/shopify-tools.js";
import { registerTripleWhaleTools } from "./tools/triplewhale-tools.js";
import { registerKlaviyoTools } from "./tools/klaviyo-tools.js";

// ---- Validate configuration ----
const missing = validateConfig();
if (missing.length > 0) {
    console.error(
        `⚠️  Missing env vars: ${missing.join(", ")}. Some tools may fail.`
    );
}

// ---- Create the MCP server & register all tools ----
async function runServer() {
    const server = new McpServer({
        name: "lj-connector",
        version: "1.0.0",
    });

    // Register tool groups
    if (config.shopifyAccessToken) {
        registerShopifyTools(server);
    }

    if (config.tripleWhaleApiKey) {
        registerTripleWhaleTools(server);
    }

    if (config.klaviyoApiKey) {
        registerKlaviyoTools(server);
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("LJ MCP Server running on stdio");
}

runServer().catch((err) => {
    console.error("Fatal error running server:", err);
    process.exit(1);
});
