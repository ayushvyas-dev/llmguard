import { runEvaluation } from './evaluate.js';

console.log('Running LLM Guard evaluation suite...');
try {
  const metrics = await runEvaluation();
  console.log(JSON.stringify(metrics, null, 2));
} catch (error) {
  console.error('Evaluation failed:', error);
  process.exitCode = 1;
}
