import { z } from 'zod';
export const querySchema = z.string().trim().min(2).max(120).regex(/^[a-zA-Z0-9 ,'-]+$/, 'Use an English description');
export const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
export function normalizeQuery(input: string): string { return querySchema.parse(input).toLowerCase().replace(/\s+/g,' ').trim(); }
export function filename(description: string, workerId: string, suffix = ''): string {
  const safe = normalizeQuery(description).replace(/[^a-z0-9 -]/g,'').replace(/ +/g,' ').slice(0,80);
  if (!/^\d+\.\d+$/.test(workerId)) throw new Error('Invalid worker ID');
  return `${safe} ${workerId}${suffix ? `-${suffix}` : ''}.png`;
}
export function promptFor(description: string): string {
  return `sks, A clearly recognizable ${normalizeQuery(description)}, complete subject visible, centered composition, adequate margins, Japanese Ukiyo-e woodblock print, colorful flat pigments, bold ink outlines, clean background, traditional Edo period illustration`;
}
export type JobStatus = 'searching'|'queued'|'generating'|'saving'|'completed'|'failed';
