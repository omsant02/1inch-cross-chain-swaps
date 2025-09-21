import { 
  SDK, 
  NetworkEnum, 
  PrivateKeyProviderConnector, 
  HashLock, 
  EvmAddress,
  SolanaAddress 
} from '@1inch/cross-chain-sdk';
import { JsonRpcProvider, FetchRequest, TransactionRequest } from 'ethers';
import { randomBytes } from 'node:crypto';
import { add0x } from '@1inch/byte-utils';

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

  private getChainRPC(chainId: number): string {
    const rpcUrls: { [key: number]: string } = {
      1: `https://api.1inch.dev/web3/1`,
      8453: `https://api.1inch.dev/web3/8453`,
      42161: `https://api.1inch.dev/web3/42161`,
      137: `https://api.1inch.dev/web3/137`,
      10: `https://api.1inch.dev/web3/10`,
    };
    
    return rpcUrls[chainId] || `https://api.1inch.dev/web3/${chainId}`;
  }

  private async getSDKWithSigner(chainId: number = 1): Promise<SDK> {
    const privateKey = process.env.TEST_PRIVATE_KEY;
    const apiKey = process.env.INCH_API_KEY;
    
    if (!privateKey || !apiKey) {
      throw new Error('TEST_PRIVATE_KEY and INCH_API_KEY required for order submission');
    }

    // Create authenticated provider for the specific chain
    const request = new FetchRequest(this.getChainRPC(chainId));
    request.setHeader("Authorization", `Bearer ${apiKey}`);
    const provider = new JsonRpcProvider(request);

    const connector = new PrivateKeyProviderConnector(privateKey, {
      eth: {
        call(transactionConfig: TransactionRequest): Promise<string> {
          return provider.call(transactionConfig);
        },
      },
      extend(): void {},
    });

    return new SDK({
      url: "https://api.1inch.dev/fusion-plus",
      blockchainProvider: connector,
      authKey: apiKey,
    });
  }

  getSupportedChains() {
    return {
      1: { name: 'Ethereum', symbol: 'ETH', rpc: this.getChainRPC(1) },
      137: { name: 'Polygon', symbol: 'MATIC', rpc: this.getChainRPC(137) },
      42161: { name: 'Arbitrum', symbol: 'ARB', rpc: this.getChainRPC(42161) },
      8453: { name: 'Base', symbol: 'BASE', rpc: this.getChainRPC(8453) },
      10: { name: 'Optimism', symbol: 'OP', rpc: this.getChainRPC(10) },
      900: { name: 'Solana', symbol: 'SOL', rpc: 'https://api.mainnet-beta.solana.com' },
    };
  }

  getWorkingTokens() {
    return {
      1: { // Ethereum (documented route)
        'USDT': '0xdac17f958d2ee523a2206206994597c13d831ec7',
        'USDC': '0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48',
      },
      900: { // Solana (documented route)
        'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      },
      8453: { // Base
        'ETH': '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        'WETH': '0x4200000000000000000000000000000000000006',
        'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        'USDT': '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      },
      42161: { // Arbitrum
        'ETH': '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        'USDT': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        'USDC': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
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
        presets: Object.keys(quote.presets),
        recommendedPreset: quote.recommendedPreset,
        quoteId: quote.quoteId
      };
    } catch (error) {
      console.error('Quote error details:', error);
      throw new Error(`Quote failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async executeSwap(params: SwapRequest) {
    try {
      console.log('Starting cross-chain swap execution...');
      console.log('Swap params:', {
        srcChain: params.srcChainId,
        dstChain: params.dstChainId,
        amount: params.amount,
        preset: params.preset || 'fast'
      });

      // Step 1: Get quote
      const quote = await this.sdk.getQuote({
        amount: params.amount,
        srcChainId: params.srcChainId,
        dstChainId: params.dstChainId,
        srcTokenAddress: params.srcTokenAddress,
        dstTokenAddress: params.dstTokenAddress,
        enableEstimate: true,
        walletAddress: params.walletAddress,
      });
      
      console.log('Quote obtained successfully');
      console.log('Available presets:', Object.keys(quote.presets));
      console.log('Recommended preset:', quote.recommendedPreset);

      // Step 2: Get SDK with signer for source chain
      const sdkWithSigner = await this.getSDKWithSigner(params.srcChainId);
      
      // Step 3: Prepare order parameters
      const preset = quote.recommendedPreset;
      const presetData = quote.getPreset(preset);
      
      console.log(`Using preset: ${preset} (secrets needed: ${presetData.secretsCount})`);

      // Step 4: Generate secrets
      const secrets = Array.from({ length: presetData.secretsCount }).map(() => 
        add0x(randomBytes(32).toString('hex'))
      );
      
      const secretHashes = secrets.map(HashLock.hashSecret);
      const hashLock = secrets.length === 1 
        ? HashLock.forSingleFill(secrets[0])
        : HashLock.forMultipleFills(HashLock.getMerkleLeaves(secrets));

      console.log('Secrets generated and hashlock created');

      // Step 5: Create order (EVM source to any destination)
      console.log('Creating EVM order...');
      
      const order = quote.createEvmOrder({
        hashLock,
        receiver: params.dstChainId === 900 
          ? SolanaAddress.fromString(params.receiverAddress)  // Solana destination
          : EvmAddress.fromString(params.receiverAddress),    // EVM destination
        preset: preset,
      });

      console.log('Submitting order to relayer...');
      
      try {
        const { orderHash } = await sdkWithSigner.submitOrder(
          params.srcChainId,
          order,
          quote.quoteId!,
          secretHashes,
        );
        
        console.log('Order submitted with hash:', orderHash);

        // Step 6: Monitor and complete swap
        const finalResult = await this.monitorAndCompleteSwap(orderHash, secrets, params.srcChainId);
        
        return {
          success: true,
          orderHash: orderHash,
          quote: {
            success: true,
            estimatedOutput: quote.dstTokenAmount?.toString() || '0',
            preset: preset,
            secretsCount: presetData.secretsCount
          },
          finalStatus: finalResult,
          message: 'Cross-chain swap executed successfully'
        };
        
      } catch (submitError: any) {
        console.error('Submit order failed with details:', {
          message: submitError.message,
          response: submitError.response?.data,
          status: submitError.response?.status,
          code: submitError.code
        });
        
        if (submitError.response?.data) {
          throw new Error(`API Error: ${JSON.stringify(submitError.response.data)}`);
        }
        
        throw submitError;
      }
      
    } catch (error) {
      console.error('Swap execution failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : undefined,
        message: 'Swap execution failed - check error details'
      };
    }
  }

  private async monitorAndCompleteSwap(orderHash: string, secrets: string[], srcChainId: number) {
    try {
      const sdkWithSigner = await this.getSDKWithSigner(srcChainId);
      const maxWaitTime = 10 * 60 * 1000; // 10 minutes
      const startTime = Date.now();
      const submittedSecrets = new Set<number>();

      console.log('Starting order monitoring for hash:', orderHash);

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const status = await sdkWithSigner.getOrderStatus(orderHash);
          console.log('Current order status:', status.status);
          
          if (status.status === 'executed') {
            console.log('Order completed successfully!');
            return { 
              status: 'completed', 
              message: 'Swap completed successfully',
              finalOrderStatus: status
            };
          }

          const readyForSecrets = await sdkWithSigner.getReadyToAcceptSecretFills(orderHash);
          
          if (readyForSecrets.fills && readyForSecrets.fills.length > 0) {
            console.log(`Found ${readyForSecrets.fills.length} fills ready for secrets`);
            
            for (const fill of readyForSecrets.fills) {
              if (!submittedSecrets.has(fill.idx) && secrets[fill.idx]) {
                try {
                  console.log(`Submitting secret for fill index ${fill.idx}`);
                  await sdkWithSigner.submitSecret(orderHash, secrets[fill.idx]);
                  submittedSecrets.add(fill.idx);
                  console.log(`Secret submitted successfully for fill ${fill.idx}`);
                } catch (secretError) {
                  console.error(`Failed to submit secret for fill ${fill.idx}:`, secretError);
                }
              }
            }
          }

          await new Promise(resolve => setTimeout(resolve, 5000));
          
        } catch (monitorError) {
          console.error('Error during monitoring iteration:', monitorError);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      throw new Error('Monitoring timed out after 10 minutes');
      
    } catch (error) {
      console.error('Monitoring failed:', error);
      return {
        status: 'failed',
        message: 'Monitoring failed',
        error: error instanceof Error ? error.message : 'Unknown monitoring error'
      };
    }
  }

  async getActiveOrders(page = 1, limit = 10) {
    try {
      return await this.sdk.getActiveOrders({ page, limit });
    } catch (error) {
      console.error('Failed to get active orders:', error);
      throw error;
    }
  }

  async getOrderStatus(orderHash: string) {
    try {
      return await this.sdk.getOrderStatus(orderHash);
    } catch (error) {
      console.error('Failed to get order status:', error);
      throw error;
    }
  }
}

export default FusionService;