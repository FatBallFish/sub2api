<template>
  <BaseDialog
    :show="show"
    :title="t('admin.affiliates.bindRelation.title')"
    width="normal"
    @close="handleClose"
  >
    <form class="space-y-4" @submit.prevent="submit" data-testid="affiliate-bind-relation-dialog">
      <UserPickerField
        :label="t('admin.affiliates.bindRelation.inviter')"
        :placeholder="t('admin.affiliates.bindRelation.inviterPlaceholder')"
        :selected="inviter"
        :disabled="submitting"
        @select="selectInviter"
        @clear="clearInviter"
      />
      <div v-if="inviterAffCode" class="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-dark-700 dark:bg-dark-800">
        <div class="flex items-center justify-between text-sm">
          <span class="text-gray-500 dark:text-dark-400">{{ t('admin.affiliates.records.affCode') }}</span>
          <span class="font-mono font-semibold text-gray-900 dark:text-white" data-testid="bind-relation-aff-code">{{ inviterAffCode }}</span>
        </div>
      </div>

      <UserPickerField
        :label="t('admin.affiliates.bindRelation.invitee')"
        :placeholder="t('admin.affiliates.bindRelation.inviteePlaceholder')"
        :selected="invitee"
        :disabled="submitting"
        @select="selectInvitee"
        @clear="clearInvitee"
      />
      <div
        v-if="inviteeBinding"
        class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700/50 dark:bg-amber-900/20"
        data-testid="bind-relation-current-binding"
      >
        <div class="text-sm font-medium text-amber-800 dark:text-amber-300">
          {{ t('admin.affiliates.bindRelation.currentBinding') }}
        </div>
        <div class="mt-1 text-sm text-amber-700 dark:text-amber-400">
          #{{ inviteeBinding.inviter_id }} {{ inviteeBinding.inviter_email }}
          <span v-if="inviteeBinding.inviter_name">({{ inviteeBinding.inviter_name }})</span>
          · {{ t('admin.affiliates.records.invitedAt') }}: {{ formatDateTime(inviteeBinding.invited_at) }}
        </div>
        <label class="mt-2 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
          <input
            v-model="forceChange"
            type="checkbox"
            class="mt-0.5 h-4 w-4 cursor-pointer rounded border-amber-300 text-red-600 focus:ring-red-500"
            data-testid="bind-relation-force"
          />
          <span>{{ t('admin.affiliates.bindRelation.forceChangeHint') }}</span>
        </label>
      </div>

      <div>
        <label class="input-label" for="bind-relation-invited-at">{{ t('admin.affiliates.bindRelation.invitedAt') }}</label>
        <input
          id="bind-relation-invited-at"
          v-model="invitedAtLocal"
          type="datetime-local"
          class="input"
          :disabled="submitting"
          data-testid="bind-relation-invited-at"
        />
        <p class="input-hint">{{ t('admin.affiliates.bindRelation.invitedAtHint') }}</p>
      </div>

      <p v-if="formError" class="text-sm text-red-600 dark:text-red-400" data-testid="bind-relation-error">{{ formError }}</p>

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn btn-secondary" :disabled="submitting" @click="handleClose">
          {{ t('common.cancel') }}
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="!canSubmit || submitting"
          data-testid="bind-relation-submit"
        >
          {{ inviteeBinding ? t('admin.affiliates.bindRelation.changeAction') : t('admin.affiliates.bindRelation.bindAction') }}
        </button>
      </div>
    </form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { useAppStore } from '@/stores/app'
import {
  affiliatesAPI,
  getInviteeBinding,
  setInviteBinding,
  type AffiliateInviteBinding,
  type SimpleUser,
} from '@/api/admin/affiliates'
import { extractApiErrorCode, extractI18nErrorMessage } from '@/utils/apiError'
import { formatDateTime as formatDisplayDateTime } from '@/utils/format'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: []; success: [] }>()

const { t } = useI18n()
const appStore = useAppStore()

const inviter = ref<SimpleUser | null>(null)
const invitee = ref<SimpleUser | null>(null)
const inviterAffCode = ref('')
const inviteeBinding = ref<AffiliateInviteBinding | null>(null)
const forceChange = ref(false)
const invitedAtLocal = ref('')
const formError = ref('')
const submitting = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null

const canSubmit = computed(() => {
  if (!inviter.value || !invitee.value) return false
  if (inviter.value.id === invitee.value.id) return false
  // 已有邀请人时必须显式勾选“强制变更邀请人”才允许提交
  if (inviteeBinding.value && !forceChange.value) return false
  return true
})

function resetForm() {
  inviter.value = null
  invitee.value = null
  inviterAffCode.value = ''
  inviteeBinding.value = null
  forceChange.value = false
  formError.value = ''
  const now = new Date()
  now.setSeconds(0, 0)
  invitedAtLocal.value = toLocalInputValue(now)
}

watch(
  () => props.show,
  (visible) => {
    if (visible) resetForm()
  },
)

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function selectInviter(user: SimpleUser) {
  inviter.value = user
  inviterAffCode.value = ''
  try {
    const overview = await affiliatesAPI.getUserOverview(user.id)
    inviterAffCode.value = overview.aff_code || ''
  } catch (error) {
    // 从未参与过邀请的用户没有档案，视为无邀请码展示
    if (extractApiErrorCode(error) !== 'USER_NOT_FOUND') {
      appStore.showError(extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('common.error')))
    }
  }
}

