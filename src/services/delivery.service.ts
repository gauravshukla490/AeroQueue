import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/prisma.js';
import { esClient } from '../lib/elasticsearch.js';
import { EmailJobStatus } from '@prisma/client';

export class DeliveryService {
  private static transporter: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    // Short connection and socket timeouts to prevent indefinite hanging
    connectionTimeout: 10000,
    socketTimeout: 30000,
  });

  /**
   * Dispatches email through SMTP and records audit trail
   */
  public static async sendMail(jobData: {
    emailJobId: string;
    senderId: string;
    senderEmail: string;
    recipient: string;
    subject: string;
    body: string;
  }): Promise<{ messageId: string; response: string }> {
    const { emailJobId, senderEmail, recipient, subject, body } = jobData;

    logger.info({ emailJobId, recipient }, 'Sending email via SMTP...');

    const info = await this.transporter.sendMail({
      from: senderEmail || env.SMTP_FROM,
      to: recipient,
      subject,
      html: body,
      headers: {
        'X-Job-Id': emailJobId,
      },
    });

    logger.info(
      { emailJobId, recipient, messageId: info.messageId, response: info.response },
      'Email successfully sent via SMTP'
    );

    return {
      messageId: info.messageId,
      response: info.response,
    };
  }

  /**
   * Finalizes email status in PostgreSQL and indexes in Elasticsearch
   */
  public static async markCompleted(
    emailJobId: string,
    result: { messageId: string; response: string }
  ) {
    const now = new Date();

    const [updatedJob] = await prisma.$transaction([
      prisma.emailJob.update({
        where: { id: emailJobId },
        data: {
          status: EmailJobStatus.SENT,
          sentAt: now,
          leaseExpiresAt: null,
          workerId: null,
        },
        include: { sender: true },
      }),
      prisma.deliveryLog.create({
        data: {
          emailJobId,
          status: EmailJobStatus.SENT,
          responsePayload: {
            messageId: result.messageId,
            response: result.response,
          },
        },
      }),
    ]);

    // Index into Elasticsearch asynchronously (non-blocking)
    this.indexToElasticsearch({
      id: updatedJob.id,
      emailJobId: updatedJob.id,
      senderId: updatedJob.senderId,
      senderEmail: updatedJob.sender.email,
      recipient: updatedJob.recipient,
      subject: updatedJob.subject,
      body: updatedJob.body,
      status: EmailJobStatus.SENT,
      attempts: updatedJob.attempts,
      sentAt: now,
      createdAt: updatedJob.createdAt,
    }).catch((err) => {
      logger.warn({ err, emailJobId }, 'Background Elasticsearch indexing skipped or failed');
    });

    return updatedJob;
  }

  /**
   * Finalizes failure status in PostgreSQL and registers failure log
   */
  public static async markFailed(
    emailJobId: string,
    errorMessage: string,
    isPermanent: boolean
  ) {
    const status = isPermanent ? EmailJobStatus.FAILED : EmailJobStatus.QUEUED;

    const [updatedJob] = await prisma.$transaction([
      prisma.emailJob.update({
        where: { id: emailJobId },
        data: {
          status,
          lastError: errorMessage,
          leaseExpiresAt: null,
          workerId: null,
        },
        include: { sender: true },
      }),
      prisma.deliveryLog.create({
        data: {
          emailJobId,
          status,
          errorMessage,
        },
      }),
    ]);

    if (isPermanent) {
      this.indexToElasticsearch({
        id: updatedJob.id,
        emailJobId: updatedJob.id,
        senderId: updatedJob.senderId,
        senderEmail: updatedJob.sender.email,
        recipient: updatedJob.recipient,
        subject: updatedJob.subject,
        body: updatedJob.body,
        status: EmailJobStatus.FAILED,
        attempts: updatedJob.attempts,
        errorMessage,
        createdAt: updatedJob.createdAt,
      }).catch((err) => {
        logger.warn({ err, emailJobId }, 'Background Elasticsearch indexing failed for failed job');
      });
    }

    return updatedJob;
  }

  /**
   * Index audit document into Elasticsearch
   */
  public static async indexToElasticsearch(doc: Record<string, unknown>) {
    try {
      await esClient.index({
        index: env.ELASTICSEARCH_INDEX,
        id: doc.id as string,
        document: doc,
      });
    } catch (err) {
      logger.error({ err, id: doc.id }, 'Elasticsearch indexing error');
    }
  }
}
