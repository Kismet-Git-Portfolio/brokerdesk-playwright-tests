// Credentials come from env vars, with demo-only defaults for the local mock app.
export const creds = {
  user: process.env.DEMO_USER || 'demo.user@example.com',
  password: process.env.DEMO_PASSWORD || 'Demo#Pass123',
};
