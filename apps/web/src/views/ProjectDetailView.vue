<template>
  <div class="space-y-5" v-if="project">
    <div class="page-header">
      <div class="flex items-center gap-3 min-w-0">
        <n-button quaternary @click="$router.push('/projects')">← 返回</n-button>
        <div class="min-w-0">
          <div class="page-title truncate">{{ project.name }}</div>
          <div class="page-subtitle">基本信息 · 接入 · 告警 · 渠道</div>
        </div>
        <n-tag :type="project.enabled ? 'success' : 'default'" size="small">
          {{ project.enabled ? '启用' : '禁用' }}
        </n-tag>
      </div>
      <n-space wrap>
        <n-button secondary :loading="saving" @click="save">保存配置</n-button>
        <n-button type="primary" secondary :disabled="!hasEnabledChannel" @click="showSend = true">
          调试发送
        </n-button>
      </n-space>
    </div>

    <!-- 第一行：基本信息 + 失败率告警 -->
    <div class="grid lg:grid-cols-2 gap-4">
      <div class="page-card p-4 space-y-3">
        <h3 class="section-title">基本信息</h3>
        <n-form label-placement="top" size="small" class="compact-form">
          <div class="grid sm:grid-cols-2 gap-x-3">
            <n-form-item label="名称" class="sm:col-span-2">
              <n-input v-model:value="form.name" />
            </n-form-item>
            <n-form-item label="描述" class="sm:col-span-2">
              <n-input v-model:value="form.description" type="textarea" :rows="2" />
            </n-form-item>
            <n-form-item label="启用">
              <n-switch v-model:value="form.enabled" />
            </n-form-item>
            <n-form-item label="管理员邮箱（SMTP 兜底）">
              <n-input v-model:value="form.adminEmail" placeholder="空=全局管理员邮箱" />
            </n-form-item>
          </div>
        </n-form>
      </div>

      <div class="page-card p-4 space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="section-title">失败率告警</h3>
            <p class="section-desc">窗口内失败率达阈值时，走备用渠道告警（失败率留空=关闭）</p>
          </div>
          <n-tag v-if="form.alertFailRatePct != null" size="small" type="warning">
            ≥ {{ form.alertFailRatePct }}%
          </n-tag>
          <n-tag v-else size="small" :bordered="false">已关闭</n-tag>
        </div>
        <n-form label-placement="top" size="small" class="compact-form">
          <div class="grid grid-cols-3 gap-x-3">
            <n-form-item label="阈值 %">
              <n-input-number
                v-model:value="form.alertFailRatePct"
                :min="0"
                :max="100"
                clearable
                placeholder="关"
                class="w-full"
              />
            </n-form-item>
            <n-form-item label="窗口 分">
              <n-input-number v-model:value="form.alertWindowMin" :min="1" :max="10080" class="w-full" />
            </n-form-item>
            <n-form-item label="冷却 分">
              <n-input-number v-model:value="form.alertCooldownMin" :min="0" :max="1440" class="w-full" />
            </n-form-item>
          </div>
        </n-form>
        <p v-if="project.lastFailAlertAt" class="text-xs text-slate-400">
          最近告警：{{ formatTime(project.lastFailAlertAt) }}
        </p>
        <p class="text-xs text-slate-400 leading-relaxed">
          邮件失败告警不走 SMTP，请配 Bark / Gotify 等备用渠道。
        </p>
      </div>
    </div>

    <!-- 第二行：邮件策略 + 流量控制 -->
    <div class="grid lg:grid-cols-2 gap-4">
      <div class="page-card p-4 space-y-3">
        <h3 class="section-title">邮件策略</h3>
        <p class="section-desc">配额与连续失败抑制，仅影响 SMTP</p>
        <n-form label-placement="top" size="small" class="compact-form">
          <div class="grid grid-cols-2 gap-x-3">
            <n-form-item label="每日配额（空=不限）">
              <n-input-number
                v-model:value="form.dailyEmailQuota"
                :min="0"
                :max="1000000"
                clearable
                placeholder="不限"
                class="w-full"
              />
            </n-form-item>
            <n-form-item label="连续失败拉黑（0=关）">
              <n-input-number
                v-model:value="form.emailFailSuppressCount"
                :min="0"
                :max="100"
                class="w-full"
              />
            </n-form-item>
          </div>
        </n-form>
      </div>

      <div class="page-card p-4 space-y-3">
        <h3 class="section-title">流量与幂等</h3>
        <p class="section-desc">静默时段、入站限流、幂等窗口</p>
        <n-form label-placement="top" size="small" class="compact-form">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-3">
            <n-form-item label="静默时段">
              <n-switch v-model:value="form.quietHoursEnabled" />
            </n-form-item>
            <n-form-item label="开始">
              <n-input
                v-model:value="form.quietStart"
                placeholder="22:00"
                :disabled="!form.quietHoursEnabled"
              />
            </n-form-item>
            <n-form-item label="结束">
              <n-input
                v-model:value="form.quietEnd"
                placeholder="08:00"
                :disabled="!form.quietHoursEnabled"
              />
            </n-form-item>
            <n-form-item label="时区">
              <n-input v-model:value="form.quietTimezone" placeholder="Asia/Shanghai" />
            </n-form-item>
            <n-form-item label="限流 次/分">
              <n-input-number
                v-model:value="form.rateLimitPerMin"
                :min="0"
                clearable
                placeholder="不限"
                class="w-full"
              />
            </n-form-item>
            <n-form-item label="幂等 TTL 分">
              <n-input-number
                v-model:value="form.idempotencyTtlMin"
                :min="1"
                :max="10080"
                class="w-full"
              />
            </n-form-item>
          </div>
        </n-form>
      </div>
    </div>

    <!-- 未读邮件兜底 -->
    <div class="page-card p-4 space-y-3">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h3 class="section-title">未读邮件兜底</h3>
          <p class="section-desc">
            外发推送（含极光）成功后，若超过设定分钟仍未在手机点击查看，则 SMTP 发给管理员邮箱；
            成功后原消息显示「邮箱兜底已读」，不再允许重推或二次兜底。
            <b>与渠道 timeToLive（离线保留）无关。</b>
          </p>
        </div>
        <n-tag
          v-if="form.unreadEmailFallbackEnabled"
          size="small"
          type="warning"
        >
          {{ form.unreadEmailFallbackMinutes }} 分钟
        </n-tag>
        <n-tag v-else size="small" :bordered="false">已关闭</n-tag>
      </div>
      <n-form label-placement="top" size="small" class="compact-form">
        <div class="grid sm:grid-cols-3 gap-x-3">
          <n-form-item label="启用">
            <n-switch v-model:value="form.unreadEmailFallbackEnabled" />
          </n-form-item>
          <n-form-item label="等待分钟数">
            <n-input-number
              v-model:value="form.unreadEmailFallbackMinutes"
              :min="1"
              :max="43200"
              :disabled="!form.unreadEmailFallbackEnabled"
              class="w-full"
              placeholder="例如 1=1分钟，60=1小时"
            />
          </n-form-item>
          <n-form-item label="邮件模板 code">
            <n-input
              v-model:value="form.unreadEmailTemplateCode"
              placeholder="空=纯文本；如 unread_remind"
              :disabled="!form.unreadEmailFallbackEnabled"
            />
          </n-form-item>
        </div>
      </n-form>
      <p class="text-xs text-slate-400 leading-relaxed">
        需配置项目管理员邮箱或全局管理员邮箱，并绑定 SMTP。客户端点击通知会调用
        <code>POST /api/public/messages/mark-read</code> 取消兜底。
        设备推送页可看「邮件兜底」列的计划时间 / 实际发送时间。
      </p>
    </div>

    <!-- 开放接入 -->
    <div class="page-card p-4 space-y-3">
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 class="section-title">开放接入</h3>
          <p class="section-desc">
            Bearer API Key 鉴权；调用方不选渠道，外发由项目绑定决定
          </p>
        </div>
        <n-space wrap size="small">
          <n-button size="small" secondary type="warning" @click="resetKey">重置密钥</n-button>
          <n-button size="small" secondary @click="showKeyModal = true">多密钥</n-button>
          <n-button size="small" secondary :loading="simulating" @click="runSimulate">模拟矩阵</n-button>
          <n-button size="small" secondary @click="$router.push('/channels')">渠道管理</n-button>
        </n-space>
      </div>

      <div class="grid sm:grid-cols-2 gap-3">
        <n-form-item label="Webhook" :show-feedback="false" size="small">
          <n-input :value="webhookUrl" readonly size="small">
            <template #suffix>
              <n-button text type="primary" size="tiny" @click="copyText(webhookUrl)">复制</n-button>
            </template>
          </n-input>
        </n-form-item>
        <n-form-item label="Bark" :show-feedback="false" size="small">
          <n-input :value="barkUrl" readonly size="small">
            <template #suffix>
              <n-button text type="primary" size="tiny" @click="copyText(barkUrl)">复制</n-button>
            </template>
          </n-input>
        </n-form-item>
        <n-form-item label="Gotify" :show-feedback="false" size="small">
          <n-input :value="gotifyUrl" readonly size="small">
            <template #suffix>
              <n-button text type="primary" size="tiny" @click="copyText(gotifyUrl)">复制</n-button>
            </template>
          </n-input>
        </n-form-item>
        <n-form-item label="API Key" :show-feedback="false" size="small">
          <n-input :value="project?.apiKey || ''" readonly size="small" />
        </n-form-item>
      </div>

      <n-collapse>
        <n-collapse-item title="调用示例" name="api-examples">
          <div class="api-example">
