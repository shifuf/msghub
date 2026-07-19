<template>
  <div class="portal">
    <header class="portal-nav">
      <div class="portal-nav-inner">
        <div class="brand">
          <div class="brand-mark">
            <AppIcon name="send" :size="20" color="#fff" />
          </div>
          <div>
            <div class="brand-title">{{ site.siteName || '消息推送平台' }}</div>
            <div class="brand-sub">Notify Hub</div>
          </div>
        </div>
        <div class="nav-actions">
          <a class="nav-link" href="#features">能力</a>
          <a class="nav-link" href="#api">API</a>
          <a v-if="partners.length" class="nav-link" href="#partners">合作站</a>
        </div>
      </div>
    </header>

    <section class="hero">
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-badge">
            <AppIcon name="flash" :size="14" color="#1d4ed8" />
            <span>多渠道 · 实时 · 开放 API</span>
          </div>
          <h1 class="hero-title">
            一个后台，
            <span class="grad">推遍所有渠道</span>
          </h1>
          <p class="hero-desc">
            统一管理钉钉 / Telegram / Server酱 / Webhook / 邮件 SMTP。
            支持异步队列、定时发送、失败备用告警、SSE 实时通知与开放 API。
          </p>
          <div class="hero-cta">
            <n-button type="primary" size="large" class="!rounded-xl" tag="a" href="#features">
              <template #icon>
                <AppIcon name="arrowForward" :size="18" />
              </template>
              了解功能
            </n-button>
            <n-button size="large" secondary class="!rounded-xl" tag="a" href="#api">
              查看 API
            </n-button>
          </div>
          <div class="hero-meta">
            <span><AppIcon name="flash" :size="13" /> SSE 实时</span>
            <span><AppIcon name="time" :size="13" /> 定时 / 延迟</span>
            <span><AppIcon name="shield" :size="13" /> 失败率告警</span>
            <span><AppIcon name="download" :size="13" /> 配置备份</span>
          </div>
        </div>

        <div class="hero-card">
          <div class="preview-top">
            <div class="dot r"></div>
            <div class="dot y"></div>
            <div class="dot g"></div>
            <span>控制台预览</span>
          </div>
          <div class="preview-body">
            <div class="preview-row" v-for="item in preview" :key="item.t">
              <div class="preview-icon" :class="item.cls">
                <AppIcon :name="item.icon" :size="18" color="#fff" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="preview-title">{{ item.t }}</div>
                <div class="preview-sub">{{ item.s }}</div>
              </div>
              <n-tag size="small" :type="item.tagType" round>
                <template #icon>
                  <AppIcon :name="item.tagIcon" :size="12" />
                </template>
                {{ item.tag }}
              </n-tag>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="features" class="section">
      <div class="section-inner">
        <h2 class="section-title">核心能力</h2>
        <p class="section-desc">为个人运维 / 多站点通知场景精简设计，开箱即用。</p>
        <div class="feature-grid">
          <div class="feature-card" v-for="f in features" :key="f.title">
            <div class="feature-icon">
              <AppIcon :name="f.icon" :size="22" color="#1d4ed8" />
            </div>
            <div class="feature-title">{{ f.title }}</div>
            <div class="feature-text">{{ f.text }}</div>
          </div>
        </div>
      </div>
    </section>

    <section id="api" class="section section-alt">
      <div class="section-inner api-grid">
        <div>
          <h2 class="section-title">开放 API</h2>
          <p class="section-desc">业务系统用项目 API Key 直接推送，无需进入后台。</p>
          <ul class="api-list">
            <li><code>POST /api/webhook</code> + <code>Authorization: Bearer</code></li>
            <li><code>POST /api/bark</code> + <code>Authorization: Bearer</code></li>
            <li><code>POST /api/gotify</code> + <code>Authorization: Bearer</code></li>
            <li><code>POST /api/email</code> + <code>Authorization: Bearer</code>（指定 to）</li>
          </ul>
        </div>
        <pre class="code-block">curl -X POST /api/webhook \
  -H "Authorization: Bearer msg_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "告警",
    "content": "CPU 过高"
  }'</pre>
      </div>
    </section>

    <section v-if="partners.length" id="partners" class="section">
      <div class="section-inner">
        <h2 class="section-title">合作站</h2>
        <p class="section-desc">友好站点与合作伙伴</p>
        <div class="partner-grid">
          <a
            v-for="p in partners"
            :key="p.id"
            class="partner-card"
            :href="p.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div class="partner-logo" v-if="p.logoUrl">
              <img :src="p.logoUrl" :alt="p.name" loading="lazy" />
            </div>
            <div class="partner-logo placeholder" v-else>
              {{ (p.name || '?').slice(0, 1) }}
            </div>
            <div class="partner-meta">
              <div class="partner-name">{{ p.name }}</div>
              <div class="partner-desc" v-if="p.description">{{ p.description }}</div>
            </div>
          </a>
        </div>
      </div>
    </section>

    <footer class="portal-footer">
      <div class="portal-footer-inner">
        <div class="footer-left">
          <span class="footer-brand">
            <AppIcon name="send" :size="16" color="#64748b" />
            {{ site.siteName || '消息推送平台' }} · Notify Hub
          </span>
          <span v-if="site.siteDescription" class="text-xs text-slate-400">{{ site.siteDescription }}</span>
        </div>
        <div class="footer-legal text-xs text-slate-400">
          <span v-if="site.siteCopyright">{{ site.siteCopyright }}</span>
          <span v-else>© {{ year }} {{ site.siteName || '消息推送平台' }}</span>
          <a
            v-if="site.siteIcp"
            class="legal-link"
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
          >{{ site.siteIcp }}</a>
          <a
            v-if="site.sitePolice"
            class="legal-link"
            :href="site.sitePoliceUrl || 'https://www.beian.gov.cn/'"
            target="_blank"
            rel="noopener noreferrer"
          >{{ site.sitePolice }}</a>
          <a
            v-if="site.siteContactEmail"
            class="legal-link"
            :href="`mailto:${site.siteContactEmail}`"
          >{{ site.siteContactEmail }}</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { NButton, NTag } from 'naive-ui';
