<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">发送记录</div>
        <div class="page-subtitle">全量审计 · 筛选导出 · 定时发送 · 重发 / 批量</div>
      </div>
      <div class="flex flex-wrap gap-2">
        <n-button secondary type="error" :loading="clearing" @click="confirmClear">清空日志</n-button>
        <n-button secondary @click="previewCleanup">预览清理历史记录</n-button>
        <n-button secondary :loading="exporting" @click="doExport">导出 CSV</n-button>
        <n-button
          secondary
          type="warning"
          :loading="batchResending"
          :disabled="!canBatchResend"
          @click="doBatchResend"
        >
          重发失败邮件
        </n-button>
        <n-button secondary @click="showSchedule = true">定时发送</n-button>
        <n-button secondary @click="showBatch = true">批量发送</n-button>
        <n-button type="primary" @click="openSend">调试发送</n-button>
      </div>
    </div>

    <div class="page-card p-3 md:p-4 space-y-3">
      <div class="filters-row">
        <n-input
          v-model:value="filters.q"
          clearable
          placeholder="关键词（标题/内容/错误/收件人）"
          class="w-full sm:w-56"
          @keyup.enter="reload"
          @clear="reload"
        />
        <n-input
          v-model:value="filters.toAddress"
          clearable
          placeholder="收件人"
          class="w-full sm:w-44"
          @keyup.enter="reload"
          @clear="reload"
        />
        <n-date-picker
          v-model:value="dateRange"
          type="datetimerange"
          clearable
          class="w-full sm:w-auto"
          @update:value="reload"
        />
        <n-select
          v-model:value="filters.projectId"
          clearable
          placeholder="全部项目"
          class="w-full sm:w-44"
          :options="projectOptions"
          @update:value="reload"
        />
        <n-select
          v-model:value="filters.status"
          clearable
          placeholder="全部状态"
          class="w-full sm:w-32"
          :options="statusOptions"
          :disabled="filters.onlySmtpFailed"
          @update:value="reload"
        />
        <n-select
          v-model:value="filters.channelType"
          clearable
          placeholder="全部渠道"
          class="w-full sm:w-36"
          :options="channelOptions"
          :disabled="filters.onlySmtpFailed"
          @update:value="reload"
        />
        <div class="flex items-center gap-2 text-sm text-slate-600">
          <n-switch v-model:value="filters.hasError" @update:value="reload" />
          <span>仅失败/有错误</span>
        </div>
        <div class="flex items-center gap-2 text-sm text-slate-600">
          <n-switch v-model:value="filters.onlySmtpFailed" @update:value="onOnlySmtpFailed" />
          <span>仅 SMTP 失败</span>
        </div>
        <n-button @click="reload">刷新</n-button>
      </div>

      <div class="table-shell !border-0 !shadow-none !p-0">
        <n-data-table
          :columns="columns"
          :data="items"
          :loading="loading"
          :bordered="false"
          :pagination="pagination"
          :scroll-x="1120"
          @update:page="onPage"
        />
      </div>
    </div>

    <n-drawer v-model:show="showDetail" :width="detailWidth" placement="right">
      <n-drawer-content title="消息详情" closable>
        <template v-if="detail">
          <n-descriptions label-placement="left" :column="1" size="small">
            <n-descriptions-item label="ID">
              <span class="mr-2 break-all">{{ detail.id }}</span>
              <n-button size="tiny" secondary @click="copyText(detail.id, '消息 ID')">复制</n-button>
            </n-descriptions-item>
            <n-descriptions-item label="项目">{{ detail.project?.name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="渠道">
              {{ detail.channel?.name || '-' }} /
              {{ CHANNEL_TYPE_LABELS[detail.channelType] || detail.channelType }}
            </n-descriptions-item>
            <n-descriptions-item label="来源">{{ SOURCE_LABELS[detail.source] || detail.source }}</n-descriptions-item>
            <n-descriptions-item label="状态">{{ STATUS_LABELS[detail.status] || detail.status }}</n-descriptions-item>
            <n-descriptions-item label="优先级">{{ detail.priority || 'NORMAL' }}</n-descriptions-item>
            <n-descriptions-item label="标题">{{ detail.title || '-' }}</n-descriptions-item>
            <n-descriptions-item label="收件人">
              <span>{{ detail.toAddress || '-' }}</span>
              <n-button
                v-if="detail.toAddress"
                size="tiny"
                text
                type="primary"
                class="ml-2"
                @click="openTimeline(detail.toAddress)"
              >
                时间线
              </n-button>
            </n-descriptions-item>
            <n-descriptions-item label="模板">{{ detail.templateCode || '-' }}</n-descriptions-item>
            <n-descriptions-item label="事件">{{ detail.eventCode || '-' }}</n-descriptions-item>
            <n-descriptions-item label="父消息">{{ detail.parentId || '-' }}</n-descriptions-item>
            <n-descriptions-item label="重试次数">{{ detail.attempts ?? 0 }}</n-descriptions-item>
            <n-descriptions-item label="下次重试">{{ formatTime(detail.nextRetryAt) }}</n-descriptions-item>
            <n-descriptions-item label="耗时">{{ detail.durationMs ?? '-' }} ms</n-descriptions-item>
            <n-descriptions-item label="时间">{{ formatTime(detail.createdAt) }}</n-descriptions-item>
            <n-descriptions-item label="已读">
              <template v-if="detail.readAt">{{ formatTime(detail.readAt) }}</template>
              <template v-else>未读</template>
            </n-descriptions-item>
            <n-descriptions-item label="邮件兜底">
              <template v-if="detail.payload?.emailFallback">
                已发送邮件兜底
                <span v-if="detail.payload.emailFallback.at"> · {{ formatTime(detail.payload.emailFallback.at) }}</span>
                <span v-if="detail.payload.emailFallback.to"> · {{ detail.payload.emailFallback.to }}</span>
              </template>
              <template v-else>未使用</template>
            </n-descriptions-item>
            <n-descriptions-item label="归档">{{ detail.archivedAt ? formatTime(detail.archivedAt) : '-' }}</n-descriptions-item>
            <n-descriptions-item label="错误">
              <span class="text-red-500 break-all">{{ formatErrorMessage(detail.errorMessage) }}</span>
              <n-button
                v-if="detail.errorMessage"
                size="tiny"
                secondary
                class="ml-2"
                @click="copyText(formatErrorMessage(detail.errorMessage, 2000), '错误信息')"
              >
                复制
              </n-button>
            </n-descriptions-item>
          </n-descriptions>
          <div v-if="Array.isArray(detail.attemptDetail) && detail.attemptDetail.length" class="mt-4">
            <div class="text-sm font-medium mb-1">重试时间线</div>
            <div class="space-y-1 text-xs">
              <div
                v-for="(a, i) in detail.attemptDetail"
                :key="i"
                class="bg-slate-50 rounded px-2 py-1 flex justify-between gap-2"
              >
                <span>#{{ a.n }} · {{ a.status }} · {{ a.durationMs ?? '-' }}ms</span>
                <span class="text-slate-400">{{ formatTime(a.at) }}</span>
              </div>
              <div v-for="(a, i) in detail.attemptDetail" :key="'e'+i" class="text-rose-500 pl-1" v-show="a.error">
                {{ a.error }}
              </div>
            </div>
          </div>
          <div v-if="detailHtml" class="mt-4">
            <div class="text-sm font-medium mb-1">HTML 预览</div>
            <SafeHtmlPreview :html="detailHtml" class="html-preview-frame" />
          </div>
          <div class="mt-4 space-y-2" v-if="deliveryTimeline.length">
            <div class="text-sm font-medium">投递时间线</div>
            <div v-for="attempt in deliveryTimeline" :key="attempt.id" class="rounded bg-slate-50 p-3 text-sm">
              {{ formatTime(attempt.createdAt) }} · {{ CHANNEL_TYPE_LABELS[attempt.channelType] || '站内' }} · {{ STATUS_LABELS[attempt.status] || attempt.status }}
              <div v-if="attempt.errorMessage" class="text-red-600">{{ attempt.errorMessage }}</div>
            </div>
          </div>
          <div class="mt-4">
            <div class="text-sm font-medium mb-1">内容</div>
            <pre class="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap">{{ detail.content }}</pre>
          </div>
          <div class="mt-3">
            <div class="text-sm font-medium mb-1">响应</div>
            <pre class="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-48">{{ JSON.stringify(detail.response, null, 2) }}</pre>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <n-button type="primary" :loading="resending === detail.id" @click="doResend(detail.id)">重发此消息</n-button>
            <n-button secondary @click="markReadOne(detail.id)">标为已读</n-button>
            <n-button secondary @click="archiveOne(detail.id, !detail.archivedAt)">
              {{ detail.archivedAt ? '取消归档' : '归档' }}
            </n-button>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>

    <n-drawer v-model:show="showTimeline" :width="detailWidth" placement="right">
      <n-drawer-content :title="`收件人时间线 · ${timelineAddress}`" closable>
        <div v-if="timelineSuppresses.length" class="mb-3">
          <div class="text-sm font-medium mb-1">抑制状态</div>
          <div v-for="s in timelineSuppresses" :key="s.id" class="text-xs bg-amber-50 text-amber-800 rounded px-2 py-1 mb-1">
            {{ s.source }} · {{ s.reason || '-' }} · {{ formatTime(s.createdAt) }}
          </div>
        </div>
        <n-data-table size="small" :columns="timelineColumns" :data="timelineMessages" :bordered="false" />
      </n-drawer-content>
    </n-drawer>

    <n-modal
      v-model:show="showSend"
      preset="card"
      content-scrollable
      title="调试发送"
      style="width: min(620px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <n-form label-placement="top">
        <n-form-item label="项目" required>
          <n-select
            v-model:value="sendForm.projectId"
            :options="projectOptions"
            placeholder="选择项目"
            @update:value="onSendProject"
          />
        </n-form-item>
        <n-form-item label="渠道类型">
          <n-select
            v-model:value="sendForm.channelType"
            clearable
            :options="sendChannelTypeOptions"
            :loading="loadingSendChannels"
            :placeholder="
              sendForm.projectId
                ? sendChannelTypeOptions.length
                  ? '默认渠道 / 指定已启用类型'
                  : '该项目暂无已启用渠道'
                : '请先选择项目'
            "
            :disabled="!sendForm.projectId || !sendChannelTypeOptions.length"
            @update:value="onSendChannelType"
          />
        </n-form-item>

        <template v-if="sendForm.channelType !== 'SMTP'">
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
              模板变量 · 调用时对应
              <code>pushTemplate: "{{ sendForm.pushTemplate }}"</code>
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
            <span class="text-xs text-slate-400">预览仅本地渲染，不会真正发送</span>
          </div>
          <div
            v-if="pushPreview"
            class="mb-4 rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm space-y-2"
          >
            <div>
              <span class="text-slate-400">标题：</span>{{ pushPreview.title || '（空）' }}
            </div>
            <div class="whitespace-pre-wrap">
              <span class="text-slate-400">正文：</span>{{ pushPreview.content || '（空）' }}
            </div>
          </div>
        </template>

        <n-form-item
          :label="sendForm.pushTemplate && sendForm.channelType !== 'SMTP' ? '标题（模板未覆盖时兜底）' : '标题'"
        >
          <n-input
            v-model:value="sendForm.title"
            placeholder="通知标题"
            :disabled="!!sendForm.pushTemplate && sendForm.channelType !== 'SMTP'"
          />
        </n-form-item>
        <n-form-item
          :label="sendForm.pushTemplate && sendForm.channelType !== 'SMTP' ? '内容（模板未覆盖时兜底）' : '内容'"
        >
          <n-input
            v-model:value="sendForm.content"
            type="textarea"
            :rows="4"
            placeholder="正文"
            :disabled="!!sendForm.pushTemplate && sendForm.channelType !== 'SMTP'"
          />
        </n-form-item>

        <template v-if="sendForm.channelType === 'SMTP'">
          <n-form-item label="收件人" required>
            <n-input v-model:value="sendForm.to" placeholder="user@example.com" />
          </n-form-item>
          <n-form-item label="邮件模板 code（可选）">
            <n-select
              v-model:value="sendForm.template"
              clearable
              filterable
              :options="mailTemplateOptions"
              :loading="loadingMailTpls"
              placeholder="不选则用上方标题/内容"
              @update:value="onMailTemplateChange"
            />
          </n-form-item>
          <template v-if="sendForm.template && mailVarKeys.length">
            <div class="mb-1 text-xs text-slate-400">邮件模板变量</div>
            <n-form-item v-for="key in mailVarKeys" :key="key" :label="key">
              <n-input v-model:value="sendForm.variables[key]" :placeholder="`{{${key}}}`" />
            </n-form-item>
          </template>
          <n-form-item v-else-if="sendForm.template" label="变量 JSON">
            <n-input
              v-model:value="sendForm.variablesJson"
              type="textarea"
              :rows="4"
              placeholder='{"appName":"消息推送","code":"123456"}'
            />
          </n-form-item>
        </template>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showSend = false">取消</n-button>
          <n-button type="primary" :loading="sending" @click="doSend">发送</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showBatch"
      preset="card"
      content-scrollable
      title="批量发送"
      style="width: min(560px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <n-form label-placement="top">
        <n-form-item label="项目" required>
          <n-select
            v-model:value="batchForm.projectId"
            :options="projectOptions"
            placeholder="选择项目"
            @update:value="onBatchProject"
          />
        </n-form-item>
        <n-form-item label="渠道（多选，空=全部已启用）">
          <n-select
            v-model:value="batchForm.channelIds"
            multiple
            clearable
            :options="batchChannelOptions"
            placeholder="不选则发送到项目全部已启用渠道"
          />
        </n-form-item>
        <n-form-item label="标题">
          <n-input v-model:value="batchForm.title" />
        </n-form-item>
        <n-form-item label="内容">
          <n-input v-model:value="batchForm.content" type="textarea" :rows="4" />
        </n-form-item>
        <n-form-item label="SMTP 收件人（若含邮件渠道）">
          <n-input v-model:value="batchForm.to" placeholder="user@example.com" />
        </n-form-item>
      </n-form>
      <div v-if="batchPreviewResult" class="rounded-lg bg-slate-50 p-3 space-y-2 text-sm">
        <div class="font-medium">预检结果 · {{ batchPreviewResult.valid ? '校验通过' : '请修正无效项' }}</div>
        <div>渠道 {{ batchPreviewResult.items.length }} 个 · 有效 {{ batchPreviewResult.items.filter(i => i.valid).length }} 个 · 预计首次发送 {{ batchPreviewResult.estimatedSendAttempts }} 次 · 去重 {{ batchPreviewResult.duplicates.length }} 项</div>
        <div class="text-xs text-slate-500">重试和兜底可能增加实际发送次数。</div>
        <div v-for="(item, index) in batchPreviewResult.items" :key="`${item.channelId}-${index}`" :class="item.valid ? 'text-slate-600' : 'text-red-600'">
          {{ CHANNEL_TYPE_LABELS[item.channelType || ''] || item.channelType || '未知渠道' }} · {{ item.channelId || '-' }}
          <span v-if="item.recipient"> · {{ item.recipient }}</span>
          · {{ item.valid ? '有效' : item.errorMessage }}
        </div>
        <div v-if="!batchPreviewResult.items.length" class="text-red-600">未找到可发送渠道。</div>
        <div v-if="batchPreviewResult.smtpQuota" class="text-slate-600">
          SMTP 今日配额（{{ batchPreviewResult.smtpQuota.timezone }}）：已用 {{ batchPreviewResult.smtpQuota.used }} / {{ batchPreviewResult.smtpQuota.limit ?? '不限' }}，剩余 {{ batchPreviewResult.smtpQuota.remaining ?? '不限' }}。
          <div class="text-xs text-slate-500">配额仅供预估，未预占；实际发送时重新校验。</div>
        </div>
      </div>
      <p v-else-if="batchPreviewStale" class="text-sm text-amber-700">输入已修改，请重新预检。</p>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showBatch = false">取消</n-button>
          <n-button secondary :loading="batchPreviewing" :disabled="batching" @click="previewBatch">预检（不发送）</n-button>
          <n-button type="primary" :loading="batching" :disabled="batchPreviewing" @click="doBatch">预检并确认发送</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showSchedule"
      preset="card"
      content-scrollable
      title="定时发送"
      style="width: min(560px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <n-form label-placement="top">
        <n-form-item label="项目" required>
          <n-select v-model:value="scheduleForm.projectId" :options="projectOptions" placeholder="选择项目" />
        </n-form-item>
        <n-form-item label="渠道类型">
          <n-select
            v-model:value="scheduleForm.channelType"
            clearable
            :options="channelOptions"
            placeholder="默认渠道 / 指定类型"
          />
        </n-form-item>
        <n-form-item label="标题">
          <n-input v-model:value="scheduleForm.title" placeholder="通知标题" />
        </n-form-item>
        <n-form-item label="内容">
          <n-input v-model:value="scheduleForm.content" type="textarea" :rows="4" placeholder="正文" />
        </n-form-item>
        <n-form-item label="执行时间" required>
          <n-date-picker
            v-model:value="scheduleForm.runAt"
            type="datetime"
            class="w-full"
            clearable
          />
        </n-form-item>
        <n-form-item label="每日重复">
          <n-switch v-model:value="scheduleForm.daily" />
          <span class="ml-2 text-xs text-slate-400">开启后按每日同一时刻重复</span>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showSchedule = false">取消</n-button>
          <n-button type="primary" :loading="scheduling" @click="doSchedule">创建定时</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import SafeHtmlPreview from '@/components/SafeHtmlPreview.vue';
import { computed, h, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NDataTable,
  NSelect,
  NTag,
  NDrawer,
  NDrawerContent,
  NDescriptions,
  NDescriptionsItem,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSpace,
  NDatePicker,
  NSwitch,
  useMessage,
  useDialog,
} from 'naive-ui';
import { messagesApi, projectsApi, channelsApi, schedulesApi, pushTemplatesApi, templatesApi } from '@/api';
import {
  CHANNEL_TYPE_LABELS,
  CHANNEL_TYPES,
  STATUS_LABELS,
  SOURCE_LABELS,
  formatTime,
  statusTagType,
  formatErrorMessage,
} from '@/utils/labels';

const items = ref<any[]>([]);
const loading = ref(false);
const exporting = ref(false);
const batchResending = ref(false);
const page = ref(1);
const pageSize = 20;
const showDetail = ref(false);
const detail = ref<any>(null);
const deliveryTimeline = ref<any[]>([]);
const showTimeline = ref(false);
const timelineAddress = ref('');
const timelineMessages = ref<any[]>([]);
const timelineSuppresses = ref<any[]>([]);
const projectOptions = ref<{ label: string; value: string }[]>([]);
const showSend = ref(false);
const showBatch = ref(false);
const showSchedule = ref(false);
const sending = ref(false);
const batching = ref(false);
const batchPreviewing = ref(false);
type BatchPreview = {
  projectId: string;
  items: { channelId?: string; channelType?: string; recipient?: string; valid: boolean; errorMessage?: string }[];
  duplicates: { channelId: string; selectedBy: string }[];
  estimatedSendAttempts: number;
  smtpQuota: { limit: number | null; used: number; remaining: number | null; advisory: boolean; timezone: string } | null;
  valid: boolean;
};
const batchPreviewResult = ref<BatchPreview | null>(null);
const batchPreviewStale = ref(false);
const scheduling = ref(false);
const clearing = ref(false);
const resending = ref<string | null>(null);
const message = useMessage();
const dialog = useDialog();
const batchChannelOptions = ref<{ label: string; value: string }[]>([]);
const dateRange = ref<[number, number] | null>(null);

const loadingPushTpls = ref(false);
const loadingMailTpls = ref(false);
const loadingSendChannels = ref(false);
const previewing = ref(false);
const pushTemplateList = ref<any[]>([]);
const mailTemplateList = ref<any[]>([]);
const pushVarKeys = ref<string[]>([]);
const mailVarKeys = ref<string[]>([]);
const pushPreview = ref<{ title?: string; content?: string } | null>(null);
const selectedPushTplId = ref<string | null>(null);
const sendChannelTypeOptions = ref<{ label: string; value: string }[]>([]);

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
  code: '123456',
  name: '张三',
};

const detailWidth = computed(() =>
  typeof window !== 'undefined' && window.innerWidth < 640 ? window.innerWidth - 16 : 520,
);

const filters = reactive({
  q: '',
  toAddress: '',
  projectId: null as string | null,
  status: null as string | null,
  channelType: null as string | null,
  hasError: false,
  onlySmtpFailed: false,
});

const detailHtml = computed(() => {
  const p = detail.value?.payload;
  if (!p || typeof p !== 'object') return '';
  const html = (p as any).html;
  return typeof html === 'string' && html.trim() ? html : '';
});

const canBatchResend = computed(
  () =>
    filters.onlySmtpFailed ||
    filters.channelType === 'SMTP' ||
    filters.hasError ||
    !!filters.toAddress?.trim(),
);

const sendForm = reactive({
  projectId: null as string | null,
  channelType: null as string | null,
  title: '调试消息',
  content: '来自管理后台的测试发送',
  to: '',
  template: null as string | null,
  pushTemplate: null as string | null,
  variables: {} as Record<string, string>,
  variablesJson: '',
});

const batchForm = reactive({
  projectId: null as string | null,
  channelIds: [] as string[],
  title: '批量通知',
  content: '这是一条批量发送的消息',
  to: '',
});
watch(batchForm, () => {
  if (batchPreviewResult.value) batchPreviewStale.value = true;
  batchPreviewResult.value = null;
}, { deep: true, flush: 'sync' });

const scheduleForm = reactive({
  projectId: null as string | null,
  channelType: null as string | null,
  title: '定时通知',
  content: '这是一条定时发送的消息',
  runAt: null as number | null,
  daily: false,
});

const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({ label, value }));
const channelOptions = CHANNEL_TYPES.map((t) => ({ label: CHANNEL_TYPE_LABELS[t], value: t }));

