<template>
  <AppLayout>
    <div class="space-y-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ t('admin.modelPricingDisplay.title', 'Model Pricing Display') }}
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ t('admin.modelPricingDisplay.description', 'Configure the model categories and model list shown on public and console pricing pages.') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary" :disabled="loading" @click="loadConfig">
            <Icon name="refresh" size="sm" :class="loading ? 'animate-spin' : ''" />
            {{ t('common.refresh', 'Refresh') }}
          </button>
          <button class="btn btn-primary" :disabled="saving" @click="saveConfig">
            <Icon name="check" size="sm" />
            {{ saving ? t('common.saving', 'Saving...') : t('common.save', 'Save') }}
          </button>
        </div>
      </div>

      <div class="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">
        {{ t('admin.modelPricingDisplay.help', 'This page only controls display categories and model whitelist. Official prices still come from channel pricing first, then the built-in model price catalog.') }}
      </div>

      <div v-if="loading" class="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 dark:border-dark-700 dark:bg-dark-800 dark:text-gray-400">
        {{ t('common.loading', 'Loading...') }}
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="(category, categoryIndex) in form.categories"
          :key="category.localKey"
          class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-dark-700 dark:bg-dark-800"
        >
          <div class="mb-4 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-sm font-semibold text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
                {{ categoryIndex + 1 }}
              </span>
              <h2 class="font-semibold text-gray-900 dark:text-white">
                {{ category.label || t('admin.modelPricingDisplay.unnamedCategory', 'Unnamed category') }}
              </h2>
            </div>
            <button class="btn btn-danger btn-sm" @click="removeCategory(categoryIndex)">
              <Icon name="trash" size="sm" />
              {{ t('common.delete', 'Delete') }}
            </button>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label class="input-label">{{ t('admin.modelPricingDisplay.categoryId', 'Category ID') }}</label>
              <input v-model.trim="category.id" class="input" placeholder="claude" />
            </div>
            <div>
              <label class="input-label">{{ t('admin.modelPricingDisplay.categoryLabel', 'Category Label') }}</label>
              <input v-model.trim="category.label" class="input" placeholder="Claude" />
            </div>
            <div class="md:col-span-2">
              <label class="input-label">{{ t('admin.modelPricingDisplay.categoryDescription', 'Description') }}</label>
              <input v-model.trim="category.description" class="input" placeholder="Claude Code compatible models" />
            </div>
            <div class="md:col-span-2">
              <label class="input-label">{{ t('admin.modelPricingDisplay.modelScopes', 'Supported Model Scopes') }}</label>
              <input
                :value="category.model_scopes.join(', ')"
                class="input"
                placeholder="claude, openai, gemini_text, gemini_image"
                @input="category.model_scopes = splitComma(($event.target as HTMLInputElement).value)"
              />
              <p class="mt-1 text-xs text-gray-400">
                {{ t('admin.modelPricingDisplay.modelScopesHint', 'Used by console pricing to decide whether a selected group supports this category.') }}
              </p>
            </div>
          </div>

          <div class="mt-5">
            <div class="mb-2 flex items-center justify-between">
              <label class="input-label mb-0">{{ t('admin.modelPricingDisplay.models', 'Models') }}</label>
              <button class="btn btn-secondary btn-sm" @click="addModel(categoryIndex)">
                <Icon name="plus" size="sm" />
                {{ t('admin.modelPricingDisplay.addModel', 'Add Model') }}
              </button>
            </div>
            <div class="space-y-2">
              <div
                v-for="(model, modelIndex) in category.models"
                :key="model.localKey"
                class="grid gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-dark-700 dark:bg-dark-900 md:grid-cols-[1fr_1fr_auto]"
              >
                <input v-model.trim="model.model" class="input" placeholder="claude-sonnet-4" />
                <input v-model.trim="model.label" class="input" :placeholder="t('admin.modelPricingDisplay.modelLabelPlaceholder', 'Display label, optional')" />
                <button class="btn btn-secondary" @click="removeModel(categoryIndex, modelIndex)">
                  <Icon name="x" size="sm" />
                </button>
              </div>
              <div v-if="category.models.length === 0" class="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400 dark:border-dark-700">
                {{ t('admin.modelPricingDisplay.noModels', 'No models configured.') }}
              </div>
            </div>
          </div>
        </div>

        <button class="btn btn-secondary w-full justify-center border-dashed py-5" @click="addCategory">
          <Icon name="plus" size="md" />
          {{ t('admin.modelPricingDisplay.addCategory', 'Add Category') }}
        </button>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import channelsAPI, { type ModelPricingDisplayConfig } from '@/api/admin/channels'
import { useAppStore } from '@/stores/app'

interface EditableModel {
  localKey: string
  model: string
  label: string
}

interface EditableCategory {
  localKey: string
  id: string
  label: string
  description: string
  model_scopes: string[]
  models: EditableModel[]
}

const { t } = useI18n()
const appStore = useAppStore()
const loading = ref(false)
const saving = ref(false)
const form = reactive<{ categories: EditableCategory[] }>({ categories: [] })

function newKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function splitComma(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function toEditable(config: ModelPricingDisplayConfig) {
  form.categories = (config.categories || []).map((category) => ({
    localKey: newKey('category'),
    id: category.id || '',
    label: category.label || '',
    description: category.description || '',
    model_scopes: category.model_scopes || [],
    models: (category.models || []).map((model) => ({
      localKey: newKey('model'),
      model: model.model || '',
      label: model.label || ''
    }))
  }))
}

function toPayload(): ModelPricingDisplayConfig {
  return {
    categories: form.categories.map((category) => ({
      id: category.id.trim(),
      label: category.label.trim(),
      description: category.description.trim(),
      model_scopes: category.model_scopes.map((scope) => scope.trim()).filter(Boolean),
      models: category.models
        .map((model) => ({ model: model.model.trim(), label: model.label.trim() }))
        .filter((model) => model.model)
    })).filter((category) => category.id || category.label || category.models.length > 0)
  }
}

function addCategory() {
  form.categories.push({
    localKey: newKey('category'),
    id: '',
    label: '',
    description: '',
    model_scopes: [],
    models: []
  })
}

function removeCategory(index: number) {
  form.categories.splice(index, 1)
}

function addModel(categoryIndex: number) {
  form.categories[categoryIndex]?.models.push({
    localKey: newKey('model'),
    model: '',
    label: ''
  })
}

function removeModel(categoryIndex: number, modelIndex: number) {
  form.categories[categoryIndex]?.models.splice(modelIndex, 1)
}

async function loadConfig() {
  loading.value = true
  try {
    const config = await channelsAPI.getModelPricingDisplayConfig()
    toEditable(config)
  } catch (error) {
    console.error('Failed to load model pricing display config:', error)
    appStore.showError(t('admin.modelPricingDisplay.loadFailed', 'Failed to load model pricing display config.'))
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  try {
    const config = await channelsAPI.updateModelPricingDisplayConfig(toPayload())
    toEditable(config)
    appStore.showSuccess(t('admin.modelPricingDisplay.saveSuccess', 'Model pricing display config saved.'))
  } catch (error) {
    console.error('Failed to save model pricing display config:', error)
    appStore.showError(t('admin.modelPricingDisplay.saveFailed', 'Failed to save model pricing display config.'))
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>
