import { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { McpHonoServerDO } from '@nullshot/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServerTools } from './tools';
import { setupServerResources } from './resources';
import { setupServerPrompts } from './prompts';

/**
 * Environment bindings for the Bridge Router MCP server.
 *
 * These should be configured as Cloudflare Worker environment variables
 * when you deploy this MCP server.
 */
export interface BridgeRouterEnv {
  /**
   * thirdweb client ID used for the TypeScript SDK.
   */
  THIRDWEB_CLIENT_ID: string;

  /**
   * thirdweb secret key used for calling HTTP APIs like /v1/bridge/routes.
   */
  THIRDWEB_SECRET_KEY: string;
}

/**
 * BridgeRouterMcpServer
 *
 * MCP server that exposes tools for interacting with thirdweb Bridge:
 * - Discover supported routes
 * - Prepare cross-chain bridge quotes
 * - Fetch bridge status
 * - Query token metadata and prices
 */
export class BridgeRouterMcpServer extends McpHonoServerDO<BridgeRouterEnv> {
  constructor(state: DurableObjectState, env: BridgeRouterEnv) {
    super(state, env);
  }

  getImplementation(): Implementation {
    return {
      name: 'bridge-router-mcp',
      version: '0.1.0',
    };
  }

  configureServer(server: McpServer): void {
    setupServerTools(server, this.env);
    setupServerResources(server);
    setupServerPrompts(server);
  }
}