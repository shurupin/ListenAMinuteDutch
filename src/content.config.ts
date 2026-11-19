import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const token = z.object({
  t: z.string(),
  ws: z.boolean(),
  lemma: z.string().optional(),
  pos: z.string().optional(),
  key: z.string().optional(),
  zipf: z.number().optional(),
  syn: z.enum(['S', 'P', 'O', 'A', 'D']).optional(), // member of the sentence
  m: z.number().optional(), // member id: adjacent tokens with the same id share one underline
});

const span = z.tuple([z.number(), z.number()]);
const sentence = z.object({
  en: z.string().optional(),
  ru: z.string().optional(),
  tokens: z.array(token),
  // word correspondences (align.txt): character spans of the translation words, and units of
  // [Dutch token indices, English word indices, Russian word indices]
  enW: z.array(span).optional(),
  ruW: z.array(span).optional(),
  al: z.array(z.tuple([z.array(z.number()), z.array(z.number()), z.array(z.number())])).optional(),
});

// One narration of the text. Timings live here, not in the tokens, because they differ per voice.
const voice = z.object({
  id: z.string(),
  name: z.string(),
  gender: z.string(), // 'f' | 'm' | '' (recording)
  accent: z.string(), // 'NL' | 'BE' | ''
  source: z.string(),
  audio: z.string(),
  duration: z.number(),
  times: z.array(z.number()), // [start, end] per word token, document order
  sents: z.array(z.number()), // [start, end] per sentence
  clips: z.record(z.string(), z.string()), // word form -> isolated word audio
});

const lessons = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/lessons' }),
  schema: z.object({
    title: z.string(),
    level: z.enum(['A1', 'A2']),
    topic: z.string(),
    order: z.number(),
    voices: z.array(voice).min(1),
    paragraphs: z.array(
      z.object({
        en: z.string().optional(),
        ru: z.string().optional(),
        sentences: z.array(sentence),
      }),
    ),
  }),
});

export const collections = { lessons };

export type Lesson = z.infer<typeof lessons.schema>;
export type Token = z.infer<typeof token>;
export type Voice = z.infer<typeof voice>;
