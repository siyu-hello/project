import 'reflect-metadata';
import { Controller, All, Req, Res, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DomainError } from './security.mjs';

export async function createApp(service, { corsOrigin = 'http://localhost:5173', logger = false } = {}) {
  class ApiController {
    async route(req, res) {
      // Never log request bodies, headers, tokens, provider URLs or exceptions.
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const path = req.path.replace(/\/$/, '') || '/';
        const body = req.body ?? {};
        if (req.method === 'GET' && path === '/health') return res.json({ status: 'ok' });
        if (req.method === 'POST' && path === '/auth/admin/login') return res.json(await service.loginAdmin(body, req.ip));
        if (req.method === 'POST' && path === '/auth/wechat/login') return res.json(await service.loginWechat(body, req.ip));
        const header = req.headers.authorization;
        const account = await service.authenticate(typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null);
        if (req.method === 'GET' && path === '/me') return res.json(await service.me(account));
        if (req.method === 'POST' && path === '/auth/password') return res.json(await service.changePassword(account, body, req.ip));
        if (req.method === 'POST' && path === '/auth/logout') { await service.store.deleteSession(header.slice(7)); return res.json({ loggedOut: true }); }
        if (req.method === 'GET' && path === '/students/me/home') return res.json(await service.home(account));
        const student = path.match(/^\/students\/([^/]+)\/home$/);
        if (req.method === 'GET' && student) return res.json(await service.home(account, student[1]));
        if (req.method === 'GET' && path === '/admin/accounts') return res.json(await service.listAccounts(account));
        if (req.method === 'POST' && path === '/admin/roster/import') return res.json(await service.importRoster(account, body));
        if (req.method === 'POST' && path === '/admin/accounts') return res.status(201).json(await service.createAccount(account, body));
        const target = path.match(/^\/admin\/accounts\/([^/]+)$/);
        if (req.method === 'PATCH' && target) return res.json(await service.updateAccount(account, target[1], body));
        if (req.method === 'GET' && path === '/admin/audits') return res.json(await service.audits(account));
        throw new DomainError(404, '接口不存在');
      } catch (error) {
        return res.status(error instanceof DomainError ? error.status : 500).json({ message: error instanceof DomainError ? error.message : '服务暂时不可用', ...(error instanceof DomainError && error.details ? { details: error.details } : {}) });
      }
    }
  }
  // Explicit decorators keep native Node 24 execution and avoid a transpiler runtime.
  Controller()(ApiController);
  All('{*path}')(ApiController.prototype, 'route', Object.getOwnPropertyDescriptor(ApiController.prototype, 'route'));
  Req()(ApiController.prototype, 'route', 0); Res()(ApiController.prototype, 'route', 1);
  class ApiModule {}
  Module({ controllers: [ApiController] })(ApiModule);
  const app = await NestFactory.create(ApiModule, { logger, bodyParser: false });
  const { default: express } = await import('express');
  app.use(express.json({ limit: '96kb' }));
  app.enableCors({ origin: corsOrigin, methods: ['GET', 'POST', 'PATCH'], allowedHeaders: ['Content-Type', 'Authorization'] });
  app.use((error, req, res, next) => { if (error) return res.status(400).json({ message: '请求格式错误或内容过大' }); next(); });
  await app.init();
  return app;
}
