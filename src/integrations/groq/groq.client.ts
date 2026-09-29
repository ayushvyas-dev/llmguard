import Groq from 'groq-sdk';
import { config } from '../../config/env.js';

export const groqClient = new Groq({
  apiKey: config.GROQ_API_KEY || 'gsk_mock_api_key_placeholder',
});