# Webhook
POST {{ webhookUrl }}
Authorization: Bearer &lt;your-api-key&gt;
{ "title": "告警", "content": "服务异常", "priority": "high" }

# 事件目录
{ "event": "deploy.done", "variables": { "env": "prod" } }

# Bark / Gotify / Email
POST {{ barkUrl }}   → { "title", "body" }
POST {{ gotifyUrl }} → { "title", "message", "priority" }
POST {{ origin }}/api/email → { "to", "subject", "content" }
          </div>
        </n-collapse-item>
        <n-collapse-item
          v-if="inboundErrors.length"
          :title="`最近入站失败（${inboundErrors.length}）`"
          name="inbound-errors"
        >
          <div class="space-y-1 max-h-36 overflow-auto text-xs">
            <div
              v-for="e in inboundErrors"
              :key="e.id"
              class="bg-rose-50 text-rose-700 rounded px-2 py-1"
            >
              {{ formatTime(e.createdAt) }} · {{ e.title || e.id }} · {{ e.errorMessage || '失败' }}
            </div>
          </div>
        </n-collapse-item>
        <n-collapse-item
          v-if="simulateResults.length"
          title="模拟发送结果"
          name="simulate"
        >
          <n-data-table
            size="small"
            :columns="simulateColumns"
            :data="simulateResults"
            :bordered="false"
          />
        </n-collapse-item>
      </n-collapse>
    </div>

    <!-- 邮件健康 -->
    <div class="page-card p-4 space-y-3" v-if="health">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <h3 class="section-title">邮件健康</h3>
        <n-button size="small" secondary :loading="loadingHealth" @click="loadHealth">刷新</n-button>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div class="stat-tile">
          <div class="stat-label">SMTP 24h</div>
          <div class="stat-value">
            {{ health.smtp?.last24h?.success || 0 }} / {{ health.smtp?.last24h?.failed || 0 }}
          </div>
          <div class="stat-sub">失败率 {{ health.smtp?.last24h?.failRatePct ?? 0 }}%</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">今日配额</div>
          <div class="stat-value">
            {{ health.smtp?.todayUsed ?? 0 }}
            <span v-if="health.smtp?.dailyQuota" class="font-normal text-slate-400">
              / {{ health.smtp.dailyQuota }}
            </span>
            <span v-else class="font-normal text-slate-400"> / ∞</span>
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">备用告警</div>
          <div class="stat-value">{{ health.backupAlert?.configured ? '已配置' : '未配置' }}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">抑制名单</div>
          <div class="stat-value">{{ health.policy?.suppressCount ?? 0 }}</div>
        </div>
      </div>
      <ul v-if="health.warnings?.length" class="text-sm text-amber-700 space-y-1">
        <li v-for="(w, i) in health.warnings" :key="i">· {{ w }}</li>
      </ul>
    </div>

    <!-- 项目模板 -->
    <div class="page-card p-4 space-y-4">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 class="section-title">项目模板</h3>
          <p class="section-desc">
            本项目专属模板；发送时优先用项目模板，没有则回退全局同 code。互不影响其它项目
          </p>
        </div>
        <n-space wrap size="small">
          <n-button size="small" secondary :loading="seedingMail" @click="seedMailForProject">
            邮件默认
          </n-button>
          <n-button size="small" secondary :loading="seedingPush" @click="seedPushForProject">
            推送示例
          </n-button>
          <n-button size="small" type="primary" secondary @click="openCreateMail">新建邮件</n-button>
          <n-button size="small" type="primary" secondary @click="openCreatePush">新建推送</n-button>
          <n-button size="small" secondary :loading="loadingProjectTpls" @click="loadProjectTemplates">
            刷新
          </n-button>
        </n-space>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div class="space-y-2">
          <div class="text-sm font-medium text-slate-700">邮件模板（本项目）</div>
          <div v-if="!projectMailTpls.length" class="empty-hint !py-4">暂无项目邮件模板</div>
          <div v-else class="tpl-list">
            <div v-for="t in projectMailTpls" :key="t.id" class="tpl-row">
              <div class="min-w-0">
                <div class="font-medium truncate">{{ t.name }}</div>
                <div class="text-xs text-slate-400">
                  <code>{{ t.code }}</code>
                  · {{ t.enabled ? '启用' : '禁用' }}
                </div>
              </div>
              <n-space size="small">
                <n-switch
                  size="small"
                  :value="!!t.enabled"
                  @update:value="(v: boolean) => toggleMailTpl(t, v)"
                />
                <n-button size="tiny" secondary @click="$router.push(`/templates/${t.id}`)">
                  编辑
                </n-button>
                <n-button size="tiny" quaternary type="error" @click="removeMailTpl(t)">删除</n-button>
              </n-space>
            </div>
          </div>
        </div>
        <div class="space-y-2">
          <div class="text-sm font-medium text-slate-700">推送模板（本项目）</div>
          <div v-if="!projectPushTpls.length" class="empty-hint !py-4">暂无项目推送模板</div>
          <div v-else class="tpl-list">
            <div v-for="t in projectPushTpls" :key="t.id" class="tpl-row">
              <div class="min-w-0">
                <div class="font-medium truncate">{{ t.name }}</div>
                <div class="text-xs text-slate-400">
                  <code>{{ t.code }}</code>
                  · {{ t.enabled ? '启用' : '禁用' }}
                </div>
              </div>
              <n-space size="small">
                <n-switch
                  size="small"
                  :value="!!t.enabled"
                  @update:value="(v: boolean) => togglePushTpl(t, v)"
                />
                <n-button size="tiny" secondary @click="editPushTpl(t)">编辑</n-button>
                <n-button size="tiny" quaternary type="error" @click="removePushTpl(t)">删除</n-button>
              </n-space>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 启用渠道 -->
    <div class="page-card p-4 space-y-4">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 class="section-title">启用渠道</h3>
          <p class="section-desc">
            一个<strong>默认</strong>渠道首选发送；其它已启用渠道按优先级数字从小到大兜底（SMTP 不参与兜底）
          </p>
        </div>
        <n-button size="small" secondary @click="loadOptions" :loading="loadingOptions">刷新</n-button>
      </div>

      <div v-if="!options.length" class="empty-hint">
        暂无全局渠道，请先在左侧「渠道管理」中配置。
        <n-button text type="primary" @click="$router.push('/channels')">立即添加</n-button>
      </div>

      <div v-else class="channel-list">
        <div
          v-for="(opt, idx) in sortedOptions"
          :key="opt.id"
          class="channel-card"
          :class="{
            active: opt.bindingEnabled,
            default: opt.bindingIsDefault,
          }"
        >
          <div class="channel-card-top">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-slate-800 truncate">{{ opt.name }}</span>
                <n-tag v-if="opt.bindingIsDefault" size="small" type="success">默认</n-tag>
                <n-tag
                  v-else-if="opt.bindingEnabled && opt.type !== 'SMTP'"
                  size="small"
                  type="warning"
                >
                  兜底 #{{ failoverRank(opt) }}
                </n-tag>
                <n-tag v-if="opt.isDefault" size="tiny" type="info">全局默认</n-tag>
              </div>
              <div class="text-xs text-slate-400 mt-0.5">
                {{ CHANNEL_TYPE_LABELS[opt.type] || opt.type }}
              </div>
            </div>
            <n-switch
              :value="!!opt.bindingEnabled"
              :loading="togglingId === opt.id"
              @update:value="(v: boolean) => toggleBind(opt, v)"
            />
          </div>

          <div class="channel-card-actions" v-if="opt.bound">
            <template v-if="opt.bindingEnabled && opt.type !== 'SMTP' && opt.type !== 'INBOX'">
              <div class="priority-box">
                <span class="text-xs text-slate-500">优先级</span>
                <n-input-number
                  :value="opt.bindingIsDefault ? 0 : (opt.bindingPriority ?? 100)"
                  :min="0"
                  :max="9999"
                  size="tiny"
                  :disabled="!!opt.bindingIsDefault"
                  class="priority-input"
                  @update:value="(v: number | null) => onPriorityChange(opt, v)"
                />
              </div>
              <n-button
                size="tiny"
                secondary
                :disabled="idx === 0 || !!opt.bindingIsDefault"
                @click="movePriority(opt, -1)"
              >
                上移
              </n-button>
              <n-button
                size="tiny"
                secondary
                :disabled="isLastFailover(opt) || !!opt.bindingIsDefault"
                @click="movePriority(opt, 1)"
              >
                下移
              </n-button>
            </template>

            <n-button
              v-if="!opt.bindingIsDefault && opt.type !== 'INBOX'"
              size="tiny"
              type="primary"
              secondary
              :disabled="!opt.bindingEnabled"
              @click="setDefault(opt)"
            >
              设为默认
            </n-button>
            <n-tag v-else-if="opt.bindingIsDefault" size="small" type="success">当前默认</n-tag>
            <n-tag v-if="opt.type === 'INBOX'" size="small" type="info">系统兜底</n-tag>

            <n-button
              v-if="opt.type !== 'INBOX'"
              size="tiny"
              quaternary
              type="error"
              @click="unbind(opt)"
            >
              解绑
            </n-button>
          </div>
        </div>
      </div>

      <div class="text-xs text-slate-400 leading-relaxed">
        发送策略：外发渠道（按优先级熔断）→ 管理员邮箱 SMTP → 站内。
        站内渠道为系统兜底，不可解绑/删除。
      </div>
    </div>
