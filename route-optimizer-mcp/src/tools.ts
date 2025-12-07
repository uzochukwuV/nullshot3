import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Bridge, createThirdwebClient } from 'thirdweb';
import type { RouteOptimizerEnv } from './server';

/**
 * Helper: create thirdweb client.
 */
function getThirdwebClient(env: RouteOptimizerEnv) {
  if (!env.THIRDWEB_CLIENT_ID) {
    throw new Error('THIRDWEB_CLIENT_ID is not configured on Route Optimizer MCP server.');
  }

  return createThirdwebClient({
    clientId: env.THIRDWEB_CLIENT_ID,
  });
}

/**
 * Helper: thirdweb RPC Edge JSON-RPC call.
 */
async function callRpc<T>(
  env: RouteOptimizerEnv,
  chainId: number,
  method: string,
  params: unknown[],
): Promise<T> {
  if (!env.THIRDWEB_SECRET_KEY) {
    throw new Error(
      'THIRDWEB_SECRET_KEY is not configured on Route Optimizer MCP server. Set it to your thirdweb secret key.',
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

function hexToBigInt(hex: string): bigint {
  if (!hex.startsWith('0x')) {
    throw new Error(`Invalid hex value: ${hex}`);
  }
  return BigInt(hex);
}

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

function formatGwei(wei: bigint): string {
  return formatUnits(wei, 9);
}

/**
 * Fetch a simple gas price suggestion for a chain using eth_gasPrice.
 * We don't need full EIP-1559 breakdown here, just a reasonable price for cost estimation.
 */
async function fetchGasPriceWei(env: RouteOptimizerEnv, chainId: number): Promise<bigint> {
  const gasPriceHex = await callRpc<string>(env, chainId, 'eth_gasPrice', []);
  return hexToBigInt(gasPriceHex);
}

/**
 * Token metadata + price (USD) via Bridge.tokens.
 */
interface TokenInfo {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  priceUsd?: number;
}

async function fetchTokenInfo(
  env: RouteOptimizerEnv,
  chainId: number,
  tokenAddress: string,
): Promise<TokenInfo | null> {
  const client = getThirdwebClient(env);

  try {
    const tokens = await Bridge.tokens({
      chainId,
      tokenAddress,
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
 * Estimate gas cost for a single transaction on a chain, using a heuristic gas limit.
 */
async function estimateTxGasCostUsd(
  env: RouteOptimizerEnv,
  chainId: number,
  gasLimit: bigint,
): Promise<{
  gasPriceWei: bigint;
  costWei: bigint;
  costUsdApprox?: number;
}> {
  const gasPriceWei = await fetchGasPriceWei(env, chainId);
  const costWei = gasLimit * gasPriceWei;

  // Try to fetch native token price to estimate USD cost.
  const client = getThirdwebClient(env);
  let priceUsd: number | undefined;

  try {
    const tokens = await Bridge.tokens({
      chainId,
      // Native token discovery: omit tokenAddress to get common tokens, and pick first native-like.
      // If that fails, we skip USD estimation.
      client,
    });

    if (tokens && tokens.length > 0) {
      const nativeLike = tokens.find((t) => t.prices?.USD !== undefined) ?? tokens[0];
      priceUsd = nativeLike.prices?.USD;
      const decimals = nativeLike.decimals;
      if (priceUsd !== undefined) {
        const costNativeFloat = Number(costWei) / Number(10n ** BigInt(decimals));
        const usd = costNativeFloat * priceUsd;
        return {
          gasPriceWei,
          costWei,
          costUsdApprox: Number.isFinite(usd) ? Number(usd.toFixed(8)) : undefined,
        };
      }
    }
  } catch {
    // Ignore price failures; costUsdApprox stays undefined.
  }

  return {
    gasPriceWei,
    costWei,
    costUsdApprox: undefined,
  };
}

/**
 * Unified route candidate representation for scoring.
 */
interface RouteCandidateScore {
  label: string;
  maxSteps?: number;
  quote: any;
  originValueUsd?: number;
  destinationValueUsd?: number;
  feeUsd?: number;
  gasUsdApprox?: number;
  netDestinationAfterGasUsd?: number;
  timeMs?: number;
  scoreCheapest?: number;
  scoreFastest?: number;
  scoreBalanced?: number;
}

/**
 * Compute approximate USD value for a token amount.
 */
function computeValueUsd(
  amount: bigint,
  token: TokenInfo | null,
): { valueUsd?: number; formatted?: string } {
  if (!token || token.priceUsd === undefined) {
    return {
      valueUsd: undefined,
      formatted: token
        ? `${formatUnits(amount, token.decimals)} ${token.symbol} (price unknown)`
        : undefined,
    };
  }

  const nativeStr = formatUnits(amount, token.decimals);
  const nativeFloat = Number(amount) / Number(10n ** BigInt(token.decimals));
  const usd = nativeFloat * token.priceUsd;

  return {
    valueUsd: Number.isFinite(usd) ? Number(usd.toFixed(8)) : undefined,
    formatted: `${nativeStr} ${token.symbol} (~$${usd.toFixed(4)})`,
  };
}

/**
 * Register optimization tools.
 */
export function setupServerTools(server: McpServer, env: RouteOptimizerEnv) {
  /**
   * Optimize a bridge route between two chains/tokens for a fixed origin amount.
   *
   * Strategy:
   * - Call Bridge.Buy.prepare multiple times with different maxSteps options (e.g., [1, 2, 3])
   * - For each quote:
   *   - Compute origin and destination USD values using Bridge.tokens prices
   *   - Estimate gas cost across all steps using RPC Edge and a heuristic gas limit per tx
   *   - Compute net destination value after gas and a composite score
   */
  server.tool(
    'optimize_bridge_route',
    'Evaluate multiple thirdweb Bridge route configurations and select the best route based on cost, time, or a balanced score.',
    {
      originChainId: z.number().describe('Origin chain ID.'),
      originTokenAddress: z.string().describe('Origin token contract address.'),
      destinationChainId: z.number().describe('Destination chain ID.'),
      destinationTokenAddress: z.string().describe('Destination token contract address.'),
      amountWei: z
        .string()
        .regex(/^[0-9]+$/, 'amountWei must be an integer string.')
        .describe('Amount in smallest units as a decimal string (e.g. wei).'),
      sender: z.string().describe('Sender address on the origin chain.'),
      receiver: z
        .string()
        .describe('Receiver address on the destination chain (can be same as sender).'),
      maxStepsOptions: z
        .array(z.number())
        .min(1)
        .optional()
        .describe(
          'List of maxSteps values to evaluate (e.g., [1, 2, 3]). Defaults to [1, 2, 3].',
        ),
      preference: z
        .enum(['cheapest', 'fastest', 'balanced'])
        .optional()
        .describe('Optimization preference: cheapest, fastest, or balanced (default: balanced).'),
      heuristicGasPerTransaction: z
        .string()
        .optional()
        .describe(
          'Heuristic gas units per transaction as decimal string (default: 200000). Used to estimate gas cost per step.',
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
      maxStepsOptions,
      preference,
      heuristicGasPerTransaction,
    }) => {
      const client = getThirdwebClient(env);
      const amount = BigInt(amountWei);
      const maxStepsList = maxStepsOptions && maxStepsOptions.length > 0 ? maxStepsOptions : [1, 2, 3];
      const gasPerTx = BigInt(heuristicGasPerTransaction ?? '200000');

      // Fetch token metadata + price once
      const [originToken, destToken] = await Promise.all([
        fetchTokenInfo(env, originChainId, originTokenAddress),
        fetchTokenInfo(env, destinationChainId, destinationTokenAddress),
      ]);

      const originValueInfo = computeValueUsd(amount, originToken);
      const candidates: RouteCandidateScore[] = [];

      for (const stepsOption of maxStepsList) {
        try {
          const quote = await Bridge.Buy.prepare({
            originChainId,
            originTokenAddress,
            destinationChainId,
            destinationTokenAddress,
            amount,
            sender,
            receiver,
            maxSteps: stepsOption,
            client,
          });

          // Value in/out in USD
          const destValueInfo = computeValueUsd(quote.destinationAmount, destToken);

          let feeUsd: number | undefined;
          if (originValueInfo.valueUsd !== undefined && destValueInfo.valueUsd !== undefined) {
            feeUsd = Number(
              (originValueInfo.valueUsd - destValueInfo.valueUsd).toFixed(8),
            );
          }

          // Gas estimate: sum across all steps, each step may involve one or more transactions on a chain.
          let totalGasUsdApprox = 0;
          let anyGasUsdKnown = false;

          for (const step of quote.steps) {
            for (const tx of step.transactions) {
              const chainIdForTx = tx.chainId ?? originChainId;
              const gasCost = await estimateTxGasCostUsd(env, chainIdForTx, gasPerTx);
              if (gasCost.costUsdApprox !== undefined) {
                totalGasUsdApprox += gasCost.costUsdApprox;
                anyGasUsdKnown = true;
              }
            }
          }

          const gasUsdApprox = anyGasUsdKnown ? Number(totalGasUsdApprox.toFixed(8)) : undefined;

          let netDestinationAfterGasUsd: number | undefined;
          if (destValueInfo.valueUsd !== undefined && gasUsdApprox !== undefined) {
            netDestinationAfterGasUsd = Number(
              (destValueInfo.valueUsd - gasUsdApprox).toFixed(8),
            );
          }

          const timeMs = quote.estimatedExecutionTimeMs;
          const candidate: RouteCandidateScore = {
            label: `maxSteps=${stepsOption}`,
            maxSteps: stepsOption,
            quote,
            originValueUsd: originValueInfo.valueUsd,
            destinationValueUsd: destValueInfo.valueUsd,
            feeUsd,
            gasUsdApprox,
            netDestinationAfterGasUsd,
            timeMs,
          };

          candidates.push(candidate);
        } catch (error) {
          // Skip failing configuration; continue with others.
          // We do not treat this as fatal for the overall optimization.
          console.warn(
            `Bridge.Buy.prepare failed for maxSteps=${stepsOption}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      if (candidates.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No valid bridge routes could be prepared for the given parameters.',
            },
          ],
        };
      }

      // Scoring
      const pref = preference ?? 'balanced';

      // Normalize metrics for scoring: we build relative scores per candidate.
      const validNetValues = candidates
        .map((c, i) => ({ i, v: c.netDestinationAfterGasUsd }))
        .filter((x) => x.v !== undefined) as { i: number; v: number }[];
      const validTimes = candidates
        .map((c, i) => ({ i, v: c.timeMs }))
        .filter((x) => x.v !== undefined) as { i: number; v: number }[];

      if (validNetValues.length > 0) {
        const maxValue = Math.max(...validNetValues.map((x) => x.v));
        const minValue = Math.min(...validNetValues.map((x) => x.v));
        const range = maxValue - minValue || 1e-9;
        for (const { i, v } of validNetValues) {
          // Higher netDestinationAfterGasUsd is better; normalize 0-1
          candidates[i].scoreCheapest = (v - minValue) / range;
        }
      }

      if (validTimes.length > 0) {
        const maxTime = Math.max(...validTimes.map((x) => x.v!));
        const minTime = Math.min(...validTimes.map((x) => x.v!));
        const range = maxTime - minTime || 1e-9;
        for (const { i, v } of validTimes) {
          // Lower time is better; normalize 0-1
          candidates[i].scoreFastest = 1 - (v! - minTime) / range;
        }
      }

      for (const c of candidates) {
        const cheap = c.scoreCheapest ?? 0;
        const fast = c.scoreFastest ?? 0;
        // Balanced: 70% weight on cheapest, 30% on fastest
        c.scoreBalanced = 0.7 * cheap + 0.3 * fast;
      }

      // Choose recommended index according to preference
      const scoreKey =
        pref === 'cheapest'
          ? 'scoreCheapest'
          : pref === 'fastest'
          ? 'scoreFastest'
          : 'scoreBalanced';

      let recommendedIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const s = (candidates[i] as any)[scoreKey] as number | undefined;
        if (s !== undefined && s > bestScore) {
          bestScore = s;
          recommendedIndex = i;
        }
      }

      const recommended = candidates[recommendedIndex];

      const explanation = {
        preference: pref,
        recommendedLabel: recommended.label,
        recommendedIndex,
        rationale: {
          netDestinationAfterGasUsd: recommended.netDestinationAfterGasUsd,
          destinationValueUsd: recommended.destinationValueUsd,
          gasUsdApprox: recommended.gasUsdApprox,
          estimatedExecutionTimeMs: recommended.timeMs,
          scores: {
            cheapest: recommended.scoreCheapest,
            fastest: recommended.scoreFastest,
            balanced: recommended.scoreBalanced,
          },
        },
      };

      const response = {
        origin: {
          chainId: originChainId,
          tokenAddress: originTokenAddress,
          amountWei: amountWei,
          valueUsdApprox: originValueInfo.valueUsd,
        },
        destination: {
          chainId: destinationChainId,
          tokenAddress: destinationTokenAddress,
        },
        candidates: candidates.map((c) => ({
          label: c.label,
          maxSteps: c.maxSteps,
          originValueUsd: c.originValueUsd,
          destinationValueUsd: c.destinationValueUsd,
          feeUsd: c.feeUsd,
          gasUsdApprox: c.gasUsdApprox,
          netDestinationAfterGasUsd: c.netDestinationAfterGasUsd,
          estimatedExecutionTimeMs: c.timeMs,
          scores: {
            cheapest: c.scoreCheapest,
            fastest: c.scoreFastest,
            balanced: c.scoreBalanced,
          },
        })),
        recommendedIndex,
        explanation,
      };

      return {
        content: [
          {
            type: 'text',
            text: `Route optimization result:\n${JSON.stringify(response, null, 2)}`,
          },
        ],
      };
    },
  );
}