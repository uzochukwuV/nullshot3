import { BridgeRouterMcpServer } from './server';

// Export the Durable Object class for binding
export { BridgeRouterMcpServer };

/**
 * Worker entrypoint for the Bridge Router MCP server.
 *
 * This mirrors the pattern from the NullShot TypeScript MCP template:
 * - Uses a Durable Object per session to host the MCP server
 * - Uses `sessionId` as a stable identifier for tool connections
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let sessionIdStr = url.searchParams.get('sessionId');

    const { BRIDGE_ROUTER_MCP_SERVER } = env as unknown as {
      BRIDGE_ROUTER_MCP_SERVER: DurableObjectNamespace<BridgeRouterMcpServer>;
    };

    const id = sessionIdStr
      ? BRIDGE_ROUTER_MCP_SERVER.idFromString(sessionIdStr)
      : BRIDGE_ROUTER_MCP_SERVER.newUniqueId();

    if (!sessionIdStr) {
      sessionIdStr = id.toString();
      url.searchParams.set('sessionId', sessionIdStr);
    }

    return BRIDGE_ROUTER_MCP_SERVER.get(id).fetch(
      new Request(url.toString(), request),
    );
  },
};