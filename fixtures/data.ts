// Unique, random test data for every run so tests never collide.
const rand = () => Math.random().toString(36).slice(2, 8);
export const uniq = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${rand()}`;
export const applicant = (i = 0) => ({ name: `Test Applicant ${i} ${rand()}`, email: `${uniq('applicant' + i)}@example.com` });
