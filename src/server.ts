import app from './app.js';

const server = app.listen(5000, () => {
  console.log(`Server is running on http://localhost:5000/api/v1`);
});
