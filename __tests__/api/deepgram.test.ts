import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') }); // Explicitly load .env.local

import { describe, it, expect, jest } from '@jest/globals'; // Add Jest imports
import { GET } from '../../app/api/deepgram/route';
import { NextRequest } from 'next/server';

// Skip tests if the API key is not provided
const describeIfApiKey = process.env.DEEPGRAM_API_KEY ? describe : describe.skip;

describeIfApiKey('/api/deepgram Integration Test', () => {
  // Increase timeout for network requests
  jest.setTimeout(20000); // 20 seconds

  it('should return a temporary API key from Deepgram', async () => {
    // Simulate a basic request object (URL might not be strictly needed by the handler)
    const request = new NextRequest('http://localhost/api/deepgram');

    const response = await GET(request);
    const data = await response.json();

    // Assertions
    expect(response.status).toBe(200);
    expect(data).toHaveProperty('key');
    expect(typeof data.key).toBe('string');
    expect(data.key.length).toBeGreaterThan(10); // Basic sanity check for key format
    expect(data).toHaveProperty('api_key_id');
    expect(data).toHaveProperty('comment', 'Temporary API key');
    expect(data).toHaveProperty('scopes');
    expect(data.scopes).toContain('usage:write');
    expect(data).toHaveProperty('tags');
    expect(data.tags).toContain('next.js');
    expect(data).toHaveProperty('created');
    expect(data).toHaveProperty('expiration_date');

    // Optional: Check if expiration is roughly 10 seconds after creation
    const createdDate = new Date(data.created);
    const expirationDate = new Date(data.expiration_date);
    const diffSeconds = (expirationDate.getTime() - createdDate.getTime()) / 1000;
    expect(diffSeconds).toBeCloseTo(10, 0); // Check if close to 10 seconds (allow small variance)
  });
}); 