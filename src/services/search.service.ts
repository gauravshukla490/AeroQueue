import { esClient } from '../lib/elasticsearch.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export class SearchService {
  public static async searchEmails(params: {
    query?: string;
    senderEmail?: string;
    recipient?: string;
    status?: string;
    from?: number;
    size?: number;
  }) {
    const { query, senderEmail, recipient, status, from = 0, size = 20 } = params;

    const mustClauses: Array<Record<string, unknown>> = [];

    if (query) {
      mustClauses.push({
        multi_match: {
          query,
          fields: ['subject^2', 'body', 'recipient'],
          fuzziness: 'AUTO',
        },
      });
    }

    if (senderEmail) {
      mustClauses.push({ term: { senderEmail } });
    }

    if (recipient) {
      mustClauses.push({ term: { recipient } });
    }

    if (status) {
      mustClauses.push({ term: { status } });
    }

    try {
      const response = await esClient.search({
        index: env.ELASTICSEARCH_INDEX,
        from,
        size,
        query: mustClauses.length > 0 ? { bool: { must: mustClauses } } : { match_all: {} },
        sort: [{ createdAt: { order: 'desc' } }],
      });

      const total =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value || 0;

      const results = response.hits.hits.map((hit) => hit._source);

      return {
        total,
        from,
        size,
        results,
      };
    } catch (err) {
      logger.error({ err }, 'Elasticsearch search query failed');
      return { total: 0, from, size, results: [] };
    }
  }
}
