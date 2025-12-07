import { GasOracleMcpServer } from './server';

// Export the Durable Object class for binding
export { GasOracleMcpServer };

/**
 * Worker entrypoint for the Gas Oracle MCP server.
 *
 * Mirrors the NullShot TypeScript MCP template pattern:
 * - Uses a Durable Object per session
 * - Routes requests based on `sessionId` query parameter
 */
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let sessionIdStr = url.searchParams.get('sessionId');

    const { GAS_ORACLE_MCP_SERVER } = env as {
      GAS_ORACLE_MCP_SERVER: DurableObjectNamespace<GasOracleMcpServer>;
    };

    const id = sessionIdStr
      ? GAS_ORACLE_MCP_SERVER.idFromString(sessionIdStr)
      : GAS_ORACLE_MCP_SERVER.newUniqueId();

    if (!sessionIdStr) {
      sessionIdStr = id.toString();
      url.searchParams.set('sessionId', sessionIdStr);
    }

    return GAS_ORACLE_MCP_SERVER.get(id).fetch(
      new Request(url.toString(), request),
    );
  },
};