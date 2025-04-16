import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') }); // Explicitly load .env.local

import { describe, it, expect, jest } from '@jest/globals'; // Add Jest imports
import { POST } from '../../app/api/completion/route';
import { NextRequest } from 'next/server';
import { FLAGS } from '@/lib/types';

// Determine required env vars
const requiredEnvVars = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];
if (process.env.OPENAI_BASE_URL?.includes("openrouter")) {
  requiredEnvVars.push('SITE_URL', 'APP_NAME');
}

// Log the values Jest sees *before* checking them
console.log('--- Environment Variables for Completion Test ---');
requiredEnvVars.forEach(varName => {
  console.log(`${varName}: ${process.env[varName] ? 'Loaded' : 'MISSING or empty'}`);
});
console.log('-----------------------------------------------');

const hasAllEnvVars = requiredEnvVars.every(varName => process.env[varName]);

// Skip tests if required env vars are missing
const describeIfApiReady = hasAllEnvVars ? describe : describe.skip;

describeIfApiReady('/api/completion Integration Test', () => {
  // Increase timeout for API calls
  jest.setTimeout(30000); // 30 seconds

  it('should return a streaming text response for a valid request', async () => {
    const payload = {
      prompt: 'Write a very short sentence about testing.',
      bg: 'Integration testing background.',
      flag: FLAGS.COPILOT, // Use one of the valid flags
    };

    // Simulate a POST request with JSON body
    const request = new NextRequest('http://localhost/api/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const response = await POST(request);

    // Assertions
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream'); // Expect SSE stream

    // Try reading some text from the stream to confirm it works
    const streamText = await response.text(); 
    expect(streamText).toBeTruthy(); // Check if we got any text back
    expect(typeof streamText).toBe('string');
    expect(streamText.length).toBeGreaterThan(5); // Expect at least a few chars/words

    console.log(`Received streamed text snippet: "${streamText.substring(0, 100)}..."`);
  });

   it('should handle summarizer flag', async () => {
    const payload = {
      prompt: 'This is a longer piece of text that requires summarization. It discusses various aspects of software development and testing methodologies.',
      bg: '', // No background for summarizer typically
      flag: FLAGS.SUMMERIZER,
    };

    const request = new NextRequest('http://localhost/api/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const streamText = await response.text();
    expect(streamText).toBeTruthy();
    expect(streamText.length).toBeGreaterThan(5);
    console.log(`Received summarizer text snippet: "${streamText.substring(0, 100)}..."`);
  });
}); 