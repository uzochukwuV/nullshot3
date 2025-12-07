import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Bridge, createThirdwebClient } from 'thirdweb';
import type { BridgeRouterEnv } from './server';

/**
 * Helper to create a thirdweb client from the MCP environment.
 */
function getThirdwebClient(env: BridgeRouterEnv) {
  if (!env.THIRDWEB_CLIENT_ID) {
    throw new Error('THIRDWEB_CLIENT_ID is not configured on Bridge Router MCP server.');
  }

  return createThirdwebClient({
    clientId: env.THIRDWEB_CLIENT_ID,
  });
}

/**
 * Helper to call the thirdweb Bridge Routes HTTP API.
 */
async function fetchBridgeRoutes(
  env: BridgeRouterEnv,
  params: {
    originChainId?: number;
    destinationChainId?: number;
    originTokenAddress?: string;
    maxSteps?: number;
    limit?: number;
    page?: number;
  },
) {
  if (!env.THIRDWEB_SECRET_KEY) {
    throw new Error('THIRDWEB_SECRET_KEY is not configured on Bridge Router MCP server.');
  }

  const search = new URLSearchParams();

  if (params.originChainId !== undefined) {
    search.set('originChainId', params.originChainId.toString());
  }
  if (params.destinationChainId !== undefined) {
    search.set('destinationChainId', params.destinationChainId.toString());
  }
  if (params.originTokenAddress) {
    search.set('originTokenAddress', params.originTokenAddress);
  }
  if (params.maxSteps !== undefined) {
    search.set('maxSteps', params.maxSteps.toString());
  }
  search.set('limit', (params.limit ?? 10).toString());
  search.set('page', (params.page ?? 1).toString());

  const resp = await fetch(`https://api.thirdweb.com/v1/bridge/routes?${search.toString()}`, {
    method: 'GET',
    headers: {
      'x-secret-key': env.THIRDWEB_SECRET_KEY,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to fetch bridge routes: HTTP ${resp.status} - ${text}`);
  }

  return resp.json();
}

/**
 * Convert bigint fields to strings so the result can be safely JSON-stringified.
 */
function normalizeBigIntValues(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeBigIntValues);
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = normalizeBigIntValues(value);
    }
    return result;
  }
  return obj;
}

/**
 * Register tools for the Bridge Router MCP server.
 */
export function setupServerTools(server: McpServer, env: BridgeRouterEnv) {
  /**
   * List supported bridge routes via the thirdweb Bridge Routes HTTP API.
   */
  server.tool(
    'bridge_get_routes',
    'List supported thirdweb bridge routes with optional filters and pagination.',
    {
      originChainId: z
        .number()
        .optional()
        .describe('Optional origin EVM chain ID (e.g., 1 for Ethereum, 137 for Polygon).'),
      destinationChainId: z
        .number()
        .optional()
        .describe('Optional destination EVM chain ID (e.g., 8453 for Base).'),
      originTokenAddress: z
        .string()
        .optional()
        .describe('Optional origin token contract address to filter routes.'),
      maxSteps: z
        .number()
        .optional()
        .describe(
          'Maximum number of steps in the route (1 for single-hop, 2 for up to 2 hops, etc.).',
        ),
      limit: z
        .number()
        .optional()
        .describe('Number of routes per page (default 10).'),
      page: z
        .number()
        .optional()
        .describe('Page number for pagination (default 1).'),
    },
    async ({ originChainId, destinationChainId, originTokenAddress, maxSteps, limit, page }) => {
      const data = await fetchBridgeRoutes(env, {
        originChainId,
        destinationChainId,
        originTokenAddress,
        maxSteps,
        limit,
        page,
      });

      const routes = (data as any)?.result?.routes ?? [];
      const pagination = (data as any)?.result?.pagination ?? {};

      return {
        content: [
          {
            type: 'text',
            text: `Fetched ${routes.length} routes (page ${pagination.page ?? page ?? 1}).`,
          },
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  /**
   * Prepare a finalized bridge quote and transactions using Bridge.Buy.prepare.
   *
   * Note: amountWei should be specified in the token's smallest units (e.g., wei for ETH, 6-decimal units for USDC).
   */
  server.tool(
    'bridge_prepare_quote',
    'Prepare a finalized thirdweb Bridge quote (with transactions) for a specific cross-chain transfer.',
    {
      originChainId: z.number().describe('Origin chain ID.'),
      originTokenAddress: z.string().describe('Origin token contract address.'),
      destinationChainId: z.number().describe('Destination chain ID.'),
      destinationTokenAddress: z.string().describe('Destination token contract address.'),
      amountWei: z
        .string()
        .regex(/^[0-9]+$/, 'amountWei must be an integer string.')
        .describe('Amount in smallest units as a decimal string (e.g., wei).'),
      sender: z.string().describe('Sender address on the origin chain.'),
      receiver: z
        .string()
        .describe('Receiver address on the destination chain (can be same as sender).'),
      maxSteps: z
        .number()
        .optional()
        .describe('Optional maximum number of route steps to allow.'),
      slippageToleranceBps: z
        .number()
        .int()
        .optional()
        .describe(
          'Optional slippage tolerance in basis points (e.g., 100 = 1%). If omitted, thirdweb will use its default.',
        ),
    },
    async ({
      originChainId,
      originTokenAddress,
      destinationChainId,
      destinationTokenAddress,
      amountWei,
      sender,
      receiver,
      maxSteps,
      slippageToleranceBps,
    }) => {
      const client = getThirdwebClient(env);
      const amount = BigInt(amountWei);

      const quote = await Bridge.Buy.prepare({
        originChainId,
        originTokenAddress,
        destinationChainId,
        destinationTokenAddress,
        amount,
        sender,
        receiver,
        ...(maxSteps !== undefined ? { maxSteps } : {}),
        ...(slippageToleranceBps !== undefined ? { slippageToleranceBps } : {}),
        client,
      });

      const normalized = normalizeBigIntValues(quote);

      const summary = {
        originChainId: quote.intent.originChainId,
        originTokenAddress: quote.intent.originTokenAddress,
        destinationChainId: quote.intent.destinationChainId,
        destinationTokenAddress: quote.intent.destinationTokenAddress,
        originAmount: quote.originAmount.toString(),
        destinationAmount: quote.destinationAmount.toString(),
        estimatedExecutionTimeMs: quote.estimatedExecutionTimeMs,
        expiration: quote.expiration,
        stepsCount: quote.steps.length,
      };

      return {
        content: [
          {
            type: 'text',
            text: `Prepared bridge quote:\n${JSON.stringify(summary, null, 2)}`,
          },
          {
            type: 'text',
            text: JSON.stringify(normalized, null, 2),
          },
        ],
      };
    },
  );

  /**
   * Get the status of a bridge transaction using Bridge.status.
   */
  server.tool(
    'bridge_get_status',
    'Get the status of a thirdweb Bridge transaction by origin transaction hash.',
    {
      transactionHash: z.string().describe('Origin chain transaction hash.'),
      chainId: z.number().describe('Origin chain ID where the transaction was sent.'),
    },
    async ({ transactionHash, chainId }) => {
      const client = getThirdwebClient(env);

      const status = await Bridge.status({
        transactionHash,
        chainId,
        client,
      });

      const normalized = normalizeBigIntValues(status);

      return {
        content: [
          {
            type: 'text',
            text: `Bridge status: ${JSON.stringify(normalized, null, 2)}`,
          },
        ],
      };
    },
  );

  /**
   * Fetch metadata and price for a specific token via Bridge.tokens.
   */
  server.tool(
    'bridge_get_token',
    'Get metadata and price information for a specific token on a given chain.',
    {
      chainId: z.number().describe('Chain ID of the token.'),
      tokenAddress: z.string().describe('Token contract address.'),
    },
    async ({ chainId, tokenAddress }) => {
      const client = getThirdwebClient(env);

      const tokens = await Bridge.tokens({
        chainId,
        tokenAddress,
        client,
      });

      if (!tokens || tokens.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No token found for chainId=${chainId}, tokenAddress=${tokenAddress}.`,
            },
          ],
        };
      }

      const token = tokens[0];

      return {
        content: [
          {
            type: 'text',
            text: `Token info:\n${JSON.stringify(token, null, 2)}`,
          },
        ],
      };
    },
  );

  /**
   * Search for tokens by symbol or name across chains using Bridge.tokens.
   */
  server.tool(
    'bridge_search_tokens',
    'Search for tokens by symbol or name across chains using thirdweb Bridge.tokens.',
    {
      symbol: z
        .string()
        .optional()
        .describe('Token symbol to filter by (e.g., USDC).'),
      name: z
        .string()
        .optional()
        .describe('Token name to filter by (e.g., USD Coin).'),
      chainId: z
        .number()
        .optional()
        .describe('Optional chain ID to restrict search to a single chain.'),
      limit: z
        .number()
        .optional()
        .describe('Number of tokens to return (default 50).'),
      offset: z
        .number()
        .optional()
        .describe('Offset for pagination (default 0).'),
    },
    async ({ symbol, name, chainId, limit, offset }) => {
      const client = getThirdwebClient(env);

      const tokens = await Bridge.tokens({
        ...(symbol ? { symbol } : {}),
        ...(name ? { name } : {}),
        ...(chainId !== undefined ? { chainId } : {}),
        limit: limit ?? 50,
        offset: offset ?? 0,
        client,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Found ${tokens.length} tokens.\n${JSON.stringify(tokens, null, 2)}`,
          },
        ],
      };
    },
  );
}