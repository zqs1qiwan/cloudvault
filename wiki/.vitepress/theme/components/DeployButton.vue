<script setup lang="ts">
const href = 'https://deploy.workers.cloudflare.com/?url=https://github.com/zqs1qiwan/cloudvault'
</script>

<template>
  <a class="cv-deploy" :href="href" target="_blank" rel="noopener">
    <span class="cv-deploy__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
      </svg>
    </span>
    <span class="cv-deploy__copy">
      <strong>Deploy to Cloudflare</strong>
      <small>一键部署 · 自动创建 R2 与 KV</small>
    </span>
    <span class="cv-deploy__arrow" aria-hidden="true">→</span>
  </a>
</template>

<style scoped>
.cv-deploy {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  margin: 8px 0 18px;
  padding: 10px 14px 10px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  text-decoration: none !important;
  transition: border-color 160ms ease, background 160ms ease;
}

.cv-deploy:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
}

.cv-deploy__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--cv-orange);
  color: #fff;
}

.cv-deploy__icon svg {
  width: 20px;
  height: 20px;
}

.cv-deploy__copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}

.cv-deploy__copy strong {
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 1.3;
  letter-spacing: -0.1px;
}

.cv-deploy__copy small {
  margin-top: 2px;
  color: var(--vp-c-text-2);
  font-size: 11.5px;
  line-height: 1.4;
}

.cv-deploy__arrow {
  flex: none;
  margin-left: 4px;
  color: var(--vp-c-brand-1);
  font-size: 16px;
  transition: transform 160ms ease;
}

.cv-deploy:hover .cv-deploy__arrow {
  transform: translateX(2px);
}

@media (max-width: 480px) {
  .cv-deploy {
    display: flex;
    width: 100%;
  }

  .cv-deploy__arrow {
    margin-left: auto;
  }
}
</style>
