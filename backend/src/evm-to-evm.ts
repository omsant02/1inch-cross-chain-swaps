import { randomBytes } from "node:crypto";
import { setTimeout } from "timers/promises";
import { add0x } from "@1inch/byte-utils";
import dotenv from "dotenv";
import { JsonRpcProvider, TransactionRequest, FetchRequest } from "ethers";
import { parseUnits } from "viem";

let SDK: any, 
    NetworkEnum: any, 
    PrivateKeyProviderConnector: any, 
    HashLock: any,
    EvmAddress: any;

async function initializeSDK() {
  try {
    const sdkModule = await import("@1inch/cross-chain-sdk");
    
    SDK = sdkModule.SDK;
    NetworkEnum = sdkModule.NetworkEnum;
    PrivateKeyProviderConnector = sdkModule.PrivateKeyProviderConnector;
    HashLock = sdkModule.HashLock;
    EvmAddress = sdkModule.EvmAddress;
    
    config = {
      ...baseConfig,
      srcChainId: NetworkEnum.POLYGON,
      dstChainId: NetworkEnum.ETHEREUM,
      nodeUrl: `https://api.1inch.dev/web3/${NetworkEnum.POLYGON}`, 
      sdkUrl: "https://api.1inch.dev/fusion-plus",
    };
    
    console.log("SDK initialized successfully");
    
  } catch (err) {
    console.error("Failed to import SDK:", err);
    process.exit(1);
  }
}

dotenv.config();