<n-modal
      v-model:show="showSend"
      preset="card"
      content-scrollable
      title="调试发送"
      style="width: min(620px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <n-form label-placement="top">
        <n-form-item label="渠道" required>
          <n-select
            v-model:value="sendForm.channelId"
            :options="enabledChannelOptions"
            placeholder="选择已启用渠道"
            @update:value="onSendChannelChange"
          />
        </n-form-item>

        <template v-if="selectedSendType !== 'SMTP'">
          <n-form-item label="推送模板（可选）">
            <n-select
              v-model:value="sendForm.pushTemplate"
              clearable
              filterable
              :options="pushTemplateOptions"
              :loading="loadingPushTpls"
              placeholder="不选则手动填标题/正文"
              @update:value="onPushTemplateChange"
            />
          </n-form-item>
          <template v-if="sendForm.pushTemplate && pushVarKeys.length">
            <div class="mb-1 text-xs text-slate-400">
              模板变量 · <code>pushTemplate: "{{ sendForm.pushTemplate }}"</code>
            </div>
            <n-form-item v-for="key in pushVarKeys" :key="key" :label="key">
              <n-input v-model:value="sendForm.variables[key]" :placeholder="`{{${key}}}`" />
            </n-form-item>
          </template>
          <n-form-item v-else-if="sendForm.pushTemplate" label="变量 JSON">
            <n-input
              v-model:value="sendForm.variablesJson"
              type="textarea"
              :rows="4"
              placeholder='{"name":"张三","orderId":"A001"}'
            />
          </n-form-item>
          <div v-if="sendForm.pushTemplate" class="mb-3 flex items-center gap-2">
            <n-button size="small" secondary :loading="previewing" @click="doPreviewPush">
              渲染预览
            </n-button>
            <span class="text-xs text-slate-400">预览不会真正发送</span>
          </div>
          <div
            v-if="pushPreview"
            class="mb-4 rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm space-y-2"
          >
            <div><span class="text-slate-400">标题：</span>{{ pushPreview.title || '（空）' }}</div>
            <div class="whitespace-pre-wrap">
              <span class="text-slate-400">正文：</span>{{ pushPreview.content || '（空）' }}
            </div>
          </div>
        </template>

        <n-form-item
          :label="sendForm.pushTemplate && selectedSendType !== 'SMTP' ? '标题（模板未覆盖时兜底）' : '标题'"
        >
          <n-input
            v-model:value="sendForm.title"
            :disabled="!!sendForm.pushTemplate && selectedSendType !== 'SMTP'"
          />
        </n-form-item>
        <n-form-item
          :label="sendForm.pushTemplate && selectedSendType !== 'SMTP' ? '内容（模板未覆盖时兜底）' : '内容'"
        >
          <n-input
            v-model:value="sendForm.content"
            type="textarea"
            :rows="4"
            :disabled="!!sendForm.pushTemplate && selectedSendType !== 'SMTP'"
          />
        </n-form-item>
        <n-form-item v-if="selectedSendType === 'SMTP'" label="收件人" required>
          <n-input v-model:value="sendForm.to" placeholder="user@example.com" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showSend = false">取消</n-button>
          <n-button type="primary" :loading="sending" @click="doSend">发送</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showKeyModal" preset="card" title="API 密钥" style="width: 560px">
      <div class="space-y-3">
        <div class="flex gap-2">
          <n-input v-model:value="newKeyName" placeholder="密钥名称，如 blog-prod" />
          <n-button type="primary" :loading="creatingKey" @click="createKey">创建</n-button>
        </div>
        <div v-if="createdKeyPlain" class="text-xs bg-amber-50 text-amber-800 rounded p-3 break-all">
          请立即复制明文密钥（仅显示一次）：
          <div class="font-mono mt-1">{{ createdKeyPlain }}</div>
          <n-button size="tiny" class="mt-2" @click="copyText(createdKeyPlain)">复制</n-button>
        </div>
        <div v-for="k in apiKeys" :key="k.id" class="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
          <div>
            <div class="font-medium">{{ k.name }} · {{ k.apiKeyPrefix }}****</div>
            <div class="text-xs text-slate-400">
              {{ k.enabled ? '启用' : '已吊销' }}
              <span v-if="k.lastUsedAt"> · 最近 {{ formatTime(k.lastUsedAt) }}</span>
            </div>
          </div>
          <div class="flex gap-2">
            <n-button size="tiny" secondary :disabled="!k.enabled" @click="revokeKey(k.id)">吊销</n-button>
            <n-button size="tiny" quaternary type="error" @click="deleteKey(k.id)">删除</n-button>
          </div>
        </div>
      </div>
    </n-modal>

    <n-modal
      v-model:show="showPushTplModal"
      preset="card"
      :title="editingPushTplId ? '编辑项目推送模板' : '新建项目推送模板'"
      style="width: min(520px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <n-form label-placement="top" size="small">
        <n-form-item label="Code" required>
          <n-input v-model:value="pushTplForm.code" :disabled="!!editingPushTplId" />
        </n-form-item>
        <n-form-item label="名称" required>
          <n-input v-model:value="pushTplForm.name" />
        </n-form-item>
        <n-form-item label="标题模板">
          <n-input v-model:value="pushTplForm.titleTpl" />
        </n-form-item>
        <n-form-item label="正文模板" required>
          <n-input v-model:value="pushTplForm.contentTpl" type="textarea" :rows="5" />
        </n-form-item>
        <n-form-item label="启用">
          <n-switch v-model:value="pushTplForm.enabled" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showPushTplModal = false">取消</n-button>
          <n-button type="primary" :loading="savingPushTpl" @click="savePushTpl">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSwitch,
  NTag,
  NModal,
  NSelect,
  NSpace,
  useMessage,
  useDialog,
} from 'naive-ui';
import { projectsApi, channelsApi, messagesApi, pushTemplatesApi, templatesApi, projectHealthApi } from '@/api';
import { CHANNEL_TYPE_LABELS, formatTime } from '@/utils/labels';

