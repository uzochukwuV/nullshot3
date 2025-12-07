import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Optional prompt templates for the Bridge Router MCP.
 *
 * These can be used by tools or higher-level agents to prime behavior.
 * For now, we expose a single descriptive prompt that explains how
 * to think about cross-chain routing using thirdweb Bridge.
 */
export function setupServerPrompts(server: McpServer) {
  server.prompt(
    'bridge_router_overview',
    'High-level description of how to use the Bridge Router MCP tools for cross-chain routing.',
    () => ({
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: [
              'You are using the Bridge Router MCP server, which exposes tools for interacting with thirdweb Bridge.',
              '',
              'Use these tools to:',
              '- Discover supported bridge routes between chains.',
              '- Prepare cross-chain bridge quotes and transactions with Bridge.Buy.prepare.',
              '- Check the status of in-flight bridge transactions with Bridge.status.',
              '- Query token metadata and prices via Bridge.tokens.',
              '',
              'Always:',
              '- Convert human-readable amounts into smallest units (wei/decimals) before calling bridge_prepare_quote.',
              '- Verify token addresses using bridge_get_token or bridge_search_tokens when possible.',
              '- Consider maxSteps and gas costs when comparing multiple routes.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}