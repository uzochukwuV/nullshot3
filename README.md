# Agent Starter Template

A Cloudflare Workers-based conversational AI agent template built with Hono, AI SDK v5, and the Nullshot Agent SDK. This template provides a production-ready foundation for building scalable AI agents that can handle multiple concurrent conversations with session management.

## Features

- 🚀 **Cloudflare Workers**: Serverless deployment with global edge distribution
- 🧠 **AI SDK v5 Integration**: Powered by Vercel's AI SDK with multi-provider support (Anthropic, OpenAI, etc.)
- 💬 **Session Management**: Persistent conversations using Cloudflare Durable Objects
- 🔄 **Streaming Responses**: Real-time response streaming with tool call streaming support
- 🌐 **CORS Enabled**: Ready for web applications with proper CORS configuration
- 🛠️ **MCP Tools Ready**: Extensible with Model Context Protocol (MCP) tools
- 📦 **TypeScript**: Full type safety and excellent developer experience
- ⚡ **Multi-Step Reasoning**: Support for complex reasoning workflows with maxSteps configuration

## Architecture

The agent uses Cloudflare Durable Objects to maintain conversation state across requests. Each conversation session gets its own isolated Durable Object instance, ensuring:

- **Persistent Memory**: Conversations maintain context across multiple interactions
- **Scalability**: Each session runs independently and can scale automatically
- **Global Distribution**: Sessions can be accessed from any Cloudflare edge location

## Quick Start

### Prerequisites

- Node.js 22+ and pnpm
- Cloudflare account with Workers enabled
- Anthropic API key

### Installation

1. **Import this repository into your folder:**

   ```bash
   npx @nullshot/cli create agent
   ```

2. **Set up environment variables:**

   ```bash
   # Setup local env vars / secrets (update the API key for your AI provider)
   cp .vars-example .dev.vars
   # Add your AI provider API key to Cloudflare Workers secrets for the cloud (you will be prompted for the value)
   npx wrangler secret put AI_PROVIDER_API_KEY 
   ```

3. **(Optional) Update any MCP dependencies your agent relies on:**
   
   3a. Update the `mcp.json` file with GitHub repos or URLs. By default we depend on the MCP Template as an example:
   ```json
   {
     "mcpServers": {
       "mcp-template": {
         "source": "github:null-shot/typescript-mcp-template"
       }
     }
   }
   ```
   
   3b. Run `pnpm install` which will automatically run nullshot install via the preinstall hook

4. **Start development server:**

   ```bash
   # Starts up the agent with all of its dependent MCP servers, including automatically running wrangler migrations
   pnpm dev
   ```

   NOTE: When you start the app - wrangler will say the MCP services are (Not Connected) but in reality they are and its a race bug condition with wrangler.
5. **Deploy to production: (Only deploys the agent, not its dependencies at this time)**
   ```bash
   pnpm deploy
   ```

## Usage

### API Endpoints

The agent exposes a single endpoint that handles all chat interactions:

```
POST /agent/chat/:sessionId?
```

- `sessionId` (optional): Unique identifier for the conversation session. If not provided, a new UUID will be generated.

### Example: Basic Chat Interaction

**Start a new conversation:**

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello! Can you help me understand quantum computing?"
      }
    ]
  }'
```

**Continue an existing conversation:**

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/agent/chat/my-session-123 \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello! Can you help me understand quantum computing?"
      },
      {
        "role": "assistant",
        "content": "I'd be happy to help you understand quantum computing! Quantum computing is a revolutionary approach to computation that leverages the principles of quantum mechanics..."
      },
      {
        "role": "user",
        "content": "Can you give me a simple analogy?"
      }
    ]
  }'
```

### Example: JavaScript/TypeScript Client