const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const message = useMessage();
const dialog = useDialog();
const origin = typeof window !== 'undefined' ? window.location.origin : 'https://notify.example.com';
const webhookUrl = computed(() => `${origin}/api/webhook`);
const barkUrl = computed(() => `${origin}/api/bark`);
const gotifyUrl = computed(() => `${origin}/api/gotify`);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.warning('复制失败，请手动选择');
  }
}
const project = ref<any>(null);
const health = ref<any>(null);
const loadingHealth = ref(false);
const projectMailTpls = ref<any[]>([]);
const projectPushTpls = ref<any[]>([]);
const loadingProjectTpls = ref(false);
const seedingMail = ref(false);
const seedingPush = ref(false);
const showPushTplModal = ref(false);
const savingPushTpl = ref(false);
const editingPushTplId = ref<string | null>(null);
const pushTplForm = reactive({
  code: '',
  name: '',
  titleTpl: '',
  contentTpl: '',
  enabled: true,
});
const form = reactive({
  name: '',
  description: '',
  enabled: true,
  adminEmail: '',
  alertFailRatePct: null as number | null,
  alertWindowMin: 60,
  dailyEmailQuota: null as number | null,
  emailFailSuppressCount: 5,
  alertCooldownMin: 10,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  quietTimezone: 'Asia/Shanghai',
  rateLimitPerMin: null as number | null,
  idempotencyTtlMin: 30,
  unreadEmailFallbackEnabled: false,
  unreadEmailFallbackMinutes: 60,
  unreadEmailTemplateCode: '',
});
const saving = ref(false);
const showKey = ref(false);
const newKey = ref('');
const showKeyModal = ref(false);
const apiKeys = ref<any[]>([]);
const newKeyName = ref('');
const creatingKey = ref(false);
const createdKeyPlain = ref('');
const inboundErrors = ref<any[]>([]);
const simulating = ref(false);
const simulateResults = ref<any[]>([]);
const simulateColumns = [
  { title: '渠道', key: 'name' },
  { title: '类型', key: 'type', render: (r: any) => CHANNEL_TYPE_LABELS[r.type] || r.type },
  {
    title: '结果',
    key: 'ok',
    render: (r: any) =>
      h(NTag, { size: 'small', type: r.ok ? 'success' : r.skipped ? 'default' : 'error' }, {
        default: () => (r.ok ? 'OK' : r.skipped ? '跳过' : '失败'),
      }),
  },
  { title: '耗时', key: 'ms', render: (r: any) => `${r.ms ?? '-'}ms` },
  { title: '错误', key: 'error', ellipsis: { tooltip: true }, render: (r: any) => r.error || '-' },
];

