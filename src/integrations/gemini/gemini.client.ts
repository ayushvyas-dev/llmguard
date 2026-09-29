import { GoogleGenAI } from '@google/genai';
import { config } from '../../config/env.js';

export const geminiClient = new GoogleGenAI({
  apiKey: config.GEMINI_API_KEY || 'mock-gemini-key',
});