```typescript
class AgentClient {
  constructor(private baseUrl: string) {}

  async sendMessage(message: string, sessionId?: string): Promise<ReadableStream> {
    const url = sessionId ? `${this.baseUrl}/agent/chat/${sessionId}` : `${this.baseUrl}/agent/chat`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.body!;
  }

  async *streamResponse(stream: ReadableStream): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// Usage
const client = new AgentClient("https://your-worker.your-subdomain.workers.dev");

async function chatExample() {
  const stream = await client.sendMessage("What's the weather like?", "session-123");

  for await (const chunk of client.streamResponse(stream)) {
    console.log(chunk); // Process streaming response
  }
}
```

### Example: React Hook

```typescript
import { useState, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function useAgent(baseUrl: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());

  const sendMessage = useCallback(
    async (content: string) => {
      const userMessage: Message = { role: "user", content };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const response = await fetch(`${baseUrl}/agent/chat/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...messages, userMessage],
          }),
        });

        if (!response.ok) throw new Error("Failed to send message");

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = "";

        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantMessage += chunk;

          setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: assistantMessage }]);
        }
      } catch (error) {
        console.error("Error sending message:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [baseUrl, sessionId, messages],
  );

  return { messages, sendMessage, isLoading, sessionId };
}
```

## thirdweb Integration (Bridge, Tokens, RPC Edge)

This template has been extended with a set of MCP servers that deeply integrate with **thirdweb** to power cross-chain routing and gas-aware optimization:

- `bridge-router-mcp` – wraps **thirdweb Bridge**:
  - `Bridge.Buy.prepare` for finalized bridge quotes + prepared transactions.
  - `Bridge.status` for end-to-end bridge status across chains.
  - `Bridge.tokens` for token metadata and price data (e.g., `prices.USD`).
  - `/v1/bridge/routes` HTTP API for route discovery.
- `gas-oracle-mcp` – uses **thirdweb RPC Edge** (`https://<chainId>.rpc.thirdweb.com`) and `Bridge.tokens` to:
  - Fetch EIP-1559-style gas data (`eth_feeHistory`) and fall back to `eth_gasPrice`.
  - Compute gas costs in native token units and approximate USD.
  - Produce normalized cross-chain snapshots (e.g., cost per 100k gas).
- `route-optimizer-mcp` – uses **Bridge + RPC Edge** to:
  - Call `Bridge.Buy.prepare` with different `maxSteps` and `slippageToleranceBps` settings.
  - Use token prices from `Bridge.tokens` to compare origin vs destination USD value.
  - Estimate heuristic gas cost per transaction via RPC Edge.
  - Score candidate routes (cheapest, fastest, balanced) and recommend one.

### Required environment variables for thirdweb

Set these in `.dev.vars` for local dev and as secrets/vars in Cloudflare:

```bash
THIRDWEB_CLIENT_ID=your_thirdweb_client_id
THIRDWEB_SECRET_KEY=your_thirdweb_secret_key
```

- `THIRDWEB_CLIENT_ID` is used by the SDK (`createThirdwebClient`) in all MCPs to call `Bridge.*` and `Bridge.tokens`.
- `THIRDWEB_SECRET_KEY` is used to authenticate **RPC Edge** calls and the `/v1/bridge/routes` HTTP API via the `x-secret-key` header.

> Note: use Cloudflare **secrets** (not plain vars) for `THIRDWEB_SECRET_KEY` in production.

### Slippage configuration (Bridge.Buy.prepare)

Both the low-level and high-level MCPs support configuring slippage tolerance:

- `bridge-router-mcp`:
  - Tool: `bridge_prepare_quote`
  - Parameter: `slippageToleranceBps?: number`
  - This is passed directly to `Bridge.Buy.prepare({ slippageToleranceBps })`.
- `route-optimizer-mcp`:
  - Tool: `optimize_bridge_route`
  - Parameter: `slippageToleranceBps?: number`
  - All evaluated routes (different `maxSteps` options) share the same slippage tolerance.

**Interpretation:**

- Slippage tolerance is in basis points (bps):
  - `100` = 1%
  - `500` = 5%