const pushTemplateOptions = computed(() =>
  pushTemplateList.value.map((t) => ({
    label: `${t.name}（${t.code}）${t.projectId ? ' · 项目' : ' · 全局'}`,
    value: t.code,
  })),
);

const mailTemplateOptions = computed(() =>
  mailTemplateList.value.map((t) => ({
    label: `${t.name}（${t.code}）${t.projectId ? ' · 项目' : ' · 全局'}`,
    value: t.code,
  })),
);

const pagination = reactive({
  page: 1,
  pageSize,
  itemCount: 0,
  showSizePicker: false,
});

function listParams() {
  const params: Record<string, any> = {
    projectId: filters.projectId || undefined,
    status: filters.onlySmtpFailed ? undefined : filters.status || undefined,
    channelType: filters.onlySmtpFailed ? undefined : filters.channelType || undefined,
    q: filters.q?.trim() || undefined,
    toAddress: filters.toAddress?.trim() || undefined,
    hasError: filters.hasError ? true : undefined,
    onlySmtpFailed: filters.onlySmtpFailed ? true : undefined,
    page: page.value,
    pageSize,
  };
  if (dateRange.value) {
    params.from = new Date(dateRange.value[0]).toISOString();
    params.to = new Date(dateRange.value[1]).toISOString();
  }
  return params;
}

