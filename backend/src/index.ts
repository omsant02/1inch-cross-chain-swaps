import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Debug environment loading
console.log('Environment variables loaded:');
console.log('INCH_API_KEY exists:', !!process.env.INCH_API_KEY);
console.log('INCH_API_KEY length:', process.env.INCH_API_KEY?.length || 0);

// Import routes after env is loaded
import fusionRoutes from './routes/fusion-routes';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Basic health check route
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running!', timestamp: new Date().toISOString() });
});

// Test route to verify 1inch API key
app.get('/test-api', (req, res) => {
  const apiKey = process.env.INCH_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'INCH_API_KEY not configured' });
  }
  res.json({ message: 'API key is configured', keyLength: apiKey.length });
});

// Fusion+ API routes
app.use('/api/fusion', fusionRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Fusion+ API: http://localhost:${PORT}/api/fusion`);
});