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

// Test swap from Base to Polygon (you have Base funds)
router.post('/swap/test-base-to-polygon', async (req, res) => {
  try {
    const { amount } = req.body;
    
    const result = await fusionService.executeSwap({
      srcChainId: 8453, // Base
      dstChainId: 137, // Polygon
      srcTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Base ETH
      dstTokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Polygon USDC
      amount: amount || '10000000000000000', // 0.01 ETH default
      walletAddress: process.env.TEST_MAKER_ADDRESS!,
      receiverAddress: process.env.TEST_RECEIVER_ADDRESS!,
      preset: 'fast'
    });

    res.json({
      success: true,
      data: result,
      message: 'Base to Polygon swap executed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test swap failed'
    });
  }
});

// Test swap from Arbitrum to Base (you have Arbitrum funds)
router.post('/swap/test-arbitrum-to-base', async (req, res) => {
  try {
    const { amount } = req.body;
    
    const result = await fusionService.executeSwap({
      srcChainId: 42161, // Arbitrum
      dstChainId: 8453, // Base
      srcTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum USDC
      dstTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Base ETH
      amount: amount || '1000000', // 1 USDC default
      walletAddress: process.env.TEST_MAKER_ADDRESS!,
      receiverAddress: process.env.TEST_RECEIVER_ADDRESS!,
      preset: 'fast'
    });

    res.json({
      success: true,
      data: result,
      message: 'Arbitrum to Base swap executed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test swap failed'
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

// Quick quote test with your tokens
router.post('/quote/quick-test', async (req, res) => {
  try {
    // Test Base ETH to Polygon USDC quote
    const quote = await fusionService.getQuote({
      srcChainId: 8453,
      dstChainId: 137,
      srcTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      dstTokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      amount: '10000000000000000',
      walletAddress: process.env.TEST_MAKER_ADDRESS!
    });

    res.json({
      success: true,
      data: quote,
      message: 'Quick test quote successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Quick test failed'
    });
  }
});

export default router;