function onOnlySmtpFailed() {
  if (filters.onlySmtpFailed) {
    filters.status = 'FAILED';
    filters.channelType = 'SMTP';
  }
  reload();
}

function pickDemoVars(keys: string[]) {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = DEMO_VARS[k] ?? `示例${k}`;
  return out;
}

function collectVariables(): Record<string, unknown> | undefined {
  if (pushVarKeys.value.length || mailVarKeys.value.length) {
    const keys = pushVarKeys.value.length ? pushVarKeys.value : mailVarKeys.value;
    const vars: Record<string, unknown> = {};
    for (const k of keys) {
      const v = sendForm.variables[k];
      if (v !== undefined && v !== '') vars[k] = v;
    }
    return Object.keys(vars).length ? vars : {};
  }
  if (sendForm.variablesJson?.trim()) {
    try {
      return JSON.parse(sendForm.variablesJson);
    } catch {
      throw new Error('变量 JSON 格式无效');
    }
  }
  return undefined;
}

async function copyText(text: string, label = '内容') {
  try {
    await navigator.clipboard.writeText(text);
    message.success(`已复制${label}`);
  } catch {
    message.error('复制失败');
  }
}

const columns = [
  {
    title: '时间',
    key: 'createdAt',
    width: 160,
    render: (r: any) => formatTime(r.createdAt),
  },
  {
    title: '项目',
    key: 'project',
    width: 120,
    render: (r: any) => r.project?.name || '-',
  },
  {
    title: '渠道',
    key: 'channelType',
    width: 110,
    render: (r: any) => CHANNEL_TYPE_LABELS[r.channelType] || r.channelType || '-',
  },
  {
    title: '来源',
    key: 'source',
    width: 100,
    render: (r: any) => SOURCE_LABELS[r.source] || r.source,
  },
  { title: '标题', key: 'title', width: 180, ellipsis: { tooltip: true } },
  {
    title: '收件人',
    key: 'toAddress',
    width: 140,
    ellipsis: { tooltip: true },
    render: (r: any) => r.toAddress || '-',
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (r: any) =>
      h(
        NTag,
        { size: 'small', type: statusTagType(r.status) },
        { default: () => STATUS_LABELS[r.status] || r.status },
      ),
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    fixed: 'right' as const,
    render: (r: any) =>
      h(NSpace, { wrap: false, size: 4 }, {
        default: () => {
          const btns = [
            h(NButton, { size: 'small', onClick: () => openDetail(r.id) }, { default: () => '详情' }),
            h(
              NButton,
              {
                size: 'small',
                secondary: true,
                onClick: () => copyText(r.id, '消息 ID'),
              },
              { default: () => '复制ID' },
            ),
            h(
              NButton,
              {
                size: 'small',
                type: 'primary',
                secondary: true,
                loading: resending.value === r.id,
                onClick: () => doResend(r.id),
              },
              { default: () => '重发' },
            ),
          ];
          if (r.errorMessage) {
            btns.push(
              h(
                NButton,
                {
                  size: 'small',
                  type: 'error',
                  secondary: true,
                  onClick: () => copyText(formatErrorMessage(r.errorMessage, 2000), '错误信息'),
                },
                { default: () => '复制错误' },
              ),
            );
          }
          return btns;
        },
      }),
  },
];