const requiredEnvVars = [
  "PRIVATE_KEY",
  "MAKER_ADDRESS", 
  "RECEIVER_ADDRESS",
  "DEV_PORTAL_API_KEY",
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const baseConfig = {
  signerPrivateKey: process.env.PRIVATE_KEY!,
  maker: process.env.MAKER_ADDRESS!,
  receiver: process.env.RECEIVER_ADDRESS!,
  devPortalApiKey: process.env.DEV_PORTAL_API_KEY!,
  // Token addresses
  usdtPolygon: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",   // USDT on Polygon (source)
  usdcEthereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum (destination)
  amount: parseUnits("10", 6), // 10 USDT (6 decimals)
  pollInterval: 5000,
};

let config: any;

function getSecret(): string {
  return add0x(randomBytes(32).toString("hex"));
}

function generateSecrets(count: number): string[] {
  return Array.from({ length: count }).map(getSecret);
}

function createHashLock(secrets: string[]): any {
  const leaves = HashLock.getMerkleLeaves(secrets);

  return secrets.length > 1
    ? HashLock.forMultipleFills(leaves)
    : HashLock.forSingleFill(secrets[0]);
}

async function getQuote(sdk: any): Promise<any> {
  console.log("Fetching quote...");

  const quote = await sdk.getQuote({
    amount: config.amount.toString(),
    srcChainId: config.srcChainId.valueOf(),
    dstChainId: config.dstChainId.valueOf(),
    srcTokenAddress: config.usdtPolygon,
    dstTokenAddress: config.usdcEthereum,
    enableEstimate: true,
    walletAddress: config.maker,
  });

  console.log("Quote received successfully");
  console.log(`Source: ${(Number(config.amount) / 1e6).toFixed(2)} USDT on Polygon`);
  console.log(`Destination: ~${(Number(quote.dstTokenAmount) / 1e6).toFixed(2)} USDC on Ethereum`);
  return quote;
}

async function createAndSubmitOrder(
  sdk: any,
  quote: any,
): Promise<{ orderHash: string; secrets: string[] }> {
  console.log("Creating order...");

  const preset = quote.getPreset(quote.recommendedPreset);
  console.log(`Using preset: ${quote.recommendedPreset}`);
  console.log(`Secrets count: ${preset.secretsCount}`);

  const secrets = generateSecrets(preset.secretsCount);
  const secretHashes = secrets.map((s: string) => HashLock.hashSecret(s));
  const hashLock = createHashLock(secrets);

  // For EVM -> EVM, we create an EVM order
  const order = quote.createEvmOrder({
    hashLock,
    receiver: EvmAddress.fromString(config.receiver), // Use EvmAddress wrapper
    preset: quote.recommendedPreset,
  });

  console.log("Submitting order to relayer...");
  const { orderHash } = await sdk.submitOrder(
    config.srcChainId.valueOf(),
    order,
    quote.quoteId!,
    secretHashes,
  );
  console.log("Order submitted with hash:", orderHash);

  return { orderHash, secrets };
}

async function monitorAndSubmitSecrets(
  sdk: any,
  orderHash: string,
  secrets: string[],
): Promise<void> {
  console.log("Starting to monitor for fills...");

  const alreadyShared = new Set<number>();
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes

  while (attempts < maxAttempts) {
    try {
      const order = await sdk.getOrderStatus(orderHash);
      console.log(`Order status: ${order.status} (attempt ${attempts + 1}/${maxAttempts})`);
      if (order.status === "executed") {
        console.log("Order is complete!");
        return;
      }
      
      if (order.status === "expired" || order.status === "cancelled") {
        console.log(`Order ${order.status}. Exiting...`);
        return;
      }
    } catch (err) {
      console.error(`Error while getting order status:`, err);
    }

    try {
      const readyToAcceptSecrets = await sdk.getReadyToAcceptSecretFills(orderHash);
      
      if (readyToAcceptSecrets.fills && readyToAcceptSecrets.fills.length > 0) {
        const idxes = readyToAcceptSecrets.fills.map((f: any) => f.idx);
        console.log(`Found ${idxes.length} fills ready for secrets`);

        for (const idx of idxes) {
          if (!alreadyShared.has(idx)) {
            try {
              await sdk.submitSecret(orderHash, secrets[idx]);
              alreadyShared.add(idx);
              console.log("Submitted secret for index:", idx);
            } catch (err) {
              console.error("Failed to submit secret for index", idx, ":", err);
            }
          }
        }
      }

      await setTimeout(config.pollInterval);
      console.log("polling for fills...");
      attempts++;
    } catch (err) {
      console.error("Error while monitoring fills:", err);
      await setTimeout(config.pollInterval);
      attempts++;
    }
  }
  
  console.log("Timeout reached. Check order status manually.");
}

async function performCrossChainSwap(): Promise<void> {
  console.log("Starting cross-chain swap from Polygon to Ethereum...");
  console.log(`From: ${config.maker} (Polygon)`);
  console.log(`To: ${config.receiver} (Ethereum)`);
  console.log(`Amount: ${(Number(config.amount) / 1e6).toFixed(2)} USDT`);

  // Setup Ethers provider
  const request = new FetchRequest(config.nodeUrl);
  request.setHeader("Authorization", `Bearer ${config.devPortalApiKey}`);
  const ethersRpcProvider = new JsonRpcProvider(request);

  const ethersProviderConnector = {
    eth: {
      call(transactionConfig: TransactionRequest): Promise<string> {
        return ethersRpcProvider.call(transactionConfig);
      },
    },
    extend(): void {},
  };

  const connector = new PrivateKeyProviderConnector(
    config.signerPrivateKey,
    ethersProviderConnector,
  );

  const sdk = new SDK({
    url: config.sdkUrl,
    blockchainProvider: connector,
    authKey: config.devPortalApiKey,
  });

  const quote = await getQuote(sdk);
  const { orderHash, secrets } = await createAndSubmitOrder(sdk, quote);
  await monitorAndSubmitSecrets(sdk, orderHash, secrets);
}

async function main(): Promise<void> {
  await initializeSDK();
  
  try {
    await performCrossChainSwap();
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error in main:", err);
  process.exit(1);
});

// Environment variables needed:
// PRIVATE_KEY=your_ethereum_private_key
// MAKER_ADDRESS=your_ethereum_wallet_address  
// RECEIVER_ADDRESS=your_polygon_wallet_address (can be same as maker)
// DEV_PORTAL_API_KEY=your_1inch_api_key

// Prerequisites:
// 1. Approve USDT spending for Limit Order Protocol V4 on Ethereum:
//    Spender: 0x111111125421cA6dc452d289314280a0f8842A65
//    Contract: https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7#writeContract
// 2. Have at least 10 USDT + gas fees on Ethereum