const options = ref<any[]>([]);
const loadingOptions = ref(false);
const togglingId = ref<string | null>(null);
const showSend = ref(false);
const sending = ref(false);
const loadingPushTpls = ref(false);
const previewing = ref(false);
const pushTemplateList = ref<any[]>([]);
const pushVarKeys = ref<string[]>([]);
const pushPreview = ref<{ title?: string; content?: string } | null>(null);
const selectedPushTplId = ref<string | null>(null);
const sendForm = reactive({
  channelId: null as string | null,
  title: '调试消息',
  content: '来自项目详情的测试发送',
  to: '',
  pushTemplate: null as string | null,
  variables: {} as Record<string, string>,
  variablesJson: '',
});
const DEMO_VARS: Record<string, string> = {
  appName: '消息推送',
  level: 'P1',
  service: 'api',
  time: '2026-07-11 16:00:00',
  message: 'CPU 持续超过 90%',
  host: 'prod-1',
  link: 'https://example.com/alerts/1',
  username: '张三',
  orderId: 'ORD-10086',
  amount: '99.00',
  product: '会员年卡',
  env: 'production',
  status: '成功',
  version: 'v1.4.0',
  operator: 'ci-bot',
  duration: '42s',
  commit: 'a1b2c3d',
  ip: '203.0.113.10',
  location: '上海',
  device: 'Chrome / Windows',
  date: '2026-07-11',
  cpu: '23',
  memory: '61',
  disk: '48',
  load: '0.42',
  note: '运行正常',
  title: '通用通知',
  content: '这是一条自定义正文',
  footer: 'Notify Hub',
  remark: '感谢支持',
  name: '张三',
};

const hasEnabledChannel = computed(() => options.value.some((o) => o.bindingEnabled));

