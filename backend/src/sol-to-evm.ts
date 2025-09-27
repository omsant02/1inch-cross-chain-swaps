import { randomBytes } from "node:crypto";
import { setTimeout } from "timers/promises";
import { add0x } from "@1inch/byte-utils";
import dotenv from "dotenv";
import { parseUnits } from "viem";
import { Keypair, Transaction } from "@solana/web3.js";
import { utils, web3 } from "@coral-xyz/anchor";

let SDK: any,
    NetworkEnum: any,
    SolanaAddress: any,
    HashLock: any,
    EvmAddress: any,
    SvmSrcEscrowFactory: any;

dotenv.config();

const requiredEnvVars = [
  "SOLANA_PRIVATE_KEY",
  "SOLANA_MAKER_ADDRESS",
  "ETH_RECEIVER_ADDRESS",
  "DEV_PORTAL_API_KEY",
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const baseConfig = {
  signerPrivateKey: process.env.SOLANA_PRIVATE_KEY!,
  maker: process.env.SOLANA_MAKER_ADDRESS!,
  receiver: process.env.ETH_RECEIVER_ADDRESS!,
  devPortalApiKey: process.env.DEV_PORTAL_API_KEY!,
  solanaRpc: "https://api.mainnet-beta.solana.com",
  sdkUrl: "https://api.1inch.dev/fusion-plus",
  usdtEvm: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  usdtSolana: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  amount: parseUnits("5", 6),
  pollInterval: 5000,
};

let config: any;
let sdk: any;

async function initializeSDK() {
  try {
    const sdkModule = await import("@1inch/cross-chain-sdk");
    
    SDK = sdkModule.SDK;
    NetworkEnum = sdkModule.NetworkEnum;
    SolanaAddress = sdkModule.SolanaAddress;
    HashLock = sdkModule.HashLock;
    EvmAddress = sdkModule.EvmAddress;
    SvmSrcEscrowFactory = sdkModule.SvmSrcEscrowFactory;
    
    // Initialize config after NetworkEnum is available
    config = {
      ...baseConfig,
      srcChainId: NetworkEnum.SOLANA,
      dstChainId: NetworkEnum.ETHEREUM,
    };
    
    // Initialize SDK after config is ready
    sdk = new SDK({
      url: config.sdkUrl,
      authKey: config.devPortalApiKey,
    });
    
    console.log("SDK initialized successfully");
    console.log("Available exports:", Object.keys(sdkModule));
    
  } catch (err) {
    console.error("Failed to import SDK:", err);
    process.exit(1);
  }
}

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

async function getQuote(): Promise<any> {
  console.log("Fetching quote...");

  const srcToken = SolanaAddress.fromString(config.usdtSolana);
  const dstToken = EvmAddress.fromString(config.usdtEvm);

  const quote = await sdk.getQuote({
    amount: config.amount.toString(),
    srcChainId: config.srcChainId.valueOf(),
    dstChainId: config.dstChainId.valueOf(),
    srcTokenAddress: srcToken.toString(),
    dstTokenAddress: dstToken.toString(),
    enableEstimate: true,
    walletAddress: config.maker,
  });

  console.log("Quote received successfully");
  console.log(`Source: ${(Number(config.amount) / 1e6).toFixed(2)} USDT on Solana`);
  console.log(`Destination: ~${(Number(quote.dstTokenAmount) / 1e6).toFixed(2)} USDT on Ethereum`);
  return quote;
}

async function createAndSubmitOrder(
  quote: any,
): Promise<{ orderHash: string; secrets: string[] }> {
  console.log("Creating order...");

  const preset = quote.getPreset(quote.recommendedPreset);
  console.log(`Using preset: ${quote.recommendedPreset}`);
  console.log(`Secrets count: ${preset.secretsCount}`);

  const secrets = generateSecrets(preset.secretsCount);
  const secretHashes = secrets.map((s: string) => HashLock.hashSecret(s));
  const hashLock = createHashLock(secrets);

  const order = quote.createSolanaOrder({
    hashLock,
    receiver: EvmAddress.fromString(config.receiver),
    preset: quote.recommendedPreset,
  });

  console.log("Announcing order to relayer...");
  const orderHash = await sdk.announceOrder(
    order,
    quote.quoteId!,
    secretHashes,
  );
  console.log("Order announced with hash:", orderHash);

  // Create and submit the Solana transaction
  console.log("Creating Solana transaction...");
  const ix = SvmSrcEscrowFactory.DEFAULT.createOrder(order, {
    srcTokenProgramId: SolanaAddress.TOKEN_PROGRAM_ID,
  });

  const makerSigner = Keypair.fromSecretKey(
    utils.bytes.bs58.decode(config.signerPrivateKey),
  );

  const tx = new Transaction().add({
    data: ix.data,
    programId: new web3.PublicKey(ix.programId.toBuffer()),
    keys: ix.accounts.map((a: any) => ({
      isSigner: a.isSigner,
      isWritable: a.isWritable,
      pubkey: new web3.PublicKey(a.pubkey.toBuffer()),
    })),
  });

  const connection = new web3.Connection(config.solanaRpc);

  console.log("Submitting Solana transaction...");
  const result = await connection.sendTransaction(tx, [makerSigner]);
  console.log("Transaction submitted with signature:", result);

  return { orderHash, secrets };
}

async function monitorAndSubmitSecrets(
  orderHash: string,
  secrets: string[],
): Promise<void> {
  console.log("Starting to monitor for fills...");

  await setTimeout(config.pollInterval);

  const alreadyShared = new Set<number>();
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes

  while (attempts < maxAttempts) {
    try {
      const order: any = await sdk.getOrderStatus(orderHash);
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
      console.error(`Error while getting order status: ${err}`);
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
  console.log("Starting cross-chain swap from Solana to Ethereum...");
  console.log(`From: ${config.maker} (Solana)`);
  console.log(`To: ${config.receiver} (Ethereum)`);
  console.log(`Amount: ${(Number(config.amount) / 1e6).toFixed(2)} USDT`);

  try {
    const quote = await getQuote();
    const { orderHash, secrets } = await createAndSubmitOrder(quote);
    await monitorAndSubmitSecrets(orderHash, secrets);
    console.log("Cross-chain swap completed successfully!");
  } catch (error) {
    console.error("Swap failed:", error);
    throw error;
  }
}

async function main(): Promise<void> {
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

// Environment variables needed in .env:
// SOLANA_PRIVATE_KEY=your_base58_solana_private_key
// SOLANA_MAKER_ADDRESS=your_solana_wallet_address  
// ETH_RECEIVER_ADDRESS=your_ethereum_wallet_address
// DEV_PORTAL_API_KEY=your_1inch_api_key

// Prerequisites:
// 1. npm install @coral-xyz/anchor@^0.30.0 @solana/web3.js@^1.95.0
// 2. Have at least 5 USDT in your Solana wallet
// 3. Have sufficient SOL for transaction fees