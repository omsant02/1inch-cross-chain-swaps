import { SDK, NetworkEnum, PrivateKeyProviderConnector, HashLock, PresetEnum } from '@1inch/cross-chain-sdk';
import { JsonRpcProvider, FetchRequest } from 'ethers';
import { randomBytes } from 'node:crypto';

export interface QuoteRequest {
  srcChainId: number;
  dstChainId: number;
  srcTokenAddress: string;
  dstTokenAddress: string;
  amount: string;
  walletAddress: string;
}

export interface SwapRequest extends QuoteRequest {
  receiverAddress: string;
  preset?: string;
}

class FusionService {
  private sdk: SDK;
  private sdkWithSigner: SDK | null = null;

  constructor() {
    const apiKey = process.env.INCH_API_KEY;
    if (!apiKey) {
      throw new Error('INCH_API_KEY is required');
    }

    this.sdk = new SDK({
      url: "https://api.1inch.dev/fusion-plus",
      authKey: apiKey,
    });
  }

  private async getSDKWithSigner(): Promise<SDK> {
    if (this.sdkWithSigner) return this.sdkWithSigner;

    const privateKey = process.env.TEST_PRIVATE_KEY;
    const apiKey = process.env.INCH_API_KEY;
    
    if (!privateKey || !apiKey) {
      throw new Error('TEST_PRIVATE_KEY and INCH_API_KEY required for order submission');
    }

    const provider = new JsonRpcProvider("https://eth.llamarpc.com");
    const connector = new PrivateKeyProviderConnector(privateKey, {
      eth: { call: (tx: any) => provider.call(tx) },
      extend: () => {}
    });

    this.sdkWithSigner = new SDK({
      url: "https://api.1inch.dev/fusion-plus",
      blockchainProvider: connector,
      authKey: apiKey,
    });

    return this.sdkWithSigner;
  }

  getSupportedChains() {
    return {
      1: { name: 'Ethereum', symbol: 'ETH' },
      137: { name: 'Polygon', symbol: 'MATIC' },
      42161: { name: 'Arbitrum', symbol: 'ARB' },
      8453: { name: 'Base', symbol: 'BASE' },
      10: { name: 'Optimism', symbol: 'OP' },
      56: { name: 'BSC', symbol: 'BNB' },
    };
  }