function clearInviter() {
  inviter.value = null
  inviterAffCode.value = ''
}

async function selectInvitee(user: SimpleUser) {
  invitee.value = user
  inviteeBinding.value = null
  forceChange.value = false
  formError.value = ''
  try {
    inviteeBinding.value = await getInviteeBinding(user.id)
  } catch (error) {
    appStore.showError(extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('common.error')))
  }
}

function clearInvitee() {
  invitee.value = null
  inviteeBinding.value = null
  forceChange.value = false
}

function buildInvitedAtISO(): string | undefined {
  if (!invitedAtLocal.value) return undefined
  const parsed = new Date(invitedAtLocal.value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

async function submit() {
  if (!canSubmit.value || submitting.value) return
  if (inviter.value && invitee.value && inviter.value.id === invitee.value.id) {
    formError.value = t('admin.affiliates.bindRelation.selfInviteError')
    return
  }
  submitting.value = true
  formError.value = ''
  try {
    await setInviteBinding({
      inviter_id: inviter.value!.id,
      invitee_id: invitee.value!.id,
      invited_at: buildInvitedAtISO(),
      force: inviteeBinding.value != null ? forceChange.value : false,
    })
    appStore.showSuccess(t('admin.affiliates.bindRelation.success'))
    emit('success')
  } catch (error) {
    formError.value = extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('admin.affiliates.bindRelation.failed'))
  } finally {
    submitting.value = false
  }
}

function handleClose() {
  if (submitting.value) return
  emit('close')
}

function formatDateTime(value: string | null | undefined): string {
  return value ? formatDisplayDateTime(value) : '-'
}

/** 用户搜索选择控件：搜索框 + 结果下拉 + 已选 chip（复用 lookupUsers 防抖搜索）。 */
const UserPickerField = defineComponent({
  props: {
    label: { type: String, required: true },
    placeholder: { type: String, required: true },
    selected: { type: Object as PropType<SimpleUser | null>, default: null },
    disabled: { type: Boolean, default: false },
  },
  emits: ['select', 'clear'],
  setup(fieldProps, { emit: fieldEmit }) {
    const query = ref('')
    const results = ref<SimpleUser[]>([])
    const searched = ref(false)
    let seq = 0

    const debouncedSearch = () => {
      if (searchTimer) clearTimeout(searchTimer)
      searched.value = false
      const trimmed = query.value.trim()
      if (!trimmed) {
        seq++
        results.value = []
        return
      }
      searchTimer = setTimeout(async () => {
        const current = ++seq
        try {
          const users = await affiliatesAPI.lookupUsers(trimmed)
          if (current !== seq) return
          results.value = users || []
          searched.value = true
        } catch {
          if (current !== seq) return
          results.value = []
        }
      }, 300)
    }

    return () => h('div', {}, [
      h('label', { class: 'input-label' }, fieldProps.label),
      fieldProps.selected
        ? h('div', {
            class: 'flex items-center justify-between gap-3 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 dark:border-primary-700/50 dark:bg-primary-900/20',
          }, [
            h('div', { class: 'min-w-0 truncate text-sm' }, [
              h('span', { class: 'font-mono text-gray-500 dark:text-dark-400' }, `#${fieldProps.selected.id}`),
              h('span', { class: 'ml-2 font-medium text-gray-900 dark:text-white' }, fieldProps.selected.email || '-'),
              fieldProps.selected.username
                ? h('span', { class: 'ml-1 text-xs text-gray-500 dark:text-dark-400' }, `(${fieldProps.selected.username})`)
                : null,
            ]),
            h('button', {
              type: 'button',
              class: 'text-lg leading-none text-gray-400 hover:text-red-600 disabled:opacity-50',
              disabled: fieldProps.disabled,
              onClick: () => fieldEmit('clear'),
            }, '×'),
          ])
        : h('div', {}, [
            h('input', {
              type: 'text',
              class: 'input',
              placeholder: fieldProps.placeholder,
              disabled: fieldProps.disabled,
              value: query.value,
              onInput: (event: Event) => {
                query.value = (event.target as HTMLInputElement).value
                debouncedSearch()
              },
            }),
            results.value.length > 0
              ? h('div', { class: 'mt-1 max-h-40 overflow-y-auto rounded border border-gray-200 dark:border-dark-700' },
                  results.value.map((user) => h('button', {
                    key: user.id,
                    type: 'button',
                    class: 'w-full px-3 py-1.5 text-left text-sm text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-dark-800',
                    onClick: () => {
                      query.value = ''
                      results.value = []
                      fieldEmit('select', user)
                    },
                  }, [
                    `${user.email} `,
                    h('span', { class: 'text-xs text-gray-500 dark:text-dark-400' }, `(${user.username})`),
                  ])))
              : searched.value
                ? h('p', { class: 'input-hint' }, t('admin.affiliates.bindRelation.noUserFound'))
                : null,
          ]),
    ])
  },
})
</script>
