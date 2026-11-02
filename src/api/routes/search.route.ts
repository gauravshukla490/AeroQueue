import { Router } from 'express';
import { SearchService } from '../../services/search.service.js';

export const searchRouter = Router();

searchRouter.get('/', async (req, res, next) => {
  try {
    const { q, sender, recipient, status, from, size } = req.query;

    const results = await SearchService.searchEmails({
      query: q as string | undefined,
      senderEmail: sender as string | undefined,
      recipient: recipient as string | undefined,
      status: status as string | undefined,
      from: from ? parseInt(from as string, 10) : 0,
      size: size ? parseInt(size as string, 10) : 20,
    });

    res.json({
      success: true,
      ...results,
    });
  } catch (err) {
    next(err);
  }
});