const sortedOptions = computed(() => {
  const list = [...options.value];
  list.sort((a, b) => {
    if (!!a.bindingIsDefault !== !!b.bindingIsDefault) return a.bindingIsDefault ? -1 : 1;
    if (!!a.bindingEnabled !== !!b.bindingEnabled) return a.bindingEnabled ? -1 : 1;
    const pa = a.bindingPriority ?? 100;
    const pb = b.bindingPriority ?? 100;
    if (pa !== pb) return pa - pb;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  return list;
});

const failoverOnly = computed(() =>
  sortedOptions.value.filter(
    (o) => o.bindingEnabled && !o.bindingIsDefault && o.type !== 'SMTP' && o.type !== 'INBOX',
  ),
);

function failoverRank(opt: any) {
  const i = failoverOnly.value.findIndex((o) => o.id === opt.id);
  return i >= 0 ? i + 1 : '-';
}

function isLastFailover(opt: any) {
  const list = failoverOnly.value;
  if (!list.length) return true;
  return list[list.length - 1]?.id === opt.id;
}

const enabledChannelOptions = computed(() =>
  sortedOptions.value
    .filter((o) => o.bindingEnabled && o.enabled !== false)
    .map((o) => ({
      label: `${o.name}（${CHANNEL_TYPE_LABELS[o.type] || o.type}）${
        o.bindingIsDefault ? ' · 默认' : ''
      }`,
      value: o.id,
    })),
);
const selectedSendType = computed(() => {
  const opt = options.value.find((o) => o.id === sendForm.channelId);
  return opt?.type || null;
});
const pushTemplateOptions = computed(() =>
  pushTemplateList.value.map((t) => ({
    label: `${t.name}（${t.code}）${t.projectId ? ' · 项目' : ' · 全局'}`,
    value: t.code,
  })),
);

async function load() {
  const data: any = await projectsApi.get(id);
  project.value = data;
  form.name = data.name;
  form.description = data.description || '';
  form.enabled = data.enabled;
  form.adminEmail = data.adminEmail || '';
  form.alertFailRatePct =
    data.alertFailRatePct === null || data.alertFailRatePct === undefined
      ? null
      : Number(data.alertFailRatePct);
  form.alertWindowMin = data.alertWindowMin ?? 60;
  form.dailyEmailQuota =
    data.dailyEmailQuota === null || data.dailyEmailQuota === undefined
      ? null
      : Number(data.dailyEmailQuota);
  form.emailFailSuppressCount = data.emailFailSuppressCount ?? 5;
  form.alertCooldownMin = data.alertCooldownMin ?? 10;
  form.quietHoursEnabled = !!data.quietHoursEnabled;
  form.quietStart = data.quietStart || '22:00';
  form.quietEnd = data.quietEnd || '08:00';
  form.quietTimezone = data.quietTimezone || 'Asia/Shanghai';
  form.rateLimitPerMin =
    data.rateLimitPerMin === null || data.rateLimitPerMin === undefined
      ? null
      : Number(data.rateLimitPerMin);
  form.idempotencyTtlMin = data.idempotencyTtlMin ?? 30;
  form.unreadEmailFallbackEnabled = !!data.unreadEmailFallbackEnabled;
  // 字段名保留 Hours 兼容历史 API，语义为分钟
  form.unreadEmailFallbackMinutes = data.unreadEmailFallbackHours ?? 60;
  form.unreadEmailTemplateCode = data.unreadEmailTemplateCode || '';
  apiKeys.value = data.apiKeys || [];
  try {
    inboundErrors.value = (await projectsApi.inboundErrors(id, 10)) || [];
  } catch {
    inboundErrors.value = [];
  }
}

async function loadHealth() {
  loadingHealth.value = true;
  try {
    health.value = await projectHealthApi.get(id);
  } catch {
    health.value = null;
  } finally {
    loadingHealth.value = false;
  }
}

async function loadOptions() {
  loadingOptions.value = true;
  try {
    options.value = (await channelsApi.listOptions(id)) || [];
    if (!sendForm.channelId) {
      const def =
        options.value.find((o) => o.bindingIsDefault && o.bindingEnabled) ||
        options.value.find((o) => o.bindingEnabled);
      if (def) sendForm.channelId = def.id;
    }
  } catch (e: any) {
    message.error(e.message);
  } finally {
    loadingOptions.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await projectsApi.update(id, {
      name: form.name,
      description: form.description,
      enabled: form.enabled,
      adminEmail: form.adminEmail,
      alertFailRatePct: form.alertFailRatePct,
      alertWindowMin: form.alertWindowMin,
      dailyEmailQuota: form.dailyEmailQuota,
      emailFailSuppressCount: form.emailFailSuppressCount,
      alertCooldownMin: form.alertCooldownMin,
      quietHoursEnabled: form.quietHoursEnabled,
      quietStart: form.quietStart,
      quietEnd: form.quietEnd,
      quietTimezone: form.quietTimezone,
      rateLimitPerMin: form.rateLimitPerMin,
      idempotencyTtlMin: form.idempotencyTtlMin,
      unreadEmailFallbackEnabled: form.unreadEmailFallbackEnabled,
      unreadEmailFallbackHours: form.unreadEmailFallbackMinutes,
      unreadEmailTemplateCode: form.unreadEmailTemplateCode || null,
    });
    message.success('已保存');
    await load();
    await loadHealth();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function createKey() {
  if (!newKeyName.value.trim()) {
    message.warning('请填写密钥名称');
    return;
  }
  creatingKey.value = true;
  try {
    const res: any = await projectsApi.createKey(id, { name: newKeyName.value.trim() });
    createdKeyPlain.value = res.apiKey;
    newKeyName.value = '';
    apiKeys.value = (await projectsApi.listKeys(id)) || [];
    message.success('已创建');
  } catch (e: any) {
    message.error(e.message);
  } finally {
    creatingKey.value = false;
  }
}

async function revokeKey(keyId: string) {
  try {
    await projectsApi.revokeKey(id, keyId);
    apiKeys.value = (await projectsApi.listKeys(id)) || [];
    message.success('已吊销');
  } catch (e: any) {
    message.error(e.message);
  }
}

async function deleteKey(keyId: string) {
  try {
    await projectsApi.deleteKey(id, keyId);
    apiKeys.value = (await projectsApi.listKeys(id)) || [];
    message.success('已删除');
  } catch (e: any) {
    message.error(e.message);
  }
}

async function runSimulate() {
  simulating.value = true;
  try {
    const res: any = await projectsApi.simulateSend(id, {});
    simulateResults.value = res.results || [];
    message.success(`模拟完成：成功 ${res.success}/${res.total}`);
  } catch (e: any) {
    message.error(e.message || '模拟失败');
  } finally {
    simulating.value = false;
  }
}

async function toggleBind(opt: any, enabled: boolean) {
  if (opt.type === 'INBOX' && !enabled) {
    message.warning('站内通知渠道不允许停用');
    return;
  }
  togglingId.value = opt.id;
  try {
    if (!opt.bound) {
      await channelsApi.bind(id, { channelId: opt.id, enabled: true });
      message.success(`已启用「${opt.name}」`);
    } else {
      await channelsApi.updateBinding(id, opt.id, { enabled });
      message.success(enabled ? '已启用' : '已停用');
    }
    await loadOptions();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    togglingId.value = null;
  }
}

async function setDefault(opt: any) {
  try {
    await channelsApi.setProjectDefault(id, opt.id);
    message.success(`「${opt.name}」已设为项目默认渠道`);
    await loadOptions();
  } catch (e: any) {
    message.error(e.message);
  }
}

async function onPriorityChange(opt: any, value: number | null) {
  if (opt.bindingIsDefault) return;
  const priority = value == null ? 100 : Number(value);
  try {
    await channelsApi.updateBinding(id, opt.id, { priority });
    await loadOptions();
  } catch (e: any) {
    message.error(e.message || '更新优先级失败');
  }
}

async function movePriority(opt: any, dir: -1 | 1) {
  if (opt.bindingIsDefault) return;
  // 仅重排：非默认、已启用、非 SMTP 的渠道
  const list = failoverOnly.value.map((o) => o.id);
  const idx = list.indexOf(opt.id);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= list.length) return;
  const next = [...list];
  const t = next[idx];
  next[idx] = next[j];
  next[j] = t;
  // 默认渠道固定置顶一并提交，服务端将其 priority 设为 0
  const def = options.value.find((o) => o.bindingIsDefault)?.id;
  const channelIds = def ? [def, ...next.filter((x) => x !== def)] : next;
  try {
    options.value = (await channelsApi.reorder(id, channelIds)) || options.value;
    message.success('已更新兜底顺序');
  } catch (e: any) {
    message.error(e.message || '排序失败');
    await loadOptions();
  }
}

function unbind(opt: any) {
  if (opt.type === 'INBOX') {
    message.warning('站内通知渠道不允许解绑');
    return;
  }
  dialog.warning({
    title: '解绑渠道',
    content: `确认从本项目解绑「${opt.name}」？`,
    positiveText: '解绑',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await channelsApi.unbind(id, opt.id);
        message.success('已解绑');
        await loadOptions();
      } catch (e: any) {
        message.error(e.message);
      }
    },
  });
}

function resetKey() {
  dialog.warning({
    title: '重置 API Key',
    content: '旧密钥将立即失效，确认继续？',
    positiveText: '重置',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res: any = await projectsApi.resetKey(id);
      newKey.value = res.apiKey;
      showKey.value = true;
      await load();
      message.success('已重置');
    },
  });
}

