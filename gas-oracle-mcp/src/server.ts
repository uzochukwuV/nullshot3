import { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { McpHonoServerDO } from '@nullshot/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServerTools } from './tools';
import { setupServerResources } from './resources';
import { setupServerPrompts } from './prompts';

/**
 * Environment bindings for the Gas Oracle MCP server.
 */
export interface GasOracleEnv {
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
 * GasOracleMcpServer
 *
 * Provides multi-chain gas pricing and cost estimation utilities
 * on top of thirdweb RPC Edge and Bridge token pricing.
 */
export class GasOracleMcpServer extends McpHonoServerDO<GasOracleEnv> {
  constructor(state: DurableObjectState, env: GasOracleEnv) {
    super(state, env);
  }

  getImplementation(): Implementation {
    return {
      name: 'gas-oracle-mcp',
      version: '0.1.0',
    };
  }

  configureServer(server: McpServer): void {
    setupServerTools(server, this.env);
    setupServerResources(server);
    setupServerPrompts(server);
  }
}