  getWorkingTokens() {
    return {
      8453: { // Base
        'WETH': '0x4200000000000000000000000000000000000006',
        'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      },
      137: { // Polygon
        'USDT': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        'USDC': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      }
    };
  }

  async getQuote(params: QuoteRequest) {
    try {
      const quote = await this.sdk.getQuote({
        amount: params.amount,
        srcChainId: params.srcChainId,
        dstChainId: params.dstChainId,
        srcTokenAddress: params.srcTokenAddress,
        dstTokenAddress: params.dstTokenAddress,
        enableEstimate: true,
        walletAddress: params.walletAddress,
      });

      return {
        success: true,
        quote: JSON.parse(JSON.stringify(quote, (k, v) => typeof v === 'bigint' ? v.toString() : v)),
        estimatedOutput: quote.dstTokenAmount?.toString() || '0',
      };
    } catch (error) {
      throw new Error(`Quote failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async executeSwap(params: SwapRequest) {
    try {
      console.log('Executing cross-chain swap...');
      
      // Get fresh quote
      const quote = await this.sdk.getQuote({
        amount: params.amount,
        srcChainId: params.srcChainId,
        dstChainId: params.dstChainId,
        srcTokenAddress: params.srcTokenAddress,
        dstTokenAddress: params.dstTokenAddress,
        enableEstimate: true,
        walletAddress: params.walletAddress,
      });
      
      const sdkWithSigner = await this.getSDKWithSigner();
      const preset = (params.preset as keyof typeof quote.presets) || quote.recommendedPreset;
      
      // Check if preset exists
      const presetData = quote.presets[preset];
      if (!presetData) {
        throw new Error(`Invalid preset: ${preset}. Available: ${Object.keys(quote.presets).join(', ')}`);
      }
      
      // Generate secrets
      const secrets = Array.from({ length: presetData.secretsCount }).map(() => 
        '0x' + randomBytes(32).toString('hex')
      );
      
      const hashLock = secrets.length === 1 
        ? HashLock.forSingleFill(secrets[0])
        : HashLock.forMultipleFills(HashLock.getMerkleLeaves(secrets));
      
      const secretHashes = secrets.map((s) => HashLock.hashSecret(s));
      
      console.log(`Generated ${secrets.length} secrets for ${preset} preset`);
      
      // Try the SDK createOrder method with proper typing
      try {
        const orderResult = await sdkWithSigner.createOrder(quote, {
          walletAddress: params.walletAddress,
          hashLock,
          preset: preset as any, // Cast to any to avoid type issues
          secretHashes,
          source: 'sdk'
        });
        
        // Extract order hash from result
        const orderHash = typeof orderResult === 'string' ? orderResult : (orderResult as any).hash;
        console.log('Order created with hash:', orderHash);
        
        // Submit order
        const orderInfo = await sdkWithSigner.submitOrder(
          quote.srcChainId,
          (orderResult as any).order || orderResult,
          quote.quoteId || (orderResult as any).quoteId,
          secretHashes
        );
        
        console.log('Order submitted:', orderInfo);
        
        // Monitor and complete
        const finalResult = await this.monitorAndCompleteSwap(orderHash, secrets);
        
        return {
          success: true,
          orderHash: orderHash,
          quote: {
            success: true,
            quote: JSON.parse(JSON.stringify(quote, (k, v) => typeof v === 'bigint' ? v.toString() : v)),
            estimatedOutput: quote.dstTokenAmount?.toString() || '0',
          },
          finalStatus: finalResult,
          message: 'Cross-chain swap executed successfully'
        };
        
      } catch (createOrderError) {
        console.error('SDK createOrder failed:', createOrderError);
        
        // Return order preparation details for debugging
        return {
          success: false,
          error: `Order creation failed: ${createOrderError instanceof Error ? createOrderError.message : 'Unknown error'}`,
          quote: {
            success: true,
            quote: JSON.parse(JSON.stringify(quote, (k, v) => typeof v === 'bigint' ? v.toString() : v)),
            estimatedOutput: quote.dstTokenAmount?.toString() || '0',
          },
          orderDetails: {
            preset,
            secretsCount: presetData.secretsCount,
            secrets: secrets,
            hashLock: hashLock.toString(),
            secretHashes
          },
          message: 'Quote successful but order creation failed - check order details for manual processing'
        };
      }
      
    } catch (error) {
      console.error('Swap execution failed:', error);
      throw new Error(`Swap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async monitorAndCompleteSwap(orderHash: string, secrets: string[]) {
    const sdkWithSigner = await this.getSDKWithSigner();
    const maxWaitTime = 10 * 60 * 1000;
    const startTime = Date.now();
    const submittedSecrets = new Set<number>();

    console.log('Monitoring order:', orderHash);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await sdkWithSigner.getOrderStatus(orderHash);
        console.log('Order status:', status.status);
        
        if (status.status === 'executed') {
          return { status: 'completed', message: 'Swap completed successfully' };
        }

        const readyForSecrets = await sdkWithSigner.getReadyToAcceptSecretFills(orderHash);
        if (readyForSecrets.fills?.length > 0) {
          console.log(`Found ${readyForSecrets.fills.length} fills ready for secrets`);
          
          for (const fill of readyForSecrets.fills) {
            if (!submittedSecrets.has(fill.idx)) {
              try {
                await sdkWithSigner.submitSecret(orderHash, secrets[fill.idx]);
                submittedSecrets.add(fill.idx);
                console.log(`Submitted secret for fill ${fill.idx}`);
              } catch (secretError) {
                console.error(`Failed to submit secret for fill ${fill.idx}:`, secretError);
              }
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error('Monitoring error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    throw new Error('Swap monitoring timed out');
  }

  async getActiveOrders(page = 1, limit = 10) {
    return await this.sdk.getActiveOrders({ page, limit });
  }

  async getOrderStatus(orderHash: string) {
    return await this.sdk.getOrderStatus(orderHash);
  }
}

export default FusionService; 