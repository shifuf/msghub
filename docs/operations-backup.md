# 运维与完整灾备

完整灾备使用 Compose 的可选 `backups` profile。只启动 profile 不会启用自动备份；runner 就绪后，还需在后台「运行维护」保存启用配置。默认每 24 小时一次、保留 14 份、备份后自动恢复验证。

## 目录和权限

生产项目根目录固定为 `/www/wwwroot/msg`。以下路径都位于项目内：

| 宿主机路径 | 用途 | API 权限 | runner 权限 |
| --- | --- | --- | --- |
| `data/backups/control/` | 配置、任务请求、心跳、部署记录 | 读写 | 读写 |
| `data/backups/archives/` | 加密归档和不含凭据的清单 | 只读 | 读写 |
| `data/backups/.work/` | 生成归档的临时数据，任务结束时清理 | 不挂载 | 读写 |
| `data/backup-secrets/identity.txt` | age 私钥 | 不挂载 | Compose secret，只读 |
| `.env`、`docker-compose.yml` | 灾备所需部署配置 | 不挂载 | 只读 |

runner 不挂载 Docker socket、宿主机数据库目录或项目源码，不开放端口。PostgreSQL 和 Redis 备份通过 Compose 内部服务网络获取。恢复验证只在 runner 私有 `/tmp` 中新建临时数据库，通过 Unix socket 访问；不会连接生产数据库进行恢复。验证子进程清除生产数据库和 Redis 的认证变量。

密钥放在 `data/backup-secrets`，与 API 可见的归档目录分开。不要将 age identity 放入 `data/backups/archives`、提交到 Git 或复制进镜像。`.dockerignore` 排除了 `.env` 和 `data`。

## 首次配置

在 Linux Docker 主机上执行：

```sh
cd /www/wwwroot/msg
umask 077
mkdir -p data/backups/control data/backups/archives data/backups/.work data/backup-secrets
chmod 700 data/backups data/backups/control data/backups/archives data/backups/.work data/backup-secrets
export APP_COMMIT="$(git rev-parse HEAD)"
export BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
docker compose --profile backups build api web backup-runner
```

runner 镜像已安装 `age`、`age-keygen`、PostgreSQL 16 客户端/服务端、Redis 工具、jq、OpenSSL、tar 和 flock。生成密钥不需要在宿主机安装 age；直接使用刚构建的镜像，避免 Compose 在密钥尚不存在时挂载 secret，已有密钥时拒绝覆盖：

若服务器访问 Alpine 官方包源缓慢，可在构建前设置 `ALPINE_MIRROR=https://mirrors.aliyun.com/alpine`；Compose 和镜像验证脚本都会传入这个构建参数。默认仍使用 Alpine 官方包源。

```sh
docker run --rm --network none --read-only \
  --mount type=bind,src=/www/wwwroot/msg/data/backup-secrets,dst=/key-output \
  --entrypoint sh msghub-backup-runner:local -ec \
  'umask 077; test ! -e /key-output/identity.txt; age-keygen -o /key-output/identity.txt'
chmod 600 data/backup-secrets/identity.txt
```

也可以在 Debian/Ubuntu 安装 `apt-get install age`，或在 Alpine 安装 `apk add age`，然后在受限目录执行 `age-keygen -o data/backup-secrets/identity.txt`。应另外保管一份 age identity；只有归档、没有 identity 无法恢复。

在现有 `.env` 中添加以下可选配置，不覆盖 JWT、TOTP、数据库、管理员或渠道凭据：

```dotenv
BACKUP_AGE_IDENTITY_FILE=./data/backup-secrets/identity.txt
BACKUP_VERIFY_TMPFS_SIZE=2g
```

生产 Compose 的 PostgreSQL 账号、数据库名和密码应与 runner 的 `PGUSER`、`PGDATABASE`、`PGPASSWORD` 一致。当前配置沿用项目已有数据库值。Redis 现有 Compose 没有启用认证；如环境已经启用认证，须给 runner 设置相同的 `REDISCLI_AUTH`。不要用修改生产库密码的方式适配备份。

验证 tmpfs 需要同时容纳解密归档、解压数据、临时 PostgreSQL 数据和 Redis RDB，通常需要未压缩数据大小的数倍。根据数据规模和主机可用内存调整 `BACKUP_VERIFY_TMPFS_SIZE`。空间不足将记录失败，不会标为验证通过。

启动服务后检查：

```sh
docker compose --profile backups up -d api web backup-runner
docker compose --profile backups ps backup-runner
docker compose --profile backups exec -T backup-runner \
  jq '{status,lastSeenAt,keyConfigured}' /project/data/backups/control/runner-status.json
```