- If omitted, thirdweb uses its own default slippage for the prepared quote.

From the agent’s perspective, you can steer slippage by:

- Including instructions in the system prompt, e.g.:
  - “For volatile tokens, use `slippageToleranceBps` around 300–500 (3–5%).”
  - “Default to 100 (1%) slippage unless the user explicitly asks for more.”
- Interpreting user language:
  - “Max 1% slippage” → `slippageToleranceBps = 100`
  - “Up to 0.5% slippage” → `slippageToleranceBps = 50`

### Gas preference configuration (RPC Edge + tokens)

`gas-oracle-mcp` and `route-optimizer-mcp` both use thirdweb’s infrastructure for gas:

- RPC Edge (`https://<chainId>.rpc.thirdweb.com`) for:
  - `eth_feeHistory` (EIP-1559) → base fee, priority fee, max fee suggestions.
  - `eth_gasPrice` as a fallback.
- `Bridge.tokens` (with `NATIVE_TOKEN_ADDRESS`) for:
  - Native token symbol and decimals.
  - Native token `prices.USD` to approximate USD gas costs.

You can influence gas-related behaviour at the agent level by:

- System prompt guidance:
  - “When comparing routes, always consider both bridge protocol fees and estimated gas cost in USD.”
  - “For the `gas_multi_chain_snapshot` tool, prefer chains within 10–20% of the cheapest gas cost when other factors are equal.”
- Tool choices:
  - Use `gas_get_details` for a single-chain deep dive.
  - Use `gas_estimate_cost` when you know a specific gas limit (e.g., from simulated or historical transactions).
  - Use `gas_multi_chain_snapshot` to answer “where is gas cheapest right now?”-style questions.

### Typical AgentBridge flow (end-to-end)

For a query like:

> “What’s the cheapest way to bridge 500 USDC from Polygon to Base?”

The agent should roughly:

1. Resolve tokens and chains:
   - Call `bridge_search_tokens` to find USDC on Polygon (137) and Base (8453).
2. Optimize the route:
   - Call `optimize_bridge_route` with:
     - `originChainId=137`, `destinationChainId=8453`
     - `originTokenAddress`, `destinationTokenAddress`
     - `amountWei` for 500 USDC
     - `preference="cheapest"`
     - optional `slippageToleranceBps` based on user/system policies.
3. Use gas-aware scoring:
   - `route-optimizer-mcp` internally:
     - Uses `Bridge.Buy.prepare` to evaluate multiple `maxSteps` values.
     - Uses RPC Edge gas + native token prices to approximate gas costs per transaction.
     - Returns candidates with:
       - Destination value in USD
       - Estimated gas in USD
       - Net destination after gas
       - Estimated execution time
       - Scores and a recommended route.
4. Explain the result:
   - Present the recommended route and trade-offs:
     - “Route A gives you ~$X after gas, takes ~Y seconds, uses maxSteps=2, and respects 1% slippage.”

With this setup, your agent remains conversational but is grounded in thirdweb’s Bridge, token pricing, and RPC Edge infrastructure.

## Configuration

### Environment Variables

Configure these in your `wrangler.jsonc` or as Cloudflare Workers secrets:

- `AI_PROVIDER_API_KEY`: Your AI provider API key (secret) - supports Anthropic, OpenAI, etc.
- `AI_PROVIDER`: Set to "anthropic" or your preferred provider (configured in wrangler.jsonc)
- `MODEL_ID`: The specific model to use (e.g., "claude-3-haiku-20240307", "claude-3-sonnet-20241022", etc.)

### AI Provider Support

The template supports multiple AI providers through AI SDK v5:

**Anthropic (Default):**
```typescript
// Environment variables
AI_PROVIDER=anthropic
MODEL_ID=claude-3-haiku-20240307
AI_PROVIDER_API_KEY=your_anthropic_key

// In code - already configured in the template
import { createAnthropic } from '@ai-sdk/anthropic';
const provider = createAnthropic({ apiKey: env.AI_PROVIDER_API_KEY });
const model = provider.languageModel(env.MODEL_ID);
```

