<template>
  <div class="space-y-5" v-if="tpl">
    <div class="page-header">
      <div class="flex items-center gap-3">
        <n-button quaternary @click="$router.push('/templates')">← 返回</n-button>
        <div>
          <div class="page-title">编辑模板 · {{ tpl.code }}</div>
          <div class="page-subtitle">
            {{ tpl.projectId ? `项目：${tpl.project?.name || tpl.projectId}` : '系统全局' }}
            · Handlebars 变量与 HTML 预览
          </div>
        </div>
      </div>
      <n-space>
        <n-button secondary @click="preview">预览</n-button>
        <n-button :loading="saving" @click="save">保存草稿</n-button>
        <n-button type="primary" :loading="saving" @click="publish">发布</n-button>
      </n-space>
    </div>

    <div class="grid xl:grid-cols-2 gap-4">
      <div class="page-card p-5 space-y-3">
        <n-form label-placement="top">
          <n-form-item label="名称">
            <n-input v-model:value="form.name" />
          </n-form-item>
          <n-form-item label="主题 (支持 Handlebars)">
            <n-input v-model:value="form.subject" />
          </n-form-item>
          <n-form-item label="变量列表">
            <div class="var-box">
              <div class="var-scroll" v-if="varList.length">
                <n-tag
                  v-for="(v, i) in varList"
                  :key="`${v}-${i}`"
                  closable
                  size="small"
                  type="info"
                  class="var-tag"
                  @close="removeVar(i)"
                >
                  {{ v }}
                </n-tag>
              </div>
              <div v-else class="text-xs text-slate-400">暂无变量，点击下方添加</div>
              <n-button size="small" secondary class="mt-2" @click="openAddVar">添加变量</n-button>
            </div>
          </n-form-item>
          <n-form-item label="HTML 正文">
            <n-input v-model:value="form.htmlBody" type="textarea" :rows="16" class="font-mono text-sm" />
          </n-form-item>
          <n-form-item label="纯文本 (可选)">
            <n-input v-model:value="form.textBody" type="textarea" :rows="4" />
          </n-form-item>
          <n-form-item label="启用">
            <n-switch v-model:value="form.enabled" />
          </n-form-item>
        </n-form>
      </div>

      <div class="page-card p-5 space-y-3">
        <div class="flex justify-between items-center">
          <h3 class="font-medium">预览</h3>
          <n-button size="small" secondary @click="preview">刷新预览</n-button>
        </div>
        <n-form-item label="预览变量 JSON">
          <n-input v-model:value="previewVars" type="textarea" :rows="6" class="font-mono text-xs" />
        </n-form-item>
        <div class="text-sm text-gray-500">主题：{{ previewResult.subject || '-' }}</div>
        <div class="flex gap-2 items-center">
          <n-select v-model:value="rollbackRevision" :options="versions.map(v => ({ label: `版本 ${v.revision} · ${new Date(v.createdAt).toLocaleString()}`, value: v.revision }))" placeholder="选择历史版本" />
          <n-button :disabled="!rollbackRevision" @click="rollback">回滚并发布</n-button>
        </div>
        <div class="border rounded-lg overflow-hidden bg-gray-50 min-h-[320px]">
          <SafeHtmlPreview
            v-if="previewResult.html"
            class="w-full h-[420px] bg-white"
            :html="previewResult.html"
          />
          <div v-else class="p-6 text-gray-400 text-sm">点击「预览」查看渲染结果</div>
        </div>
      </div>
    </div>

    <n-modal
      v-model:show="showAddVar"
      preset="card"
      title="添加变量"
      style="width: min(400px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <n-form label-placement="top">
        <n-form-item label="变量名" required>
          <n-input
            v-model:value="newVarName"
            placeholder="如 appName / code / expireMinutes"
            @keyup.enter="confirmAddVar"
          />
        </n-form-item>
        <p class="text-xs text-slate-400 -mt-2 mb-2">仅字母数字下划线，模板中写 &#123;&#123;变量名&#125;&#125;</p>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAddVar = false">取消</n-button>
          <n-button type="primary" @click="confirmAddVar">添加</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import SafeHtmlPreview from '@/components/SafeHtmlPreview.vue';
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSpace,
  NSwitch,
  NTag,
  NSelect,
  useMessage,
} from 'naive-ui';
import { templatesApi } from '@/api';