async function load() {
  loading.value = true;
  try {
    const res: any = await messagesApi.list(listParams());
    items.value = res?.items || [];
    pagination.itemCount = res?.total || 0;
    pagination.page = page.value;
  } finally {
    loading.value = false;
  }
}

function reload() {
  page.value = 1;
  load();
}

function onPage(p: number) {
  page.value = p;
  load();
}

async function openDetail(id: string) {
  deliveryTimeline.value = [];
  detail.value = await messagesApi.get(id);
  showDetail.value = true;
  try { const timeline: any = await messagesApi.timeline(id); deliveryTimeline.value = timeline.attempts || []; }
  catch { message.warning('投递时间线暂时不可用'); }
  // 站内消息打开详情时自动标记已读；设备推送（JPUSH 等）仅以客户端回执为准
  const ct = detail.value?.channelType;
  const isDevicePush =
    ct === 'JPUSH' || ct === 'BARK' || ct === 'GOTIFY' || ct === 'SERVERCHAN' || ct === 'PUSHPLUS';
  if (detail.value && !detail.value.readAt && !isDevicePush) {
    try {
      await messagesApi.markRead([id]);
      detail.value.readAt = new Date().toISOString();
    } catch {
      /* ignore */
    }
  }
}

async function openTimeline(address: string) {
  timelineAddress.value = address;
  showTimeline.value = true;
  try {
    const data: any = await messagesApi.recipientTimeline({ address, limit: 50 });
    timelineMessages.value = data.messages || [];
    timelineSuppresses.value = data.suppresses || [];
  } catch (e: any) {
    message.error(e.message || '加载时间线失败');
  }
}

