import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { apiKeyService } from '../../src/modules/api-key/api-key.service.js';
import prisma from '../../src/config/database.js';

describe('Tool Security API — /v1/tools', () => {
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

  it('POST /v1/tools/validate validates safe tool call', async () => {
    vi.spyOn(prisma.toolPolicy, 'findUnique').mockResolvedValue(null);

    const res = await request(app)
      .post('/v1/tools/validate')
      .set('Authorization', 'Bearer lg_live_test')
      .send({
        tool: 'github.getRepository',
        arguments: { repository: 'company/project' },
      });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.requiresApproval).toBe(false);
    expect(res.body.decision).toBe('allow');
    expect(res.body.riskLevel).toBe('low');
  });

  it('POST /v1/tools/validate flags destructive operation for approval', async () => {
    vi.spyOn(prisma.toolPolicy, 'findUnique').mockResolvedValue(null);

    const res = await request(app)
      .post('/v1/tools/validate')
      .set('Authorization', 'Bearer lg_live_test')
      .send({
        tool: 'github.deleteRepository',
        arguments: { repository: 'company/project' },
      });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(false);
    expect(res.body.requiresApproval).toBe(true);
    expect(res.body.riskLevel).toBe('critical');
    expect(res.body.reason).toContain('Destructive operation');
  });

  it('POST /v1/tools registers a custom policy', async () => {
    const createdAt = new Date();
    vi.spyOn(prisma.toolPolicy, 'upsert').mockResolvedValue({
      id: 'tool_policy_123',
      apiKeyId: mockApiKeyId,
      name: 'github.deleteRepository',
      riskLevel: 'critical',
      enabled: true,
      requiresApproval: true,
      createdAt,
      updatedAt: createdAt,
    });

    const res = await request(app)
      .post('/v1/tools')
      .set('Authorization', 'Bearer lg_live_test')
      .send({
        name: 'github.deleteRepository',
        riskLevel: 'critical',
        enabled: true,
        requiresApproval: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('github.deleteRepository');
    expect(res.body.riskLevel).toBe('critical');
    expect(res.body.requiresApproval).toBe(true);
  });

  it('GET /v1/tools lists registered policies', async () => {
    const createdAt = new Date();
    vi.spyOn(prisma.toolPolicy, 'findMany').mockResolvedValue([
      {
        id: 'tool_123',
        apiKeyId: mockApiKeyId,
        name: 'github.getRepository',
        riskLevel: 'low',
        enabled: true,
        requiresApproval: false,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const res = await request(app)
      .get('/v1/tools')
      .set('Authorization', 'Bearer lg_live_test');

    expect(res.status).toBe(200);
    expect(res.body.tools).toBeInstanceOf(Array);
    expect(res.body.tools[0].name).toBe('github.getRepository');
  });

  it('DELETE /v1/tools/:toolId deletes a policy', async () => {
    vi.spyOn(prisma.toolPolicy, 'findFirst').mockResolvedValue({
      id: 'tool_123',
      apiKeyId: mockApiKeyId,
      name: 'github.getRepository',
      riskLevel: 'low',
      enabled: true,
      requiresApproval: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.spyOn(prisma.toolPolicy, 'delete').mockResolvedValue({
      id: 'tool_123',
      apiKeyId: mockApiKeyId,
      name: 'github.getRepository',
      riskLevel: 'low',
      enabled: true,
      requiresApproval: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .delete('/v1/tools/tool_123')
      .set('Authorization', 'Bearer lg_live_test');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.toolId).toBe('tool_123');
  });
});