const route = useRoute();
const id = String(route.params.id);
const tpl = ref<any>(null);
const saving = ref(false);
const versions = ref<any[]>([]);
const rollbackRevision = ref<number | null>(null);
const message = useMessage();
const form = reactive({
  name: '',
  subject: '',
  htmlBody: '',
  textBody: '',
  enabled: true,
});
const varList = ref<string[]>([]);
const showAddVar = ref(false);
const newVarName = ref('');
const previewVars = ref(
  JSON.stringify(
    {
      appName: '示例应用',
      username: '张三',
      code: '123456',
      expireMinutes: 10,
      title: '系统通知',
      body: '<p>这是正文内容</p>',
      verifyUrl: 'https://example.com/verify',
      resetUrl: 'https://example.com/reset',
      actionUrl: 'https://example.com',
      ip: '1.2.3.4',
      time: new Date().toLocaleString('zh-CN'),
    },
    null,
    2,
  ),
);
const previewResult = reactive({ subject: '', html: '' });

async function load() {
  const published: any = await templatesApi.get(id);
  tpl.value = published;
  const data = { ...published, ...(published.draft || {}) };
  versions.value = (await templatesApi.versions(id)) || [];
  form.name = data.name;
  form.subject = data.subject;
  form.htmlBody = data.htmlBody;
  form.textBody = data.textBody || '';
  form.enabled = data.enabled;
  varList.value = Array.isArray(data.variables) ? [...data.variables] : [];
}

function openAddVar() {
  newVarName.value = '';
  showAddVar.value = true;
}

function confirmAddVar() {
  const name = newVarName.value.trim().replace(/^\{\{|\}\}$/g, '');
  if (!name) {
    message.warning('请填写变量名');
    return;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    message.warning('变量名仅支持字母、数字、下划线，且不能以数字开头');
    return;
  }
  if (varList.value.includes(name)) {
    message.warning('变量已存在');
    return;
  }
  varList.value.push(name);
  showAddVar.value = false;
}

function removeVar(index: number) {
  varList.value.splice(index, 1);
}

async function save() {
  saving.value = true;
  try {
    await templatesApi.draft(id, {
      name: form.name,
      subject: form.subject,
      htmlBody: form.htmlBody,
      textBody: form.textBody || undefined,
      enabled: form.enabled,
      variables: [...varList.value],
    });
    message.success('草稿已保存');
    await load();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function publish() {
  saving.value = true;
  try {
    await templatesApi.draft(id, { ...form, variables: [...varList.value] });
    await templatesApi.publish(id); await load(); message.success('已发布');
  } catch (e: any) { message.error(e.message); }
  finally { saving.value = false; }
}
async function rollback() {
  if (!rollbackRevision.value) return;
  try { await templatesApi.rollback(id, rollbackRevision.value); await load(); message.success('已回滚为新版本'); }
  catch (e: any) { message.error(e.message); }
}

async function preview() {
  try {
    let variables = {};
    try {
      variables = JSON.parse(previewVars.value || '{}');
    } catch {
      message.error('预览变量 JSON 无效');
      return;
    }
    await templatesApi.draft(id, {
      name: form.name,
      subject: form.subject,
      htmlBody: form.htmlBody,
      textBody: form.textBody || undefined,
      enabled: form.enabled,
      variables: [...varList.value],
    });
    const res: any = await templatesApi.preview(id, variables);
    previewResult.subject = res.subject;
    previewResult.html = res.html;
  } catch (e: any) {
    message.error(e.message);
  }
}

onMounted(load);
</script>

<style scoped>
.var-box {
  width: 100%;
  border: 1px solid var(--app-border, #e2e8f0);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fafbfc;
}
.var-scroll {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 140px;
  overflow-y: auto;
}
.var-tag {
  margin: 0;
}
</style>
