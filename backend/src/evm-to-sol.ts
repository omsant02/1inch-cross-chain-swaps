import { randomBytes } from "node:crypto";
import { setTimeout } from "timers/promises";
import { add0x } from "@1inch/byte-utils";
import dotenv from "dotenv";
import { JsonRpcProvider, FetchRequest } from "ethers";
import type {TransactionRequest} from "ethers";
import { parseUnits } from "viem";

// Dynamic imports to work around export issues
let SDK: any, 
    NetworkEnum: any, 
    SolanaAddress: any, 
    PrivateKeyProviderConnector: any, 
    HashLock: any;

async function initializeSDK() {
  try {
    const sdkModule = await import("@1inch/cross-chain-sdk");
    
    SDK = sdkModule.SDK;
    NetworkEnum = sdkModule.NetworkEnum;
    SolanaAddress = sdkModule.SolanaAddress;
    PrivateKeyProviderConnector = sdkModule.PrivateKeyProviderConnector;
    HashLock = sdkModule.HashLock;
    
    // Initialize config after NetworkEnum is available
    config = {
      ...baseConfig,
      srcChainId: NetworkEnum.ETHEREUM,
      dstChainId: NetworkEnum.SOLANA,
      nodeUrl: `https://api.1inch.dev/web3/${NetworkEnum.ETHEREUM}`,
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
  usdtEvm: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  usdtSolana: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  amount: parseUnits("5", 6),
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
    srcTokenAddress: config.usdtEvm,
    dstTokenAddress: config.usdtSolana,
    enableEstimate: true,
    walletAddress: config.maker,
  });

  console.log("Quote received successfully");
  console.log(`Source: ${config.amount.toString()} USDT on Ethereum`);
  console.log(`Destination: ~${quote.dstTokenAmount} USDT on Solana`);
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

  const order = quote.createEvmOrder({
    hashLock,
    receiver: SolanaAddress.fromString(config.receiver),
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

  while (true) {
    try {
      const order = await sdk.getOrderStatus(orderHash);
      console.log(`Order status: ${order.status}`);
      if (order.status === "executed") {
        console.log("Order is complete!");
        return;
      }
    } catch (err) {
      console.error(`Error while getting order status:`, err);
    }

    try {
      const readyToAcceptSecrets = await sdk.getReadyToAcceptSecretFills(orderHash);
      const idxes = readyToAcceptSecrets.fills.map((f: any) => f.idx);

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

      await setTimeout(config.pollInterval);
      console.log("polling for fills...");
    } catch (err) {
      console.error("Error while monitoring fills:", err);
      await setTimeout(config.pollInterval);
      console.log("retrying after error...");
    }
  }
}

async function performCrossChainSwap(): Promise<void> {
  console.log("Starting cross-chain swap from Ethereum to Solana...");
  console.log(`From: ${config.maker} (Ethereum)`);
  console.log(`To: ${config.receiver} (Solana)`);
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
  // Initialize SDK with dynamic imports first
  await initializeSDK();
  
  try {
    await performCrossChainSwap();
  } catch (err) {
    console.error("Error:", err as Error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error in main:", err);
  process.exit(1);
});