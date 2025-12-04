import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Prompt templates for the Gas Oracle MCP.
 *
 * These are optional but useful for giving the agent context on how to
 * interpret and use gas pricing information across chains.
 */
export function setupServerPrompts(server: McpServer) {
  server.prompt(
    'gas_oracle_overview',
    'Overview of how to use the Gas Oracle MCP for multi-chain gas and cost reasoning.',
    () => ({
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: [
              'You are using the Gas Oracle MCP server, which provides multi-chain gas pricing and cost estimation tools on top of thirdweb RPC Edge.',
              '',
              'Use these tools to:',
              '- Fetch detailed gas pricing information for a single chain, including EIP-1559 fields when available.',
              '- Estimate gas cost for a given gas limit in native token units and approximate USD.',
              '- Compare gas prices across multiple chains using normalized cost per 100,000 gas units.',
              '',
              'Guidelines:',
              '- For high-level “where is gas cheapest?” questions, call gas_multi_chain_snapshot with the relevant chain IDs.',
              '- For “how much will this transaction cost?” questions, call gas_estimate_cost with an appropriate gasLimit.',
              '- Always surface both native token cost (e.g., ETH) and approximate USD cost when available.',
              '- When combining with bridge routing, factor in both bridge fees (from bridge_router_mcp) and gas cost (from gas-oracle-mcp).',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}