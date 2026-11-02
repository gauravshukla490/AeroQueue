import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { redisClient } from '../../lib/redis.js';
import { esClient } from '../../lib/elasticsearch.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  const health: Record<string, unknown> = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {},
  };

  // Check PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1`;
    (health.services as Record<string, unknown>).postgres = 'up';
  } catch (err: unknown) {
    (health.services as Record<string, unknown>).postgres = 'down';
    health.status = 'degraded';
  }

  // Check Redis
  try {
    const ping = await redisClient.ping();
    (health.services as Record<string, unknown>).redis = ping === 'PONG' ? 'up' : 'down';
  } catch (err: unknown) {
    (health.services as Record<string, unknown>).redis = 'down';
    health.status = 'degraded';
  }

  // Check Elasticsearch
  try {
    const esPing = await esClient.ping();
    (health.services as Record<string, unknown>).elasticsearch = esPing ? 'up' : 'down';
  } catch (err: unknown) {
    (health.services as Record<string, unknown>).elasticsearch = 'down';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