runner 应显示健康，状态为 `ready`，`keyConfigured` 为 `true`。在后台「运行维护」保存启用配置，点击「立即完整备份」，之后刷新状态，确认任务完成且归档的「校验」为「已通过」。开启自动备份后，首次到期检查会立即创建第一份备份，之后按设定间隔运行。关闭配置后会保留历史归档，停止创建新备份。

## 版本与就绪状态

构建时给 API、Web、runner 都传入 `APP_COMMIT` 和 `BUILD_TIME`。它们被写进镜像环境与 OCI 标签，后台版本页从运行中的 API 镜像读取，并查询数据库最后完成的 Prisma migration。

```sh
export APP_COMMIT="$(git rev-parse HEAD)"
export BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
docker compose --profile backups build api web backup-runner
docker compose --profile backups up -d api web backup-runner
```

不提供有效构建元数据时页面显示「未知」。不要在运行期另行设置一个并未构建进镜像的提交号。渠道配置检查只说明配置可解析，不说明真实消息已送达；数据库、Redis、Worker 的就绪状态单独展示。

`data/backups/control/deployments.json` 可由项目部署脚本原子写入。它是可选记录，缺失时不显示部署列表。每项只读取 `id`、`commit`、`startedAt`、`finishedAt` 和 `status`，状态支持 `running`、`success`、`failed`；不要把密钥或命令输出写入这里。

## 备份内容与恢复验证

每份 `data/backups/archives/<UUID>/` 包含：

- `backup.tar.age`：age 加密的 PostgreSQL custom dump、Redis RDB、`.env`、Compose 文件、运行版本/连接元数据和文件 SHA-256。
- `manifest.json`：创建时间、版本提交、密文 SHA-256、大小、执行状态和验证结果。没有数据库凭据、原始错误诊断或密钥正文。

PostgreSQL 与 Redis 为在线独立快照，不保证跨数据库原子一致性。清单明确标记 `online-non-atomic`。备份文件包含生产密钥，需按生产密钥的权限保管；需要异机灾备时，另行将加密归档复制到受控位置。

后台「恢复验证」会校验密文散列、解密、核对归档成员与明文散列、恢复 PostgreSQL、查询表数量和 migration、检查并加载 Redis RDB，然后停止临时实例并清理它自己的临时目录。只有这些步骤成功后才写入 `verification: passed`。验证可以复跑；不会覆盖生产数据，也不提供公开的生产恢复 API。

实际灾难恢复应先停业务、确认目标为隔离的新实例、保存现有数据，并人工审核恢复方案。在线 Redis 快照与 PostgreSQL 快照可能处于不同时间点，恢复后需检查队列任务和已接受的外发消息，避免把未知送达记录直接重发。

## 真实镜像验证

本机脚本夹具测试不等于真实数据库恢复。发布前在有 Docker 的 Linux 主机执行：

```sh
cd /www/wwwroot/msg
sh scripts/verify-backup-image.sh
```

该脚本自行构建 runner 镜像，在项目 `data/backups/image-smoke.*` 中创建临时文件，并启动仅内部可见的临时网络、PostgreSQL 16、带认证的 Redis 7 和 runner。所有数据库使用临时存储，不读取生产 `.env`、备份、密钥或数据库卷，不映射宿主机端口。

脚本验证默认关闭、runner 任务请求、加密归档、真实 PostgreSQL/Redis 恢复、migration 读取、临时数据清理、原始测试数据库值仍然存在，以及 API 挂载约定（控制目录可写、归档只读、无 age 私钥）。成功或失败后，只清理本次随机命名的容器、网络、镜像和项目临时目录。

需要 Docker daemon、OpenSSL、Git 和 Linux 常用工具。若中断后主机重启，按脚本输出与 `msghub.backup-smoke` 标签识别其临时资源，确认资源属于本次验证再清理。验证脚本不会部署或更新生产应用。

## 排查

| 状态 | 检查 |
| --- | --- |
| runner 不可用 | profile 是否启动、心跳是否超过 90 秒、密钥是否可读、数据库服务是否就绪 |
| 加密密钥未配置 | secret 源文件是否为普通文件、权限是否允许容器 root 读取、age identity 是否有效 |
| `DATABASE_DUMP_FAILED` | runner 的账号/数据库名/密码是否与现有 PostgreSQL 一致，网络 DNS 是否可用 |
| `REDIS_SNAPSHOT_FAILED` | Redis 地址/端口、认证及 RDB 同步权限是否正确 |
| `VERIFY_FAILED` | 查看归档 manifest 中更具体的 `errorCode`，检查 tmpfs 容量和数据库版本 |
| `RUNNER_RESTARTED` | 上次任务被中断，已标失败且不自动重放；确认既有归档后重新发起任务 |
| API 不能保存配置 | `data/backups/control` 必须可写，不能是符号链接；归档挂载继续保持只读 |

脚本只对外显示固定错误代码。不要把含环境变量、密钥内容或原始 pg/redis 诊断的输出贴入管理页面或公共日志。
