import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Prompt templates for the Route Optimizer MCP.
 *
 * These help the agent understand how to use the optimizer and interpret its output.
 */
export function setupServerPrompts(server: McpServer) {
  server.prompt(
    'route_optimizer_overview',
    'Overview of how to use the Route Optimizer MCP to choose between bridge routes.',
    () => ({
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: [
              'You are using the Route Optimizer MCP server, which evaluates multiple thirdweb Bridge configurations and scores them.',
              '',
              'The primary tool is `optimize_bridge_route`, which:',
              '- Calls Bridge.Buy.prepare with different maxSteps values (e.g., 1, 2, 3).',
              '- Uses Bridge.tokens to estimate origin and destination token values in USD.',
              '- Uses RPC Edge to estimate gas costs per step, with a heuristic gas limit per transaction.',
              '- Computes net destination value after gas for each candidate and scores them as cheapest, fastest, or balanced.',
              '',
              'When the user asks for the best route:',
              '- Call optimize_bridge_route with the desired origin/destination chains, tokens, and amount.',
              '- Set preference=cheapest for maximum net value after gas.',
              '- Set preference=fastest when latency matters more than cost.',
              '- Use preference=balanced when both matter.',
              '',
              'Always surface:',
              '- The recommended route label (e.g., maxSteps=2).',
              '- Net destination value after gas (approximate USD).',
              '- Estimated execution time and number of steps.',
              '',
              'If multiple routes are close in score, explain the trade-offs clearly to the user.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}