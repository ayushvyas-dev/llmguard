import Groq from 'groq-sdk';
import { config } from '../../config/env.js';

let client: Groq | undefined;

/** Construct the SDK only when a real API key is configured. */
export function getGroqClient(): Groq {
  const apiKey = config.GROQ_API_KEY.trim();
  if (!apiKey) throw new Error('GROQ_API_KEY_MISSING');
  client ??= new Groq({ apiKey });
  return client;
}
