import {resolve} from 'node:path';
import {cashValidateBaseline_} from './model.js';
import type {Config, Baseline} from './types.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const demo = env.DEMO_MODE === 'true', port = Number(env.PORT || 3000);
  const origin = new URL(env.APP_ORIGIN || `http://localhost:${port}`).origin;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT tidak valid.');
  if (!demo && !origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error('Gunakan HTTPS untuk hosting.');
  const required = (name: string) => {
    const value = env[name];
    if (!value || value.startsWith('replace_')) throw new Error(`Isi ${name} di konfigurasi privat. Jalankan npm run demo untuk uji tanpa Google.`);
    return value;
  };
  const id = (name: string) => demo ? `demo_${name}` : required(name);
  const sheetId = (name: string, fallback: number) => {
    const value = demo ? fallback : Number(required(name));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} tidak valid.`);
    return value;
  };
  const baseline = (name: string, unknown: boolean): Baseline => cashValidateBaseline_(JSON.parse(required(name)), unknown) as Baseline;
  const cfg: Config = {
    demo, port, origin, stateDir: resolve(env.STATE_DIR || (demo ? '.state-demo' : '.state')),
    owner: demo ? 'demo@example.test' : required('OWNER_EMAIL').trim().toLowerCase(),
    clientId: demo ? '' : required('GOOGLE_CLIENT_ID'), clientSecret: demo ? '' : required('GOOGLE_CLIENT_SECRET'),
    encryptionKey: demo ? '' : required('TOKEN_ENCRYPTION_KEY'), automatic: demo || env.AUTO_PUBLISH_ENABLED === 'true',
    sourceId: id('SOURCE_SPREADSHEET_ID'), reportId: id('REPORT_SPREADSHEET_ID'), pdfId: id('PUBLIC_PDF_ID'),
    previewId: id('PRIVATE_PREVIEW_PDF_ID'), archiveId: id('ARCHIVE_FOLDER_ID'),
    journalId: sheetId('CASH_JOURNAL_SHEET_ID', 10), phbiId: sheetId('PHBI_SHEET_ID', 20), syncId: sheetId('SYNC_SHEET_ID', 30),
    reportSheetIds: ['REPORT_SUMMARY_SHEET_ID','REPORT_INCOME_SHEET_ID','REPORT_EXPENSE_SHEET_ID'].map((n, i) => sheetId(n, 40 + i)),
    baseline: demo ? {date:'2026-10-08', amount:1000000, holders:{K1:800000,K2:200000,K3:0}} : baseline('REPORT_BASELINE', false),
    phbiBaseline: demo ? {date:'2026-10-08', amount:500000, holders:{K1:500000,K2:null,K3:null}} : baseline('PHBI_REPORT_BASELINE', true)
  };
  if (!demo) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.owner)) throw new Error('OWNER_EMAIL tidak valid.');
    if (Buffer.from(cfg.encryptionKey, 'base64').length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY harus 32 byte base64.');
    if (cfg.sourceId === cfg.reportId || cfg.pdfId === cfg.previewId || new Set([cfg.journalId,cfg.phbiId,cfg.syncId]).size !== 3) throw new Error('Target privat, publik, dan sumber wajib berbeda.');
    if (cfg.baseline.date !== '2026-10-08' || cfg.phbiBaseline.date !== cfg.baseline.date) throw new Error('Saldo pembukaan harus tetap 8 Oktober 2026.');
    if (env.WEB_CONCURRENCY && env.WEB_CONCURRENCY !== '1') throw new Error('Aplikasi ini hanya boleh dijalankan dalam satu proses.');
  }
  return cfg;
}
