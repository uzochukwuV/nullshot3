import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Bridge, NATIVE_TOKEN_ADDRESS, createThirdwebClient } from 'thirdweb';
import type { GasOracleEnv } from './server';

/**
 * JSON-RPC call helper for thirdweb RPC Edge.
 */
async function callRpc<T>(
  env: GasOracleEnv,
  chainId: number,
  method: string,
  params: unknown[],
): Promise<T> {
  if (!env.THIRDWEB_SECRET_KEY) {
    throw new Error(
      'THIRDWEB_SECRET_KEY is not configured on Gas Oracle MCP server. Set it to your thirdweb secret key.',
    );
  }

  const url = `https://${chainId}.rpc.thirdweb.com`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-secret-key': env.THIRDWEB_SECRET_KEY,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });

  const json = (await resp.json()) as {
    result?: T;
    error?: { code: number; message: string };
  };

  if (!resp.ok || json.error) {
    throw new Error(
      `RPC call ${method} on chain ${chainId} failed: ${
        json.error ? `${json.error.code} ${json.error.message}` : `HTTP ${resp.status}`
      }`,
    );
  }

  if (json.result === undefined) {
    throw new Error(`RPC call ${method} on chain ${chainId} returned no result`);
  }

  return json.result;
}

/**
 * thirdweb client helper.
 */
function getThirdwebClient(env: GasOracleEnv) {
  if (!env.THIRDWEB_CLIENT_ID) {
    throw new Error('THIRDWEB_CLIENT_ID is not configured on Gas Oracle MCP server.');
  }

  return createThirdwebClient({
    clientId: env.THIRDWEB_CLIENT_ID,
  });
}

/**
 * Convert a hex string (0x...) to bigint.
 */
function hexToBigInt(hex: string): bigint {
  if (!hex.startsWith('0x')) {
    throw new Error(`Invalid hex value: ${hex}`);
  }
  return BigInt(hex);
}

/**
 * Format a bigint with given decimals into a human-readable decimal string.
 */