async function doSend() {
  if (!sendForm.channelId) {
    message.warning('请选择渠道');
    return;
  }
  if (selectedSendType.value === 'SMTP' && !sendForm.to) {
    message.warning('SMTP 需要填写收件人');
    return;
  }

  let variables: Record<string, unknown> | undefined;
  if (sendForm.pushTemplate && selectedSendType.value !== 'SMTP') {
    try {
      if (pushVarKeys.value.length) {
        variables = {};
        for (const k of pushVarKeys.value) {
          const v = sendForm.variables[k];
          if (v !== undefined && v !== '') variables[k] = v;
        }
      } else if (sendForm.variablesJson?.trim()) {
        variables = JSON.parse(sendForm.variablesJson);
      } else {
        variables = {};
      }
    } catch {
      message.warning('变量 JSON 格式无效');
      return;
    }
  }

  sending.value = true;
  try {
    const payload: Record<string, any> = {
      projectId: id,
      channelId: sendForm.channelId,
      channelType: selectedSendType.value || undefined,
      to: sendForm.to || undefined,
    };
    if (sendForm.pushTemplate && selectedSendType.value !== 'SMTP') {
      payload.pushTemplate = sendForm.pushTemplate;
      payload.variables = variables || {};
    } else {
      payload.title = sendForm.title;
      payload.content = sendForm.content;
    }
    const res: any = await messagesApi.send(payload);
    if (res?.success === false) message.error(res.errorMessage || '发送失败');
    else message.success(res?.status === 'PENDING' ? '已入队' : '发送完成');
    showSend.value = false;
  } catch (e: any) {
    message.error(e.message);
  } finally {
    sending.value = false;
  }
}

function pickDemoVars(keys: string[]) {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = DEMO_VARS[k] ?? `示例${k}`;
  return out;
}

async function loadPushTemplates() {
  loadingPushTpls.value = true;
  try {
    pushTemplateList.value =
      (await pushTemplatesApi.list({
        projectId: id,
        enabled: true,
        includeGlobal: true,
      })) || [];
  } catch (e: any) {
    message.error(e.message || '加载推送模板失败');
    pushTemplateList.value = [];
  } finally {
    loadingPushTpls.value = false;
  }
}

function resetPushTemplateFields() {
  sendForm.pushTemplate = null;
  sendForm.variables = {};
  sendForm.variablesJson = '';
  pushVarKeys.value = [];
  pushPreview.value = null;
  selectedPushTplId.value = null;
}

async function onSendChannelChange() {
  resetPushTemplateFields();
  if (selectedSendType.value !== 'SMTP') {
    await loadPushTemplates();
  }
}

function onPushTemplateChange(code: string | null) {
  pushPreview.value = null;
  sendForm.variables = {};
  sendForm.variablesJson = '';
  pushVarKeys.value = [];
  selectedPushTplId.value = null;
  if (!code) return;
  const tpl = pushTemplateList.value.find((t) => t.code === code);
  if (!tpl) return;
  selectedPushTplId.value = tpl.id;
  const keys = Array.isArray(tpl.variables) ? tpl.variables : [];
  pushVarKeys.value = keys;
  if (keys.length) sendForm.variables = pickDemoVars(keys);
  else sendForm.variablesJson = '{\n  \n}';
}

async function doPreviewPush() {
  if (!selectedPushTplId.value) {
    message.warning('请先选择推送模板');
    return;
  }
  let variables: Record<string, unknown> = {};
  try {
    if (pushVarKeys.value.length) {
      for (const k of pushVarKeys.value) {
        const v = sendForm.variables[k];
        if (v !== undefined && v !== '') variables[k] = v;
      }
    } else if (sendForm.variablesJson?.trim()) {
      variables = JSON.parse(sendForm.variablesJson);
    }
  } catch {
    message.warning('变量 JSON 格式无效');
    return;
  }
  previewing.value = true;
  try {
    pushPreview.value =
      (await pushTemplatesApi.preview(selectedPushTplId.value, variables)) || null;
  } catch (e: any) {
    message.error(e.message);
  } finally {
    previewing.value = false;
  }
}

async function loadProjectTemplates() {
  loadingProjectTpls.value = true;
  try {
    const [mails, pushes] = await Promise.all([
      templatesApi.list({ projectId: id }),
      pushTemplatesApi.list({ projectId: id }),
    ]);
    projectMailTpls.value = mails || [];
    projectPushTpls.value = pushes || [];
  } catch (e: any) {
    message.error(e.message || '加载项目模板失败');
  } finally {
    loadingProjectTpls.value = false;
  }
}

