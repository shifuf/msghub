import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

type BackupConfig = { enabled: boolean; intervalHours: number; retentionCount: number; verifyAfterBackup: boolean };
const DEFAULT_CONFIG: BackupConfig = { enabled: false, intervalHours: 24, retentionCount: 14, verifyAfterBackup: true };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const commit = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{7,64}$/i.test(value) ? value : null;
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const code = (value: unknown) => typeof value === 'string' && /^[A-Z_]{1,80}$/.test(value) ? value : null;

@Injectable()
export class OperationsService {
  private readonly projectRoot = path.resolve(process.env.OPERATIONS_PROJECT_ROOT || process.cwd());
  private readonly backupRoot = path.resolve(process.env.OPERATIONS_BACKUPS_ROOT || path.join(this.projectRoot, 'data', 'backups'));
  private readonly controlRoot = path.resolve(process.env.OPERATIONS_BACKUP_CONTROL_ROOT || path.join(this.backupRoot, 'control'));
  constructor(private prisma: PrismaService) {}

  private async assertSafePath(target: string, create = false) {
    if (target !== this.backupRoot && !target.startsWith(this.backupRoot + path.sep)) throw new BadRequestException('备份目录无效');
    if (create && target !== this.controlRoot && !target.startsWith(this.controlRoot + path.sep)) throw new BadRequestException('只有备份控制目录允许写入');
    const relative = path.relative(this.projectRoot, target);
    let current = this.projectRoot;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      let stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!stat && create) { await fs.mkdir(current, { mode: 0o700 }); stat = await fs.lstat(current); }
      if (!stat) return false;
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BadRequestException('备份目录不可使用符号链接');
      if (create && (current === this.controlRoot || current.startsWith(this.controlRoot + path.sep))) await fs.chmod(current, 0o700);
    }
    return true;
  }

  private async readJson(file: string): Promise<any> {
    const parent = path.dirname(file);
    if (!await this.assertSafePath(parent)) return null;
    const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 128000) return null;
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
  }

  private async writeJson(file: string, data: unknown) {
    if (file !== this.controlRoot && !file.startsWith(this.controlRoot + path.sep)) throw new BadRequestException('API 只允许写入备份控制目录');
    await this.assertSafePath(path.dirname(file), true);
    const existing = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing?.isSymbolicLink() || existing && !existing.isFile()) throw new BadRequestException('备份文件路径无效');
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
    try { await fs.rename(temporary, file); await fs.chmod(file, 0o600); }
    finally { await fs.unlink(temporary).catch(() => undefined); }
  }

  private async config(): Promise<BackupConfig> {
    const raw = await this.readJson(path.join(this.controlRoot, 'config.json'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_CONFIG };
    return { enabled: raw.enabled === true, intervalHours: Number.isInteger(raw.intervalHours) && raw.intervalHours >= 1 && raw.intervalHours <= 168 ? raw.intervalHours : 24,
      retentionCount: Number.isInteger(raw.retentionCount) && raw.retentionCount >= 1 && raw.retentionCount <= 365 ? raw.retentionCount : 14, verifyAfterBackup: raw.verifyAfterBackup !== false };
  }

  private async runner() {
    const raw = await this.readJson(path.join(this.controlRoot, 'runner-status.json'));
    const lastSeenAt = timestamp(raw?.lastSeenAt);
    const fresh = lastSeenAt !== null && Date.now() - Date.parse(lastSeenAt) <= 90000 && Date.parse(lastSeenAt) - Date.now() <= 30000;
    return { status: fresh && ['ready', 'running'].includes(raw?.status) ? raw.status as string : 'unavailable', lastSeenAt, keyConfigured: raw?.keyConfigured === true };
  }

  private async jobs() {
    const directory = path.join(this.controlRoot, 'jobs');
    if (!await this.assertSafePath(directory)) return [];
    const files = (await fs.readdir(directory)).filter(file => UUID.test(file.replace(/\.json$/, '')) && file.endsWith('.json')).slice(-1000);
    const entries = await Promise.all(files.map(file => this.readJson(path.join(directory, file))));
    return entries.filter(raw => raw && UUID.test(raw.id) && ['backup', 'verify'].includes(raw.action)).map(raw => ({ id: raw.id as string, action: raw.action as string,
      backupId: UUID.test(raw.backupId) ? raw.backupId as string : null,
      status: ['pending', 'running', 'success', 'failed', 'uncertain'].includes(raw.status) ? raw.status as string : 'unknown', createdAt: timestamp(raw.createdAt), finishedAt: timestamp(raw.finishedAt), errorCode: code(raw.errorCode) }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  private async backups() {
    const directory = path.join(this.backupRoot, 'archives');
    if (!await this.assertSafePath(directory)) return [];
    const names = (await fs.readdir(directory)).filter(name => UUID.test(name)).slice(-365);
    const entries = await Promise.all(names.map(id => this.readJson(path.join(directory, id, 'manifest.json'))));
    return entries.filter(raw => raw && UUID.test(raw.id)).map(raw => ({ id: raw.id as string, createdAt: timestamp(raw.createdAt), appCommit: commit(raw.appCommit),
      status: ['complete', 'failed'].includes(raw.status) ? raw.status as string : 'unknown', encrypted: raw.encrypted === true,
      containsSecrets: true, consistency: 'online-non-atomic', sizeBytes: Number.isSafeInteger(raw.sizeBytes) && raw.sizeBytes >= 0 ? raw.sizeBytes : null,
      verification: ['passed', 'failed', 'not_verified'].includes(raw.verification) ? raw.verification as string : 'not_verified', verifiedAt: timestamp(raw.verifiedAt), errorCode: code(raw.errorCode),
      restoredTables: Number.isInteger(raw.restoredTables) && raw.restoredTables >= 0 ? raw.restoredTables : null,
    })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async backupStatus() {
    const [runner, config, backups, jobs] = await Promise.all([this.runner(), this.config(), this.backups(), this.jobs()]);
    return { available: runner.status !== 'unavailable', runner, config, backups, jobs: jobs.slice(0, 50) };
  }

  async updateBackupConfig(partial: Partial<BackupConfig>) {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial) || Object.keys(partial).some(key => !Object.keys(DEFAULT_CONFIG).includes(key))) throw new BadRequestException('备份配置字段无效');
    for (const key of ['enabled', 'verifyAfterBackup'] as const) if (partial[key] !== undefined && typeof partial[key] !== 'boolean') throw new BadRequestException('备份配置必须使用布尔值');
    if (partial.intervalHours !== undefined && (!Number.isInteger(partial.intervalHours) || partial.intervalHours < 1 || partial.intervalHours > 168)) throw new BadRequestException('备份间隔须为 1–168 小时');
    if (partial.retentionCount !== undefined && (!Number.isInteger(partial.retentionCount) || partial.retentionCount < 1 || partial.retentionCount > 365)) throw new BadRequestException('保留份数须为 1–365');
    const config = { ...await this.config(), ...partial };
    if (config.enabled) { const runner = await this.runner(); if (runner.status === 'unavailable' || !runner.keyConfigured) throw new ServiceUnavailableException('完整备份运行器或加密密钥尚未就绪'); }
    await this.writeJson(path.join(this.controlRoot, 'config.json'), config);
    return config;
  }

  async runBackup() { return this.request('backup'); }

  async verifyBackup(backupId: string) {
    if (typeof backupId !== 'string' || !UUID.test(backupId)) throw new BadRequestException('备份 ID 无效');
    const manifest = await this.readJson(path.join(this.backupRoot, 'archives', backupId, 'manifest.json'));
    if (!manifest || manifest.id !== backupId || manifest.status !== 'complete' || manifest.encrypted !== true) throw new NotFoundException('完整加密备份不存在');
    return this.request('verify', backupId);
  }

  private async request(action: 'backup' | 'verify', backupId?: string) {
    const config = await this.config();
    if (!config.enabled) throw new BadRequestException('完整备份尚未启用');
    const runner = await this.runner();
    if (runner.status === 'unavailable' || !runner.keyConfigured) throw new ServiceUnavailableException('完整备份运行器尚未就绪');
    await this.assertSafePath(this.controlRoot, true);
    const lockFile = path.join(this.controlRoot, 'request.lock');
    let lock: fs.FileHandle;
    try { lock = await fs.open(lockFile, 'wx', 0o600); }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.lstat(lockFile).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs > 60_000) {
        await fs.unlink(lockFile).catch(() => undefined);
        try { lock = await fs.open(lockFile, 'wx', 0o600); }
        catch (retryError: any) { if (retryError.code === 'EEXIST') throw new ConflictException('已有备份请求正在提交'); throw retryError; }
      } else throw new ConflictException('已有备份请求正在提交');
    }
    try {
      if ((await this.jobs()).some(job => ['pending', 'running', 'uncertain'].includes(job.status))) throw new ConflictException('已有备份或验证任务等待执行或正在进行');
      const id = randomUUID();
      const job = { id, action, ...(backupId ? { backupId } : {}), status: 'pending', createdAt: new Date().toISOString() };
      await this.writeJson(path.join(this.controlRoot, 'jobs', `${id}.json`), job);
      try { await this.writeJson(path.join(this.controlRoot, 'requests', `${id}.request`), { version: 1, id, action, ...(backupId ? { backupId } : {}) }); }
      catch (error) { await this.writeJson(path.join(this.controlRoot, 'jobs', `${id}.json`), { ...job, status: 'failed', errorCode: 'REQUEST_WRITE_FAILED', finishedAt: new Date().toISOString() }); throw error; }
      return job;
    } finally { await lock.close(); await fs.unlink(lockFile); }
  }

  async version() {
    let migrationVersion: string | null = null;
    let migrationStatus = 'up';
    try {
      const rows = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1`;
      migrationVersion = typeof rows[0]?.migration_name === 'string' && /^[\w-]{1,200}$/.test(rows[0].migration_name) ? rows[0].migration_name : null;
    } catch { migrationStatus = 'down'; }
    const raw = await this.readJson(path.join(this.controlRoot, 'deployments.json'));
    const deployments = (Array.isArray(raw) ? raw : []).slice(-20).reverse().map(entry => ({ id: typeof entry?.id === 'string' && /^[\w-]{1,128}$/.test(entry.id) ? entry.id : null,
      commit: commit(entry?.commit), startedAt: timestamp(entry?.startedAt), finishedAt: timestamp(entry?.finishedAt), status: ['success', 'failed', 'running'].includes(entry?.status) ? entry.status : 'unknown' }));
    return { appCommit: commit(process.env.APP_COMMIT), buildTime: timestamp(process.env.BUILD_TIME), migrationVersion, migrationStatus, deployments };
  }
}
