import 'reflect-metadata';
import { Controller, All, Req, Res, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DomainError, authorize } from './security.mjs';
import { saveImage, UPLOAD_DIR } from './uploads.mjs';

export async function createApp(services, { corsOrigin = 'http://localhost:5173', logger = false } = {}) {
  const { identity, activities, registrations, attendance, ledger, gifts } = services;
  class ApiController {
    async route(req, res) {
      // Never log request bodies, headers, tokens, provider URLs or exceptions.
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const path = req.path.replace(/\/$/, '') || '/';
        const method = req.method;
        const body = req.body ?? {};
        const query = req.query ?? {};
        if (method === 'GET' && path === '/health') return res.json({ status: 'ok' });
        if (method === 'POST' && path === '/auth/admin/login') return res.json(await identity.loginAdmin(body, req.ip));
        if (method === 'POST' && path === '/auth/student/login') return res.json(await identity.loginPassword(body, req.ip));
        if (method === 'POST' && path === '/auth/wechat/login') return res.json(await identity.loginWechat(body, req.ip));

        const header = req.headers.authorization;
        const account = await identity.authenticate(typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null);

        if (method === 'GET' && path === '/me') return res.json(await identity.me(account));
        if (method === 'POST' && path === '/uploads') {
          authorize(account, ['ADMIN', 'PUBLISHER']);
          if (!Buffer.isBuffer(req.body)) throw new DomainError(400, '请上传图片文件');
          return res.status(201).json({ url: await saveImage(req.body, req.headers['content-type']) });
        }
        if (method === 'POST' && path === '/auth/password') return res.json(await identity.changePassword(account, body, req.ip));
        if (method === 'POST' && path === '/auth/logout') { await identity.store.deleteSession(header.slice(7)); return res.json({ loggedOut: true }); }
        if (method === 'GET' && path === '/students/me/home') return res.json(await identity.home(account));
        if (method === 'GET' && path === '/students/me/registrations') return res.set('Cache-Control', 'no-store').json(await registrations.listMine(account));
        if (method === 'GET' && path === '/students/me/ledger') return res.json(await ledger.entries(account, query.page));
        if (method === 'GET' && path === '/students/me/orders') return res.json(await gifts.myOrders(account));
        const studentHome = path.match(/^\/students\/([^/]+)\/home$/);
        if (method === 'GET' && studentHome) return res.json(await identity.home(account, studentHome[1]));

        if (method === 'GET' && path === '/activities') return res.set('Cache-Control', 'no-store').json(await activities.list(account, query));
        if (method === 'GET' && path === '/activities/targets') return res.json(await activities.targets(account));
        if (method === 'GET' && path === '/activities/mine') return res.json(await activities.listMine(account));
        if (method === 'POST' && path === '/activities') return res.status(201).json(await activities.create(account, body));
        const cancelActivity = path.match(/^\/activities\/([^/]+)\/cancel$/);
        if (method === 'POST' && cancelActivity) return res.json(await activities.cancel(account, cancelActivity[1], body));
        const checkinCode = path.match(/^\/activities\/([^/]+)\/checkin-code$/);
        if (method === 'GET' && checkinCode) return res.json(await activities.checkinCode(account, checkinCode[1]));
        const checkoutCode = path.match(/^\/activities\/([^/]+)\/checkout-code$/);
        if (method === 'GET' && checkoutCode) return res.json(await activities.checkoutCode(account, checkoutCode[1]));
        const checkin = path.match(/^\/activities\/([^/]+)\/checkin$/);
        if (method === 'POST' && checkin) return res.json(await attendance.checkin(account, checkin[1], body));
        const checkout = path.match(/^\/activities\/([^/]+)\/checkout$/);
        if (method === 'POST' && checkout) return res.json(await attendance.checkout(account, checkout[1], body));
        const registration = path.match(/^\/activities\/([^/]+)\/registrations$/);
        if (registration && method === 'POST') return res.status(201).json(await registrations.register(account, registration[1]));
        if (registration && method === 'DELETE') return res.json(await registrations.cancel(account, registration[1]));
        const activity = path.match(/^\/activities\/([^/]+)$/);
        if (method === 'GET' && activity) return res.json(await activities.detail(account, activity[1]));
        if (method === 'PATCH' && activity) return res.json(await activities.update(account, activity[1], body));

        if (method === 'GET' && path === '/gifts') return res.json(await gifts.list(account));
        const redeemGift = path.match(/^\/gifts\/([^/]+)\/redeem$/);
        if (method === 'POST' && redeemGift) return res.status(201).json(await gifts.redeem(account, redeemGift[1], body));
        if (method === 'POST' && path === '/redeemer/redeem') return res.json(await gifts.redeemByCode(account, body));

        if (method === 'GET' && path === '/admin/activities') return res.json(await activities.reviewQueue(account));
        const reviewActivity = path.match(/^\/admin\/activities\/([^/]+)\/review$/);
        if (method === 'POST' && reviewActivity) return res.json(await activities.review(account, reviewActivity[1], body));
        if (method === 'GET' && path === '/admin/gifts') return res.json(await gifts.adminList(account));
        if (method === 'POST' && path === '/admin/gifts') return res.status(201).json(await gifts.create(account, body));
        const adminGift = path.match(/^\/admin\/gifts\/([^/]+)$/);
        if (method === 'PATCH' && adminGift) return res.json(await gifts.update(account, adminGift[1], body));

        if (method === 'GET' && path === '/admin/accounts') return res.json(await identity.listAccounts(account));
        if (method === 'POST' && path === '/admin/roster/import') return res.json(await identity.importRoster(account, body));
        if (method === 'POST' && path === '/admin/accounts') return res.status(201).json(await identity.createAccount(account, body));
        const target = path.match(/^\/admin\/accounts\/([^/]+)$/);
        if (method === 'PATCH' && target) return res.json(await identity.updateAccount(account, target[1], body));
        if (method === 'GET' && path === '/admin/audits') return res.json(await identity.audits(account));
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
  app.use('/uploads', express.static(UPLOAD_DIR, { index: false, maxAge: '30d', immutable: true }));
  app.use('/uploads', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], limit: '4mb' }));
  app.use(express.json({ limit: '96kb' }));
  app.enableCors({ origin: corsOrigin, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] });
  app.use((error, req, res, next) => { if (error) return res.status(400).json({ message: '请求格式错误或内容过大' }); next(); });
  await app.init();
  return app;
}