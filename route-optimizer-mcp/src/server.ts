import { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { McpHonoServerDO } from '@nullshot/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServerTools } from './tools';
import { setupServerResources } from './resources';
import { setupServerPrompts } from './prompts';

/**
 * Environment bindings for the Route Optimizer MCP server.
 */
export interface RouteOptimizerEnv {
  /**
   * thirdweb client ID for the TypeScript SDK.
   */
  THIRDWEB_CLIENT_ID: string;

  /**
   * thirdweb secret key for RPC Edge and HTTP APIs.
   */
  THIRDWEB_SECRET_KEY: string;
}

/**
 * RouteOptimizerMcpServer
 *
 * Provides AI-assisted scoring of thirdweb Bridge routes:
 * - Calls Bridge.Buy.prepare with different maxSteps configurations
 * - Fetches token prices to estimate USD value in/out
 * - Estimates gas costs per step via thirdweb RPC Edge
 * - Produces a ranked list of candidate routes with explanations
 */
export class RouteOptimizerMcpServer extends McpHonoServerDO<RouteOptimizerEnv> {
  constructor(state: DurableObjectState, env: RouteOptimizerEnv) {
    super(state, env);
  }

  getImplementation(): Implementation {
    return {
      name: 'route-optimizer-mcp',
      version: '0.1.0',
    };
  }

  configureServer(server: McpServer): void {
    setupServerTools(server, this.env);
    setupServerResources(server);
    setupServerPrompts(server);
  }
}