**OpenAI:**
```typescript
// Environment variables  
AI_PROVIDER=openai
MODEL_ID=gpt-4
AI_PROVIDER_API_KEY=your_openai_key

// In code - modify the constructor in src/index.ts
import { createOpenAI } from '@ai-sdk/openai';
case "openai":
  provider = createOpenAI({ apiKey: env.AI_PROVIDER_API_KEY });
  model = provider.languageModel(env.MODEL_ID);
  break;
```

### Customizing the Agent

The agent behavior can be customized by modifying the `SimplePromptAgent` class in `src/index.ts`:

```typescript
async processMessage(sessionId: string, messages: AIUISDKMessage): Promise<Response> {
  const result = await this.streamTextWithMessages(
    sessionId,
    messages.messages,
    {
      system: 'Your custom system prompt here', // Customize the agent's personality
      maxSteps: 10, // Adjust reasoning steps
      experimental_toolCallStreaming: true, // Enable tool streaming
      onError: (error: unknown) => {
        console.error("Error processing message", error);
      },
      // Add temperature, topP, etc. as needed
    }
  );

  return result.toTextStreamResponse();
}
```

### Adding MCP Tools

MCP tools are enabled by default. The configuration is managed through `mcp.json` and automatically loaded:

```typescript
// In the constructor - MCP tools are automatically loaded from mcp.json
super(state, env, model, [new ToolboxService(env, mcpConfig)]);

// In processMessage - tool streaming is enabled by default
const result = await this.streamTextWithMessages(sessionId, messages.messages, {
  system: "Your system prompt",
  maxSteps: 10,
  experimental_toolCallStreaming: true, // Tool streaming enabled
  onError: (error: unknown) => {
    console.error("Error processing message", error);
  },
});
```

To add new MCP servers, update your `mcp.json`:

```json
{
  "mcpServers": {
    "mcp-template": {
      "source": "github:null-shot/typescript-mcp-template"
    },
    "your-custom-server": {
      "source": "github:your-org/your-mcp-server"
    }
  }
}
```

## Development

### Local Development

```bash
# Start development server with hot reload
pnpm dev

# Generate TypeScript types
pnpm cf-typegen
```

### Testing

Test your agent locally:

```bash
# Test with curl
curl -X POST http://localhost:8787/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

### Deployment

```bash
# Deploy to Cloudflare Workers
pnpm deploy

# View logs
npx wrangler tail
```

## Project Structure

```
├── src/
│   └── index.ts              # Main agent implementation
├── package.json              # Dependencies and scripts
├── wrangler.jsonc           # Cloudflare Workers configuration
├── tsconfig.json            # TypeScript configuration
├── worker-configuration.d.ts # Generated type definitions
├── mcp.json                 # MCP tools configuration
├── .dev.vars                # Local environment variables
```

### Available Scripts

- `pnpm dev` - Start development server with MCP tools
- `pnpm build` - Type check and dry-run deployment
- `pnpm deploy` - Deploy to Cloudflare Workers
- `pnpm start` - Start local development server (without MCP)
- `pnpm cf-typegen` - Generate Cloudflare Workers types
- `pnpm install` - Automatically installs MCP dependencies along with latest packages

## Known Issues

### MCP Service Shows "[not connected]" During Startup

When running `pnpm dev`, you may see output like:
```
env.MCP_SERVICE (mcp)    Worker    local [not connected]
```

**This is expected behavior** and a Wrangler startup timing issue. The MCP service is actually connected and functional - you can verify this by testing the agent endpoints. The "[not connected]" status is misleading and doesn't affect functionality.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and questions:

- Check the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
- Review the [Nullshot Agent SDK documentation](https://github.com/null-shot/agent-sdk)
- Check the [AI SDK v5 documentation](https://sdk.vercel.ai/docs)
- Open an issue in this repository
