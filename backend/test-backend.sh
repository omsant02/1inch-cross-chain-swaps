#!/bin/bash

# Simple Backend Testing Script for Base Chain
echo "Testing 1inch Fusion+ Backend with Base Chain..."

BASE_URL="http://localhost:3001"

echo ""
echo "1. Testing if server is running..."
curl -s "$BASE_URL/health" || { echo "❌ Server not running! Start with: npm run dev"; exit 1; }

echo ""
echo "2. Testing API key..."
curl -s "$BASE_URL/test-api" | head -n 10

echo ""
echo "3. Testing Fusion service..."
curl -s "$BASE_URL/api/fusion/health" | head -n 10

echo ""
echo "4. Testing quote: Base ETH -> Polygon USDC (~$0.50 worth)..."
curl -s -X POST "$BASE_URL/api/fusion/quote" \
  -H "Content-Type: application/json" \
  -d '{
    "srcChainId": 8453,
    "dstChainId": 137,
    "srcTokenAddress": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    "dstTokenAddress": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    "amount": "125000000000000",
    "walletAddress": "0x0b07ab58f72d13150Fcd119700aae76d9D161138"
  }' | head -n 20

echo ""
echo "5. Testing quote: Base WETH -> Arbitrum USDC (~$0.50 worth)..."
curl -s -X POST "$BASE_URL/api/fusion/quote" \
  -H "Content-Type: application/json" \
  -d '{
    "srcChainId": 8453,
    "dstChainId": 42161,
    "srcTokenAddress": "0x4200000000000000000000000000000000000006",
    "dstTokenAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "amount": "125000000000000",
    "walletAddress": "0x0b07ab58f72d13150Fcd119700aae76d9D161138"
  }' | head -n 20

echo ""
echo "✅ Basic tests completed!"
echo ""
echo "⚠️  To test actual swap with ~$0.50 worth of Base ETH:"
echo "curl -X POST '$BASE_URL/api/fusion/swap/execute' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"srcChainId\": 8453,"
echo "    \"dstChainId\": 137,"
echo "    \"srcTokenAddress\": \"0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE\","
echo "    \"dstTokenAddress\": \"0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174\","
echo "    \"amount\": \"125000000000000\","
echo "    \"walletAddress\": \"0x0b07ab58f72d13150Fcd119700aae76d9D161138\","
echo "    \"receiverAddress\": \"0x0b07ab58f72d13150Fcd119700aae76d9D161138\""
echo "  }'"