function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  let v = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const integer = v / base;
  const fraction = v % base;

  if (fraction === 0n) {
    return `${negative ? '-' : ''}${integer.toString()}`;
  }

  const fractionStrRaw = fraction.toString().padStart(decimals, '0');
  const fractionStr = fractionStrRaw.replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer.toString()}.${fractionStr || '0'}`;
}

/**
 * Format wei into gwei string.
 */
function formatGwei(wei: bigint): string {
  const gweiDecimals = 9;
  return formatUnits(wei, gweiDecimals);
}

/**
 * Gas details for a chain.
 */
interface GasDetails {
  chainId: number;
  eip1559: boolean;
  baseFeePerGasWei?: bigint;
  priorityFeePerGasWei?: bigint;
  maxFeePerGasWei?: bigint;
  gasPriceWei: bigint; // Recommended price to use for cost estimations
}

/**
 * Native token metadata + price.
 */
interface NativeTokenInfo {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  priceUsd?: number;
}

/**
 * Try to fetch EIP-1559 style gas data via eth_feeHistory.
 * Falls back to eth_gasPrice if not supported.
 */
async function fetchGasDetails(env: GasOracleEnv, chainId: number): Promise<GasDetails> {
  // Attempt EIP-1559 via eth_feeHistory
  try {
    const feeHistory = await callRpc<{
      baseFeePerGas: string[];
      gasUsedRatio: number[];
      reward?: string[][];
    }>(env, chainId, 'eth_feeHistory', ['5', 'latest', [25, 50, 75]]);

    const baseFees = feeHistory.baseFeePerGas;
    if (!baseFees || baseFees.length === 0) {
      throw new Error('No baseFeePerGas in feeHistory response');
    }

    const latestBaseFeeHex = baseFees[baseFees.length - 1];
    const baseFeePerGasWei = hexToBigInt(latestBaseFeeHex);

    let priorityFeePerGasWei: bigint | undefined;
    if (feeHistory.reward && feeHistory.reward.length > 0) {
      const latestRewards = feeHistory.reward[feeHistory.reward.length - 1];
      if (latestRewards && latestRewards.length > 0) {
        // Use median percentile as a simple priority fee suggestion
        const medianRewardHex = latestRewards[Math.floor(latestRewards.length / 2)];
        priorityFeePerGasWei = hexToBigInt(medianRewardHex);
      }
    }

    // Conservative max fee: baseFee * 2 + priorityFee (if any)
    const maxFeePerGasWei =
      baseFeePerGasWei * 2n + (priorityFeePerGasWei !== undefined ? priorityFeePerGasWei : 0n);

    return {
      chainId,
      eip1559: true,
      baseFeePerGasWei,
      priorityFeePerGasWei,
      maxFeePerGasWei,
      gasPriceWei: maxFeePerGasWei,
    };
  } catch {
    // Fallback: legacy gasPrice
    const gasPriceHex = await callRpc<string>(env, chainId, 'eth_gasPrice', []);
    const gasPriceWei = hexToBigInt(gasPriceHex);

    return {
      chainId,
      eip1559: false,
      gasPriceWei,
    };
  }
}

/**
 * Fetch native token metadata and price using thirdweb Bridge.tokens.
 */
async function fetchNativeTokenInfo(
  env: GasOracleEnv,
  chainId: number,
): Promise<NativeTokenInfo | null> {
  const client = getThirdwebClient(env);

  try {
    const tokens = await Bridge.tokens({
      chainId,
      tokenAddress: NATIVE_TOKEN_ADDRESS,
      client,
    });

    if (!tokens || tokens.length === 0) {
      return null;
    }

    const token = tokens[0];

    return {
      chainId,
      address: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
      priceUsd: token.prices?.USD,
    };
  } catch {
    return null;
  }
}

/**
 * Compute cost metrics for given gas limit and price.
 */
function computeCostMetrics(
  gasLimit: bigint,
  gasPriceWei: bigint,
  nativeToken: NativeTokenInfo | null,
) {
  const costWei = gasLimit * gasPriceWei;
  const result: {
    costWei: string;
    costNativeFormatted?: string;
    costUsdApprox?: number;
  } = {
    costWei: costWei.toString(),
  };

  if (nativeToken) {
    const costNativeStr = formatUnits(costWei, nativeToken.decimals);
    result.costNativeFormatted = `${costNativeStr} ${nativeToken.symbol}`;

    if (nativeToken.priceUsd !== undefined) {
      const costNativeFloat = Number(costWei) / Number(10n ** BigInt(nativeToken.decimals));
      const costUsd = costNativeFloat * nativeToken.priceUsd;
      result.costUsdApprox = Number.isFinite(costUsd) ? Number(costUsd.toFixed(8)) : undefined;
    }
  }

  return result;
}

/**
 * Register gas oracle tools.
 */
export function setupServerTools(server: McpServer, env: GasOracleEnv) {
  /**
   * Get detailed gas pricing information for a single chain.
   */
  server.tool(
    'gas_get_details',
    'Get current gas pricing details for a single EVM chain via thirdweb RPC Edge, including EIP-1559 fields and normalized costs.',
    {
      chainId: z
        .number()
        .describe('EVM chain ID (e.g., 1 for Ethereum, 137 for Polygon, 8453 for Base).'),
      includeNativeTokenPrice: z
        .boolean()
        .optional()
        .describe(
          'Whether to fetch native token metadata and USD price via thirdweb Bridge.tokens (default: true).',
        ),
      referenceGasUnits: z
        .string()
        .optional()
        .describe(
          'Optional reference gas amount as a decimal string (e.g., "21000" or "100000") to compute example costs. Default: 100000.',
        ),
    },
    async ({ chainId, includeNativeTokenPrice, referenceGasUnits }) => {
      const gasDetails = await fetchGasDetails(env, chainId);
      const referenceGas = BigInt(referenceGasUnits ?? '100000');

      let nativeToken: NativeTokenInfo | null = null;
      if (includeNativeTokenPrice !== false) {
        nativeToken = await fetchNativeTokenInfo(env, chainId);
      }

      const costMetrics = computeCostMetrics(referenceGas, gasDetails.gasPriceWei, nativeToken);

      const summary = {
        chainId,
        eip1559: gasDetails.eip1559,
        baseFeePerGasWei: gasDetails.baseFeePerGasWei?.toString(),
        priorityFeePerGasWei: gasDetails.priorityFeePerGasWei?.toString(),
        maxFeePerGasWei: gasDetails.maxFeePerGasWei?.toString(),
        gasPriceWei: gasDetails.gasPriceWei.toString(),
        gasPriceGwei: formatGwei(gasDetails.gasPriceWei),
        referenceGasUnits: referenceGas.toString(),
        referenceCost: costMetrics,
        nativeToken: nativeToken
          ? {
              symbol: nativeToken.symbol,
              decimals: nativeToken.decimals,
              address: nativeToken.address,
              priceUsd: nativeToken.priceUsd,
            }
          : null,
      };

      return {
        content: [
          {
            type: 'text',
            text: `Gas details for chain ${chainId}:\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    },
  );

  /**
   * Estimate gas cost for a transaction on a specific chain.
   */
  server.tool(
    'gas_estimate_cost',
    'Estimate total gas cost (native and USD) for a transaction on a specific chain, using thirdweb RPC Edge and Bridge token pricing.',
    {
      chainId: z.number().describe('EVM chain ID.'),
      gasLimit: z
        .string()
        .regex(/^[0-9]+$/, 'gasLimit must be a decimal integer string.')
        .describe('Gas limit as a decimal string (e.g., "21000" for a basic ETH transfer).'),
      manualGasPriceWei: z
        .string()
        .regex(/^[0-9]+$/, 'manualGasPriceWei must be a decimal integer string.')
        .optional()
        .describe(
          'Optional manual gas price in wei as decimal string. If omitted, a recommended price is fetched.',
        ),
      includeNativeTokenPrice: z
        .boolean()
        .optional()
        .describe(
          'Whether to fetch native token metadata and USD price via thirdweb Bridge.tokens (default: true).',
        ),
    },
    async ({ chainId, gasLimit, manualGasPriceWei, includeNativeTokenPrice }) => {
      const gasDetails = await fetchGasDetails(env, chainId);
      const gasLimitBigInt = BigInt(gasLimit);
      const gasPriceWei =
        manualGasPriceWei !== undefined ? BigInt(manualGasPriceWei) : gasDetails.gasPriceWei;

      let nativeToken: NativeTokenInfo | null = null;
      if (includeNativeTokenPrice !== false) {
        nativeToken = await fetchNativeTokenInfo(env, chainId);
      }

      const costMetrics = computeCostMetrics(gasLimitBigInt, gasPriceWei, nativeToken);

      const summary = {
        chainId,
        gasLimit: gasLimitBigInt.toString(),
        gasPriceWei: gasPriceWei.toString(),
        gasPriceGwei: formatGwei(gasPriceWei),
        totalCostWei: costMetrics.costWei,
        totalCostNativeFormatted: costMetrics.costNativeFormatted,
        totalCostUsdApprox: costMetrics.costUsdApprox,
        nativeToken: nativeToken
          ? {
              symbol: nativeToken.symbol,
              decimals: nativeToken.decimals,
              address: nativeToken.address,
              priceUsd: nativeToken.priceUsd,
            }
          : null,
      };

      return {
        content: [
          {
            type: 'text',
            text: `Estimated gas cost on chain ${chainId}:\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    },
  );

  /**
   * Get a multi-chain gas snapshot, normalized to cost per 100k gas in USD.
   */
  server.tool(
    'gas_multi_chain_snapshot',
    'Get a snapshot of gas prices across multiple chains, including USD cost per 100,000 gas units.',
    {
      chainIds: z
        .array(z.number())
        .min(1)
        .describe('Array of EVM chain IDs to query (e.g., [1, 137, 8453, 42161]).'),
      referenceGasUnits: z
        .string()
        .optional()
        .describe(
          'Optional reference gas amount as decimal string; defaults to 100000 for cost normalization.',
        ),
    },
    async ({ chainIds, referenceGasUnits }) => {
      const referenceGas = BigInt(referenceGasUnits ?? '100000');

      const results = [];
      for (const chainId of chainIds) {
        const gasDetails = await fetchGasDetails(env, chainId);
        const nativeToken = await fetchNativeTokenInfo(env, chainId);
        const costMetrics = computeCostMetrics(referenceGas, gasDetails.gasPriceWei, nativeToken);

        results.push({
          chainId,
          gasPriceWei: gasDetails.gasPriceWei.toString(),
          gasPriceGwei: formatGwei(gasDetails.gasPriceWei),
          eip1559: gasDetails.eip1559,
          nativeToken: nativeToken
            ? {
                symbol: nativeToken.symbol,
                decimals: nativeToken.decimals,
                address: nativeToken.address,
                priceUsd: nativeToken.priceUsd,
              }
            : null,
          referenceGasUnits: referenceGas.toString(),
          costPerReferenceWei: costMetrics.costWei,
          costPerReferenceNativeFormatted: costMetrics.costNativeFormatted,
          costPerReferenceUsdApprox: costMetrics.costUsdApprox,
        });
      }

      // Sort by USD cost if available, falling back to gasPriceGwei
      results.sort((a, b) => {
        const aUsd = a.costPerReferenceUsdApprox ?? Number.POSITIVE_INFINITY;
        const bUsd = b.costPerReferenceUsdApprox ?? Number.POSITIVE_INFINITY;
        return aUsd - bUsd;
      });

      const summary = {
        referenceGasUnits: referenceGas.toString(),
        chains: results,
      };

      return {
        content: [
          {
            type: 'text',
            text: `Multi-chain gas snapshot:\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    },
  );
}