import AppIcon from '@/components/AppIcon.vue';
import type { IconName } from '@/utils/icons';
import { publicSiteApi } from '@/api';

const year = new Date().getFullYear();
const site = reactive({
  siteName: '消息推送平台',
  siteIcp: '',
  sitePolice: '',
  sitePoliceUrl: '',
  siteCopyright: '',
  siteContactEmail: '',
  siteDescription: '',
});
const partners = ref<any[]>([]);

const preview: {
  icon: IconName;
  t: string;
  s: string;
  tag: string;
  tagType: 'success' | 'warning' | 'error';
  tagIcon: IconName;
  cls: string;
}[] = [
  { icon: 'chat', t: '生产告警钉钉', s: '项目 · 官网', tag: '成功', tagType: 'success', tagIcon: 'success', cls: 'c1' },
  { icon: 'send', t: '夜间巡检摘要', s: '定时任务', tag: '排队', tagType: 'warning', tagIcon: 'pending', cls: 'c2' },
  { icon: 'mail', t: '登录验证码', s: 'SMTP · login', tag: '成功', tagType: 'success', tagIcon: 'success', cls: 'c3' },
  { icon: 'link', t: 'Webhook 转发', s: '入站 token', tag: '失败', tagType: 'error', tagIcon: 'error', cls: 'c4' },
];

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: 'network', title: '全局渠道库', text: '钉钉 / TG / Server酱 / PushPlus / Webhook / SMTP 统一配置，项目一键启用。' },
  { icon: 'time', title: '定时与延迟', text: '指定时间发送或每日重复，适合巡检摘要与定时提醒。' },
  { icon: 'shield', title: '失败备用告警', text: '单条失败与失败率阈值双保险，自动推到备用渠道。' },
  { icon: 'flash', title: 'SSE 实时通知', text: '控制台铃铛实时弹窗，断线自动降级轮询。' },
  { icon: 'document', title: '邮件 + 推送模板', text: 'Handlebars 变量渲染，业务侧只传 code 与参数。' },
  { icon: 'download', title: '配置备份', text: '渠道 / 项目 / 模板一键导出导入，换机秒恢复。' },
];

onMounted(async () => {
  try {
    const [s, p] = await Promise.all([
      publicSiteApi.site().catch(() => null),
      publicSiteApi.partners().catch(() => []),
    ]);
    if (s) Object.assign(site, s);
    partners.value = Array.isArray(p) ? p : [];
  } catch {
    /* ignore */
  }
});
</script>

