import { RouteOptimizerMcpServer } from './server';

// Export the Durable Object class for binding
export { RouteOptimizerMcpServer };

/**
 * Worker entrypoint for the Route Optimizer MCP server.
 *
 * Follows the NullShot MCP template pattern:
 * - Uses a Durable Object per session
 * - Routes requests based on `sessionId` query parameter
 */
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let sessionIdStr = url.searchParams.get('sessionId');

    const { ROUTE_OPTIMIZER_MCP_SERVER } = env as {
      ROUTE_OPTIMIZER_MCP_SERVER: DurableObjectNamespace<RouteOptimizerMcpServer>;
    };

    const id = sessionIdStr
      ? ROUTE_OPTIMIZER_MCP_SERVER.idFromString(sessionIdStr)
      : ROUTE_OPTIMIZER_MCP_SERVER.newUniqueId();

    if (!sessionIdStr) {
      sessionIdStr = id.toString();
      url.searchParams.set('sessionId', sessionIdStr);
    }

    return ROUTE_OPTIMIZER_MCP_SERVER.get(id).fetch(
      new Request(url.toString(), request),
    );
  },
};