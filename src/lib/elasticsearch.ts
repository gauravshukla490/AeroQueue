import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const esClient = new Client({
  node: env.ELASTICSEARCH_NODE,
});

export async function initElasticsearchIndex() {
  try {
    const exists = await esClient.indices.exists({
      index: env.ELASTICSEARCH_INDEX,
    });

    if (!exists) {
      await esClient.indices.create({
        index: env.ELASTICSEARCH_INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            emailJobId: { type: 'keyword' },
            senderId: { type: 'keyword' },
            senderEmail: { type: 'keyword' },
            recipient: { type: 'keyword' },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            attempts: { type: 'integer' },
            errorMessage: { type: 'text' },
            sentAt: { type: 'date' },
            createdAt: { type: 'date' },
          },
        },
      });
      logger.info(`Elasticsearch index '${env.ELASTICSEARCH_INDEX}' created successfully`);
    } else {
      logger.info(`Elasticsearch index '${env.ELASTICSEARCH_INDEX}' already exists`);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Elasticsearch index');
  }
}