async function seedMailForProject() {
  seedingMail.value = true;
  try {
    const res: any = await templatesApi.seedDefaults(id);
    message.success(`邮件默认已写入: ${(res.created || []).join(', ') || '无新增'}`);
    await loadProjectTemplates();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    seedingMail.value = false;
  }
}

async function seedPushForProject() {
  seedingPush.value = true;
  try {
    const res: any = await pushTemplatesApi.seedDefaults(id);
    message.success(`推送示例已写入: ${(res.created || []).join(', ') || '无新增'}`);
    await loadProjectTemplates();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    seedingPush.value = false;
  }
}

async function openCreateMail() {
  try {
    const res: any = await templatesApi.create({
      code: `mail_${Date.now().toString(36)}`,
      name: '新建邮件模板',
      projectId: id,
      subject: '【{{appName}}】通知',
      htmlBody: '<p>你好，{{appName}}</p>',
      variables: ['appName'],
      enabled: true,
    });
    message.success('已创建，请编辑内容');
    await loadProjectTemplates();
    router.push(`/templates/${res.id}`);
  } catch (e: any) {
    message.error(e.message);
  }
}

function openCreatePush() {
  editingPushTplId.value = null;
  pushTplForm.code = `push_${Date.now().toString(36)}`;
  pushTplForm.name = '新建推送模板';
  pushTplForm.titleTpl = '【{{appName}}】{{title}}';
  pushTplForm.contentTpl = '{{content}}';
  pushTplForm.enabled = true;
  showPushTplModal.value = true;
}

function editPushTpl(t: any) {
  editingPushTplId.value = t.id;
  pushTplForm.code = t.code;
  pushTplForm.name = t.name;
  pushTplForm.titleTpl = t.titleTpl || '';
  pushTplForm.contentTpl = t.contentTpl || '';
  pushTplForm.enabled = t.enabled !== false;
  showPushTplModal.value = true;
}

async function savePushTpl() {
  if (!pushTplForm.code.trim() || !pushTplForm.name.trim() || !pushTplForm.contentTpl.trim()) {
    message.warning('请填写 code / 名称 / 正文');
    return;
  }
  savingPushTpl.value = true;
  try {
    if (editingPushTplId.value) {
      await pushTemplatesApi.update(editingPushTplId.value, {
        name: pushTplForm.name,
        titleTpl: pushTplForm.titleTpl,
        contentTpl: pushTplForm.contentTpl,
        enabled: pushTplForm.enabled,
      });
      message.success('已更新');
    } else {
      await pushTemplatesApi.create({
        code: pushTplForm.code.trim(),
        name: pushTplForm.name.trim(),
        projectId: id,
        titleTpl: pushTplForm.titleTpl,
        contentTpl: pushTplForm.contentTpl,
        enabled: pushTplForm.enabled,
      });
      message.success('已创建');
    }
    showPushTplModal.value = false;
    await loadProjectTemplates();
    await loadPushTemplates();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    savingPushTpl.value = false;
  }
}

async function toggleMailTpl(t: any, enabled: boolean) {
  try {
    await templatesApi.update(t.id, { enabled });
    t.enabled = enabled;
  } catch (e: any) {
    message.error(e.message);
  }
}

async function togglePushTpl(t: any, enabled: boolean) {
  try {
    await pushTemplatesApi.update(t.id, { enabled });
    t.enabled = enabled;
    await loadPushTemplates();
  } catch (e: any) {
    message.error(e.message);
  }
}

function removeMailTpl(t: any) {
  dialog.warning({
    title: '删除项目邮件模板',
    content: `确认删除本项目「${t.name}」（${t.code}）？不影响全局与其它项目。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await templatesApi.remove(t.id);
        message.success('已删除');
        await loadProjectTemplates();
      } catch (e: any) {
        message.error(e.message);
      }
    },
  });
}

function removePushTpl(t: any) {
  dialog.warning({
    title: '删除项目推送模板',
    content: `确认删除本项目「${t.name}」（${t.code}）？不影响全局与其它项目。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await pushTemplatesApi.remove(t.id);
        message.success('已删除');
        await loadProjectTemplates();
        await loadPushTemplates();
      } catch (e: any) {
        message.error(e.message);
      }
    },
  });
}

onMounted(async () => {
  await load();
  await loadOptions();
  await loadPushTemplates();
  await loadProjectTemplates();
  await loadHealth();
});
</script>

<style scoped>
.section-title {
  font-weight: 600;
  color: #1e293b;
  font-size: 15px;
  line-height: 1.3;
}

.section-desc {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.45;
}

.compact-form :deep(.n-form-item) {
  margin-bottom: 10px;
}

.compact-form :deep(.n-form-item-label) {
  font-size: 12px;
  padding-bottom: 2px !important;
}

.stat-tile {
  border-radius: 10px;
  background: #f8fafc;
  padding: 10px 12px;
}

.stat-label {
  font-size: 11px;
  color: #94a3b8;
}

.stat-value {
  margin-top: 4px;
  font-weight: 600;
  color: #1e293b;
}

.stat-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #64748b;
}

.api-example {
  font-size: 11px;
  line-height: 1.55;
  color: #64748b;
  background: #f8fafc;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  overflow-x: auto;
}

.channel-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.channel-card {
  border: 1px solid var(--app-border);
  border-radius: 14px;
  padding: 14px;
  background: #fafbfc;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.channel-card.active {
  background: #f0f7ff;
  border-color: rgba(37, 99, 235, 0.28);
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.06);
}

.channel-card.default {
  border-color: rgba(16, 185, 129, 0.4);
  background: #f0fdf4;
}

.channel-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.channel-card-actions {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.priority-box {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid var(--app-border);
}

.priority-input {
  width: 90px;
}

.empty-hint {
  padding: 24px;
  text-align: center;
  color: #94a3b8;
  font-size: 14px;
  background: #f8fafc;
  border-radius: 12px;
}

.tpl-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
}

.tpl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: #fafbfc;
}
</style>
