import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { apiKeyService } from '../../src/modules/api-key/api-key.service.js';
import prisma from '../../src/config/database.js';

describe('Audit API — GET /v1/audit-events', () => {
  const mockApiKeyId = 'd8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiKeyService, 'authenticate').mockResolvedValue({
      id: mockApiKeyId,
      name: 'Test Project',
      prefix: 'lg_live_test123',
      isActive: true,
    });
  });

  it('queries audit events with filters and pagination', async () => {
    const eventDate = new Date();
    vi.spyOn(prisma.auditEvent, 'findMany').mockResolvedValue([
      {
        id: 'event_01',
        apiKeyId: mockApiKeyId,
        requestId: 'req_01',
        scanId: 'scan_01',
        type: 'prompt_injection',
        severity: 'high',
        decision: 'block',
        riskScore: 94,
        metadata: null,
        createdAt: eventDate,
      },
    ]);

    const res = await request(app)
      .get('/v1/audit-events?severity=high&decision=block&limit=10')
      .set('Authorization', 'Bearer lg_live_test');

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe('event_01');
    expect(res.body.events[0].severity).toBe('high');
    expect(res.body.events[0].decision).toBe('block');
    expect(res.body.nextCursor).toBeNull();
  });
});
