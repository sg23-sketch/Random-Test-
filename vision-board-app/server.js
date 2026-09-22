import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Resolves ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN / `ant auth login`) from
// the environment. Never send the key to the browser — this endpoint is the
// only thing that talks to Anthropic.
const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';

const BreakdownSchema = z.object({
  goalStatement: z.string().describe('A concrete goal statement ending with the target quarter'),
  metricHint: z.string().nullable().describe('The key number/metric detected in the description, or null'),
  milestones: z
    .array(
      z.object({
        text: z.string().describe('A concrete, actionable milestone'),
        percentThroughQuarter: z
          .number()
          .min(0)
          .max(100)
          .describe('How far through the quarter this milestone should land, e.g. 25/50/75/100'),
      }),
    )
    .length(4),
});

app.post('/api/breakdown', async (req, res) => {
  const { title, desc, quarterLabel } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return res.status(401).json({ error: 'No ANTHROPIC_API_KEY configured on the server (see .env.example)' });
  }

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: zodOutputFormat(BreakdownSchema),
      },
      system:
        'You turn one personal or professional goal into a concrete, motivating quarterly plan. ' +
        'Always return exactly 4 milestones spaced roughly evenly across the quarter (around 25/50/75/100% through it). ' +
        'Milestones must be concrete and actionable, never vague filler. If the description names a number ' +
        '(a dollar amount, distance, page/book count, etc.), use that exact number in the plan.',
      messages: [
        {
          role: 'user',
          content: `Goal title: ${title}\nDescription: ${desc || '(no additional description given)'}\nTarget quarter: ${quarterLabel}`,
        },
      ],
    });

    if (!response.parsed_output) {
      return res.status(502).json({ error: 'Model response did not parse as valid JSON' });
    }
    res.json({ source: 'llm', model: MODEL, ...response.parsed_output });
  } catch (err) {
    console.error('breakdown generation failed:', err);
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(401).json({ error: 'Invalid or missing ANTHROPIC_API_KEY on the server' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Rate limited by the Claude API, try again shortly' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(err.status || 502).json({ error: err.message });
    }
    res.status(500).json({ error: 'breakdown generation failed', detail: err?.message });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`Vision board app + API listening on http://localhost:${PORT}`);
});
