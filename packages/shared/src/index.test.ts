import { describe,it,expect } from 'vitest';
import { normalizeQuery,filename,promptFor } from './index.js';
describe('search and naming',()=>{
  it('normalizes text',()=>expect(normalizeQuery('  Black   DOG ')).toBe('black dog'));
  it('preserves worker ID and suffix',()=>expect(filename('black dog','1.1','abc')).toBe('black dog 1.1-abc.png'));
  it('rejects unsafe input',()=>expect(()=>normalizeQuery('../foo')).toThrow());
  it('prioritizes composition',()=>expect(promptFor('black dog')).toContain('complete subject visible'));
});