const timelineColumns = [
  {
    title: '时间',
    key: 'createdAt',
    width: 150,
    render: (r: any) => formatTime(r.createdAt),
  },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render: (r: any) => STATUS_LABELS[r.status] || r.status,
  },
  {
    title: '渠道',
    key: 'channelType',
    width: 90,
    render: (r: any) => CHANNEL_TYPE_LABELS[r.channelType] || r.channelType || '站内',
  },
  {
    title: '标题',
    key: 'title',
    ellipsis: { tooltip: true },
    render: (r: any) => r.title || '-',
  },
];

async function doExport() {
  exporting.value = true;
  try {
    const params = listParams();
    delete params.page;
    delete params.pageSize;
    const blob = await messagesApi.exportCsv(params);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `messages-${ymd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('已导出 CSV');
  } catch (e: any) {
    message.error(e.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

async function doBatchResend() {
  dialog.warning({
    title: '重发失败邮件',
    content: '将按当前筛选条件重发最多 20 条失败邮件（默认仅 SMTP 失败）。是否继续？',
    positiveText: '重发',
    negativeText: '取消',
    onPositiveClick: async () => {
      batchResending.value = true;
      try {
        const params = listParams();
        const res: any = await messagesApi.batchResend({
          projectId: params.projectId,
          toAddress: params.toAddress,
          onlySmtpFailed: params.onlySmtpFailed !== false,
          from: params.from,
          to: params.to,
          limit: 20,
        });
        message.success(`已处理 ${res?.total || 0} 条：成功 ${res?.success || 0}，失败 ${res?.failed || 0}`);
        load();
      } catch (e: any) {
        message.error(e?.message || '批量重发失败');
      } finally {
        batchResending.value = false;
      }
    },
  });
}

async function doSend() {
  if (!sendForm.projectId) {
    message.warning('请选择项目');
    return;
  }
  if (sendForm.channelType === 'SMTP' && !sendForm.to?.trim()) {
    message.warning('邮件发送需要填写收件人');
    return;
  }

  let variables: Record<string, unknown> | undefined;
  try {
    if (sendForm.pushTemplate || sendForm.template) {
      variables = collectVariables();
    }
  } catch (e: any) {
    message.warning(e.message);
    return;
  }

  sending.value = true;
  try {
    const payload: Record<string, any> = {
      projectId: sendForm.projectId,
      channelType: sendForm.channelType || undefined,
    };

    if (sendForm.channelType === 'SMTP') {
      payload.to = sendForm.to || undefined;
      payload.template = sendForm.template || undefined;
      payload.title = sendForm.title;
      payload.content = sendForm.content;
      if (variables) payload.variables = variables;
    } else if (sendForm.pushTemplate) {
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
    await load();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    sending.value = false;
  }
}

async function loadPushTemplates(projectId: string | null) {
  loadingPushTpls.value = true;
  try {
    pushTemplateList.value =
      (await pushTemplatesApi.list({
        ...(projectId ? { projectId } : {}),
        enabled: true,
        includeGlobal: !!projectId,
      })) || [];
  } catch (e: any) {
    message.error(e.message || '加载推送模板失败');
    pushTemplateList.value = [];
  } finally {
    loadingPushTpls.value = false;
  }
}

async function loadMailTemplates(projectId: string | null) {
  loadingMailTpls.value = true;
  try {
    mailTemplateList.value =
      (await templatesApi.list({
        ...(projectId ? { projectId } : {}),
        enabled: true,
        includeGlobal: !!projectId,
      })) || [];
  } catch (e: any) {
    message.error(e.message || '加载邮件模板失败');
    mailTemplateList.value = [];
  } finally {
    loadingMailTpls.value = false;
  }
}

async function loadSendChannelTypes(projectId: string | null) {
  sendChannelTypeOptions.value = [];
  if (!projectId) return;
  loadingSendChannels.value = true;
  try {
    const opts: any[] = (await channelsApi.listOptions(projectId)) || [];
    const types = new Set<string>();
    for (const o of opts) {
      // 项目已启用绑定，且全局渠道处于启用状态
      if (o.bindingEnabled && o.enabled !== false && o.type) types.add(o.type);
    }
    sendChannelTypeOptions.value = Array.from(types).map((t) => ({
      label: CHANNEL_TYPE_LABELS[t] || t,
      value: t,
    }));
    // 当前选中类型不在可用列表中时清空
    if (
      sendForm.channelType &&
      !sendChannelTypeOptions.value.some((o) => o.value === sendForm.channelType)
    ) {
      sendForm.channelType = null;
    }
  } catch (e: any) {
    message.error(e.message || '加载渠道失败');
  } finally {
    loadingSendChannels.value = false;
  }
}

function resetTemplateFields() {
  sendForm.pushTemplate = null;
  sendForm.template = null;
  sendForm.variables = {};
  sendForm.variablesJson = '';
  pushVarKeys.value = [];
  mailVarKeys.value = [];
  pushPreview.value = null;
  selectedPushTplId.value = null;
}

async function openSend() {
  resetTemplateFields();
  sendForm.title = '调试消息';
  sendForm.content = '来自管理后台的测试发送';
  sendForm.to = '';
  showSend.value = true;
  if (sendForm.projectId) {
    await Promise.all([
      loadPushTemplates(sendForm.projectId),
      loadSendChannelTypes(sendForm.projectId),
      sendForm.channelType === 'SMTP' ? loadMailTemplates(sendForm.projectId) : Promise.resolve(),
    ]);
  }
}

async function onSendProject(projectId: string | null) {
  resetTemplateFields();
  sendForm.channelType = null;
  if (!projectId) {
    pushTemplateList.value = [];
    mailTemplateList.value = [];
    sendChannelTypeOptions.value = [];
    return;
  }
  await Promise.all([loadPushTemplates(projectId), loadSendChannelTypes(projectId)]);
}

async function onSendChannelType(type: string | null) {
  if (type === 'SMTP') {
    sendForm.pushTemplate = null;
    pushVarKeys.value = [];
    pushPreview.value = null;
    selectedPushTplId.value = null;
    if (sendForm.projectId) await loadMailTemplates(sendForm.projectId);
  } else {
    sendForm.template = null;
    mailVarKeys.value = [];
    if (sendForm.projectId) await loadPushTemplates(sendForm.projectId);
  }
  sendForm.variables = {};
  sendForm.variablesJson = '';
}

async function previewCleanup() {
  const before = dateRange.value?.[1] ? new Date(dateRange.value[1]).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
  const data = { before, projectId: filters.projectId || undefined };
  try {
    const result: any = await messagesApi.cleanup({ ...data, preview: true });
    dialog.warning({ title: '清理预览', content: `清理 ${formatTime(before)} 之前符合条件的 ${result.matched} 条已结束记录。正在投递或仍被任务引用的记录将保留。`, positiveText: '执行清理', negativeText: '取消', onPositiveClick: async () => {
      try { const removed: any = await messagesApi.cleanup(data); message.success(`已清理 ${removed.deleted} 条`); reload(); }
      catch (e: any) { message.error(e.message); }
    } });
  } catch (e: any) { message.error(e.message); }
}

function confirmClear() {
  const projectLabel = filters.projectId
    ? projectOptions.value.find((p) => p.value === filters.projectId)?.label || '当前项目'
    : '全部项目';
  const scope = filters.hasError ? '仅失败/有错误的记录' : '全部发送记录';
  dialog.warning({
    title: '清空日志',
    content: `确认清空「${projectLabel}」下的${scope}？此操作不可恢复。`,
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      clearing.value = true;
      try {
        const res: any = await messagesApi.clear({
          projectId: filters.projectId || undefined,
          onlyFailed: filters.hasError || undefined,
        });
        message.success(`已清空 ${res?.deleted ?? 0} 条记录`);
        await reload();
      } catch (e: any) {
        message.error(e.message || '清空失败');
      } finally {
        clearing.value = false;
      }
    },
  });
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
  if (keys.length) {
    sendForm.variables = pickDemoVars(keys);
  } else {
    sendForm.variablesJson = '{\n  \n}';
  }
}

function onMailTemplateChange(code: string | null) {
  sendForm.variables = {};
  sendForm.variablesJson = '';
  mailVarKeys.value = [];
  if (!code) return;
  const tpl = mailTemplateList.value.find((t) => t.code === code);
  if (!tpl) return;
  const keys = Array.isArray(tpl.variables) ? tpl.variables : [];
  mailVarKeys.value = keys;
  if (keys.length) {
    sendForm.variables = pickDemoVars(keys);
  } else {
    sendForm.variablesJson = '{\n  \n}';
  }
}

async function doPreviewPush() {
  if (!selectedPushTplId.value) {
    message.warning('请先选择推送模板');
    return;
  }
  let variables: Record<string, unknown>;
  try {
    variables = collectVariables() || {};
  } catch (e: any) {
    message.warning(e.message);
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

async function doResend(id: string) {
  resending.value = id;
  try {
    const res: any = await messagesApi.resend(id);
    if (res?.success === false) message.error(res.errorMessage || '重发失败');
    else message.success('已重发');
    await load();
    if (showDetail.value && detail.value?.id === id) {
      detail.value = await messagesApi.get(id);
    }
  } catch (e: any) {
    message.error(e.message);
  } finally {
    resending.value = null;
  }
}

async function markReadOne(id: string) {
  try {
    await messagesApi.markRead([id]);
    message.success('已标为已读');
    if (detail.value?.id === id) detail.value.readAt = new Date().toISOString();
  } catch (e: any) {
    message.error(e.message);
  }
}

async function archiveOne(id: string, archived: boolean) {
  try {
    await messagesApi.archive([id], archived);
    message.success(archived ? '已归档' : '已取消归档');
    await load();
    if (detail.value?.id === id) detail.value = await messagesApi.get(id);
  } catch (e: any) {
    message.error(e.message);
  }
}

async function onBatchProject(projectId: string | null) {
  batchForm.channelIds = [];
  batchChannelOptions.value = [];
  if (!projectId) return;
  try {
    const opts: any[] = (await channelsApi.listOptions(projectId)) || [];
    batchChannelOptions.value = opts
      .filter((o) => o.bindingEnabled && o.enabled !== false)
      .map((o) => ({
        label: `${o.name}（${CHANNEL_TYPE_LABELS[o.type] || o.type}）`,
        value: o.id,
      }));
  } catch (e: any) {
    message.error(e.message);
  }
}

function batchPayload() {
  return {
    projectId: batchForm.projectId!,
    channelIds: batchForm.channelIds.length ? [...batchForm.channelIds] : undefined,
    title: batchForm.title, content: batchForm.content, to: batchForm.to || undefined,
  };
}

async function previewBatch() {
  if (!batchForm.projectId) {
    message.warning('请选择项目');
    return null;
  }
  const payload = batchPayload();
  const fingerprint = JSON.stringify(payload);
  batchPreviewResult.value = null;
  batchPreviewing.value = true;
  try {
    const result: BatchPreview = await messagesApi.batchPreview(payload);
    if (fingerprint !== JSON.stringify(batchPayload())) { batchPreviewStale.value = true; return null; }
    batchPreviewResult.value = result; batchPreviewStale.value = false;
    return { result, payload, fingerprint };
  } catch (e: any) { message.error(e.message); return null; }
  finally { batchPreviewing.value = false; }
}

async function doBatch() {
  if (batching.value || batchPreviewing.value) return;
  const preview = await previewBatch();
  if (!preview) return;
  if (!preview.result.valid) { message.warning('请先修正预检中的无效项'); return; }
  let consumed = false;
  dialog.warning({
    title: '确认批量发送',
    content: `预检通过，预计向 ${preview.result.estimatedSendAttempts} 个渠道发送。${preview.result.duplicates.length ? `已去除 ${preview.result.duplicates.length} 个重复选择。` : ''}确认后将实际发送通知。`,
    positiveText: '确认发送', negativeText: '返回检查',
    onPositiveClick: async () => {
      if (batching.value || consumed) return false;
      if (preview.fingerprint !== JSON.stringify(batchPayload())) {
        batchPreviewResult.value = null; batchPreviewStale.value = true;
        message.warning('输入已修改，请重新预检并确认'); return false;
      }
      consumed = true;
      batching.value = true;
      try {
        const res: any = await messagesApi.batch(preview.payload);
        message.success(`批量完成：成功 ${res.success} / 失败 ${res.failed} / 共 ${res.total}`);
        showBatch.value = false; await load();
      } catch (e: any) { message.error(e.message); return false; }
      finally { batching.value = false; }
    },
  });
}

async function doSchedule() {
  if (!scheduleForm.projectId) {
    message.warning('请选择项目');
    return;
  }
  if (!scheduleForm.runAt) {
    message.warning('请选择执行时间');
    return;
  }
  scheduling.value = true;
  try {
    await schedulesApi.create({
      projectId: scheduleForm.projectId,
      channelType: scheduleForm.channelType || undefined,
      title: scheduleForm.title,
      content: scheduleForm.content,
      runAt: new Date(scheduleForm.runAt).toISOString(),
      cron: scheduleForm.daily ? 'daily' : undefined,
    });
    message.success('定时任务已创建');
    showSchedule.value = false;
  } catch (e: any) {
    message.error(e.message);
  } finally {
    scheduling.value = false;
  }
}

const route = useRoute();
const router = useRouter();

onMounted(async () => {
  try {
    const projs: any = (await projectsApi.list()) || [];
    projectOptions.value = projs.map((p: any) => ({ label: p.name, value: p.id }));
    if (projs[0]) {
      sendForm.projectId = projs[0].id;
      batchForm.projectId = projs[0].id;
      scheduleForm.projectId = projs[0].id;
      await onBatchProject(projs[0].id);
    }
  } catch (e) {
    console.error(e);
  }
  await load();
  const openId = String(route.query.open || '');
  if (openId) {
    await openDetail(openId);
    // 清除 query，避免刷新后重复打开详情
    router.replace({ path: '/messages', query: {} });
  }
});

watch(
  () => route.query.open,
  async (v) => {
    const id = String(v || '');
    if (id) {
      await openDetail(id);
      router.replace({ path: '/messages', query: {} });
    }
  },
);
</script>

<style scoped>
.html-preview-frame {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
  max-height: 360px;
  overflow: auto;
}
.html-preview-frame :deep(img) {
  max-width: 100%;
}
</style>
