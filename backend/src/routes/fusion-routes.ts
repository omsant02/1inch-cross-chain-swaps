import { Router } from 'express';
import FusionService from '../services/fusion-service';

const router = Router();
const fusionService = new FusionService();

// Health check
router.get('/health', async (req, res) => {
  res.json({ 
    success: true, 
    message: 'Mainnet Fusion+ API Ready',
    supportedChains: fusionService.getSupportedChains(),
    env: {
      hasApiKey: !!process.env.INCH_API_KEY,
      hasPrivateKey: !!process.env.TEST_PRIVATE_KEY,
      walletAddress: process.env.TEST_MAKER_ADDRESS
    }
  });
});

// Get supported chains
router.get('/chains', async (req, res) => {
  try {
    const chains = fusionService.getSupportedChains();
    res.json({ success: true, data: chains });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get working tokens by chain
router.get('/tokens', async (req, res) => {
  try {
    const tokens = fusionService.getWorkingTokens();
    res.json({ success: true, data: tokens });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get quote for cross-chain swap
router.post('/quote', async (req, res) => {
  try {
    const { srcChainId, dstChainId, srcTokenAddress, dstTokenAddress, amount, walletAddress } = req.body;

    if (!srcChainId || !dstChainId || !srcTokenAddress || !dstTokenAddress || !amount || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: srcChainId, dstChainId, srcTokenAddress, dstTokenAddress, amount, walletAddress'
      });
    }

    const quote = await fusionService.getQuote({
      srcChainId,
      dstChainId,
      srcTokenAddress,
      dstTokenAddress,
      amount,
      walletAddress
    });

    res.json(quote);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Quote failed'
    });
  }
});

// Execute complete cross-chain swap
router.post('/swap/execute', async (req, res) => {
  try {
    const { 
      srcChainId, dstChainId, srcTokenAddress, dstTokenAddress, 
      amount, walletAddress, receiverAddress, preset 
    } = req.body;

    if (!srcChainId || !dstChainId || !srcTokenAddress || !dstTokenAddress || 
        !amount || !walletAddress || !receiverAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    console.log(`Executing swap: Chain ${srcChainId} -> Chain ${dstChainId}, Amount: ${amount}`);

    const result = await fusionService.executeSwap({
      srcChainId,
      dstChainId,
      srcTokenAddress,
      dstTokenAddress,
      amount,
      walletAddress,
      receiverAddress,
      preset: preset || 'fast'
    });

    res.json(result);

  } catch (error) {
    console.error('Swap execution error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Swap execution failed'
    });
  }
});

// Official documented route: Ethereum USDT -> Solana USDT
router.post('/swap/test-eth-to-solana', async (req, res) => {
  try {
    const { amount, solanaReceiver } = req.body;
    
    if (!solanaReceiver) {
      return res.status(400).json({
        success: false,
        error: 'solanaReceiver (Solana wallet address) is required'
      });
    }

    const result = await fusionService.executeSwap({
      srcChainId: 1, // Ethereum
      dstChainId: 900, // Solana  
      srcTokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', // ETH USDT
      dstTokenAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // SOL USDT
      amount: amount || '5000000', // 5 USDT default
      walletAddress: process.env.TEST_MAKER_ADDRESS!,
      receiverAddress: solanaReceiver,
      preset: 'fast'
    });

    res.json({
      success: true,
      data: result,
      message: 'Ethereum USDT to Solana USDT swap executed (official documented route)'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Official route test failed'
    });
  }
});

// Test quote for official documented route
router.post('/quote/test-eth-to-solana', async (req, res) => {
  try {
    const { amount } = req.body;
    
    const quote = await fusionService.getQuote({
      srcChainId: 1, // Ethereum
      dstChainId: 900, // Solana
      srcTokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', // ETH USDT
      dstTokenAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // SOL USDT
      amount: amount || '5000000', // 5 USDT default
      walletAddress: process.env.TEST_MAKER_ADDRESS!
    });

    res.json({
      success: true,
      data: quote,
      message: 'Official documented route quote successful',
      route: 'Ethereum USDT -> Solana USDT'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Official route quote failed'
    });
  }
});

// Legacy routes (kept for backward compatibility but using safer amounts)
router.post('/swap/test-base-eth-to-polygon', async (req, res) => {
  try {
    const { amount } = req.body;
    
    const result = await fusionService.executeSwap({
      srcChainId: 8453, // Base
      dstChainId: 137, // Polygon
      srcTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Base ETH
      dstTokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Polygon USDC
      amount: amount || '5000000000000000', // ~$5 worth
      walletAddress: process.env.TEST_MAKER_ADDRESS!,
      receiverAddress: process.env.TEST_RECEIVER_ADDRESS!,
      preset: 'fast'
    });

    res.json({
      success: true,
      data: result,
      message: 'Base ETH to Polygon USDC swap executed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Legacy route test failed'
    });
  }
});

// Get order status
router.get('/order/:orderHash/status', async (req, res) => {
  try {
    const { orderHash } = req.params;
    const status = await fusionService.getOrderStatus(orderHash);
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get order status'
    });
  }
});

// Get active orders
router.get('/orders/active', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const orders = await fusionService.getActiveOrders(page, limit);
    res.json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get active orders'
    });
  }
});

// Check supported routes and tokens
router.get('/supported-routes', async (req, res) => {
  try {
    const routes = [
      {
        name: 'Official Documented Route',
        description: 'Ethereum USDT to Solana USDT',
        srcChain: { id: 1, name: 'Ethereum' },
        dstChain: { id: 900, name: 'Solana' },
        srcToken: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        dstToken: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        status: 'Fully Supported',
        minimumAmount: '5000000' // 5 USDT
      },
      {
        name: 'Base to Polygon',
        description: 'Base ETH to Polygon USDC',
        srcChain: { id: 8453, name: 'Base' },
        dstChain: { id: 137, name: 'Polygon' },
        srcToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        dstToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        status: 'Experimental',
        minimumAmount: '5000000000000000' // ~$5 ETH
      }
    ];

    res.json({
      success: true,
      data: routes,
      message: 'Supported cross-chain routes',
      recommendation: 'Use the official documented route (Ethereum -> Solana) for best results'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get supported routes'
    });
  }
});

export default router;