<style scoped>
.portal {
  min-height: 100vh;
  background: #f4f7fb;
  overflow-x: hidden;
}

.portal-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(12px);
  background: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.portal-nav-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: #2563eb;
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.25);
  flex-shrink: 0;
}

.brand-title {
  font-weight: 750;
  color: #0f172a;
  line-height: 1.1;
}

.brand-sub {
  font-size: 11px;
  color: #94a3b8;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.nav-link {
  font-size: 14px;
  color: #475569;
  padding: 6px 8px;
}

.hero {
  padding: 40px 16px 24px;
}

.hero-inner {
  max-width: 1120px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 28px;
  align-items: center;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 600;
}

.hero-title {
  margin: 14px 0 12px;
  font-size: clamp(28px, 5vw, 44px);
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: #0f172a;
  font-weight: 800;
}

.grad {
  color: #2563eb;
}

.hero-desc {
  color: #64748b;
  font-size: 15px;
  line-height: 1.7;
  max-width: 520px;
}

.hero-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}

.hero-meta span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #64748b;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 999px;
  padding: 5px 10px;
}

.hero-card {
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
  overflow: hidden;
  min-width: 0;
}

.preview-top {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
  color: #94a3b8;
  font-size: 12px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot.r { background: #f87171; }
.dot.y { background: #fbbf24; }
.dot.g { background: #34d399; }

.preview-body {
  padding: 10px;
}

.preview-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  min-width: 0;
}

.preview-row:hover {
  background: #f8fafc;
}

.preview-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.c1 { background: #2563eb; }
.c2 { background: #7c3aed; }
.c3 { background: #059669; }
.c4 { background: #dc2626; }

.preview-title {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-sub {
  font-size: 12px;
  color: #94a3b8;
}

.section {
  padding: 48px 16px;
}

.section-alt {
  background: rgba(255, 255, 255, 0.55);
  border-top: 1px solid rgba(15, 23, 42, 0.04);
  border-bottom: 1px solid rgba(15, 23, 42, 0.04);
}

.section-inner {
  max-width: 1120px;
  margin: 0 auto;
}

.section-title {
  font-size: clamp(22px, 3vw, 28px);
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.02em;
  margin: 0;
}

.section-desc {
  margin: 8px 0 24px;
  color: #64748b;
  font-size: 14px;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.feature-card {
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
  min-width: 0;
}

.feature-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: #eff6ff;
  margin-bottom: 12px;
}

.feature-title {
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 6px;
}

.feature-text {
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
}

.api-grid {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 20px;
  align-items: start;
}

.api-list {
  margin: 0;
  padding-left: 18px;
  color: #475569;
  line-height: 1.9;
}

.api-list code {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 6px;
  word-break: break-all;
}

.code-block {
  margin: 0;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 16px;
  padding: 18px;
  font-size: 12px;
  line-height: 1.65;
  overflow: auto;
  max-width: 100%;
  white-space: pre;
}

.portal-footer {
  padding: 28px 16px 40px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
  background: rgba(255, 255, 255, 0.4);
}

.portal-footer-inner {
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  color: #94a3b8;
  font-size: 13px;
}

.footer-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-weight: 600;
}

.footer-legal {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
  justify-content: flex-end;
  max-width: 100%;
}

.legal-link {
  color: #64748b;
  text-decoration: none;
}
.legal-link:hover {
  color: #2563eb;
}

.partner-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.partner-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 16px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.partner-card:hover {
  border-color: rgba(37, 99, 235, 0.25);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}

.partner-logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
  background: #f1f5f9;
  display: grid;
  place-items: center;
}
.partner-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.partner-logo.placeholder {
  font-weight: 700;
  color: #2563eb;
  background: #eff6ff;
}

.partner-meta {
  min-width: 0;
}
.partner-name {
  font-weight: 700;
  color: #0f172a;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.partner-desc {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .hero-inner,
  .api-grid {
    grid-template-columns: 1fr;
  }
  .feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .partner-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .hide-xs {
    display: none;
  }
}

@media (max-width: 560px) {
  .feature-grid,
  .partner-grid {
    grid-template-columns: 1fr;
  }
  .hero {
    padding-top: 24px;
  }
  .code-block {
    font-size: 11px;
    padding: 14px;
  }
  .footer-legal {
    justify-content: flex-start;
  }
}
</style>
