import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { healthRouter } from './routes/health.route.js';
import { senderRouter } from './routes/sender.route.js';
import { campaignRouter } from './routes/campaign.route.js';
import { emailRouter } from './routes/email.route.js';
import { searchRouter } from './routes/search.route.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { initElasticsearchIndex } from '../lib/elasticsearch.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      { method: req.method, path: req.path, status: res.statusCode, duration: `${duration}ms` },
      'HTTP Request'
    );
  });
  next();
});

// Mount Routes
app.use('/api/health', healthRouter);
app.use('/api/senders', senderRouter);
app.use('/api/campaigns', campaignRouter);
app.use('/api/emails', emailRouter);
app.use('/api/search', searchRouter);

// Error Handler
app.use(errorHandler);

// Server startup
app.listen(env.PORT, async () => {
  logger.info(`🚀 ReachInbox API Ingestion Service running on http://localhost:${env.PORT}`);
  // Initialize Elasticsearch index in background
  await initElasticsearchIndex();
});

export default app;
