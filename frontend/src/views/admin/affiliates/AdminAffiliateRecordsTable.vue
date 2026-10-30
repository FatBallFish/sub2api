<template>
  <AppLayout>
    <TablePageLayout>
      <template #filters>
        <div class="flex flex-wrap items-center gap-3">
          <div class="relative w-full md:w-80">
            <Icon name="search" size="md" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input v-model="filters.search" type="text" class="input pl-10" :placeholder="t('admin.affiliates.records.searchPlaceholder')" @input="debounceLoad" />
          </div>
          <input v-model="filters.start_at" type="date" class="input w-full sm:w-44" :title="t('admin.affiliates.records.startAt')" @change="reloadFromFirstPage" />
          <input v-model="filters.end_at" type="date" class="input w-full sm:w-44" :title="t('admin.affiliates.records.endAt')" @change="reloadFromFirstPage" />
          <button class="btn btn-secondary px-2 md:px-3" :disabled="loading" :title="t('common.refresh')" @click="loadRecords">
            <Icon name="refresh" size="md" :class="loading ? 'animate-spin' : ''" />
          </button>
          <button
            v-if="props.type === 'transfers'"
            type="button"
            class="btn btn-primary ml-auto"
            data-test="affiliate-withdraw-open"
            @click="withdrawDialog = true"
          >
            {{ t('admin.affiliates.withdraw.button') }}
          </button>
          <template v-if="props.type === 'invites'">
            <button
              type="button"
              class="btn btn-secondary ml-auto"
              data-test="affiliate-bind-relation-open"
              @click="bindDialog = true"
            >
              {{ t('admin.affiliates.bindRelation.button') }}
            </button>
            <button
              type="button"
              class="btn btn-danger"
              :disabled="selectedActiveCount === 0 || loading"
              data-test="affiliate-unbind-open"
              @click="unbindDialog = true"
            >
              {{ t('admin.affiliates.unbind.button', { count: selectedActiveCount }) }}
            </button>
          </template>
        </div>
      </template>

      <template #table>
        <DataTable
          :columns="columns"
          :data="records"
          :loading="loading"
          :server-side-sort="true"
          default-sort-key="created_at"
          default-sort-order="desc"
          :sort-storage-key="sortStorageKey"
          @sort="handleSort"
        >
          <template #header-select>
            <input
              v-if="props.type === 'invites'"
              type="checkbox"
              class="h-4 w-4 cursor-pointer rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              :checked="allActiveSelected"
              @click.stop
              @change="toggleSelectAllActive($event)"
            />
          </template>
          <template #cell-select="{ row }">
            <input
              v-if="props.type === 'invites'"
              type="checkbox"
              class="h-4 w-4 cursor-pointer rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              :disabled="row.unbound_at != null"
              :checked="selectedInviteeIds.has(row.invitee_id)"
              @click.stop
              @change="toggleSelectRow(row, $event)"
            />
          </template>
          <template #cell-inviter="{ row }">
            <UserCell
              :id="row.inviter_id"
              :email="row.inviter_email"
              :username="row.inviter_username"
              :clickable="props.type !== 'transfers'"
              @open="openUserOverview"
            />
          </template>
          <template #cell-invitee="{ row }">
            <span v-if="row.invitee_id == null" class="text-sm text-gray-400 dark:text-dark-500">-</span>
            <UserCell
              v-else
              :id="row.invitee_id"
              :email="row.invitee_email"
              :username="row.invitee_username"
              :clickable="props.type !== 'transfers'"
              @open="openUserOverview"
            />
          </template>
          <template #cell-user="{ row }">
            <UserCell
              :id="row.user_id"
              :email="row.user_email"
              :username="row.username"
              :clickable="true"
              @open="openUserOverview"
            />
          </template>
          <template #cell-aff_code="{ row }">
            <span class="font-mono text-sm text-gray-700 dark:text-gray-300">{{ row.aff_code || '-' }}</span>
          </template>
          <template #cell-order="{ row }">
            <span v-if="row.order_id == null" class="text-sm text-gray-400 dark:text-dark-500">-</span>
            <div v-else class="space-y-0.5">
              <div class="font-mono text-sm text-gray-900 dark:text-white">#{{ row.order_id }}</div>
              <div class="max-w-56 truncate text-sm text-gray-500 dark:text-dark-400">{{ row.out_trade_no }}</div>
            </div>
          </template>
          <template #cell-payment_type="{ row }">
            <template v-if="row.payment_type">{{ t('payment.methods.' + row.payment_type, row.payment_type) }}</template>
            <span v-else class="text-sm text-gray-400 dark:text-dark-500">-</span>
          </template>
          <template #cell-order_status="{ row }">
            <OrderStatusBadge v-if="row.order_status" :status="row.order_status" />
            <span v-else class="text-sm text-gray-400 dark:text-dark-500">-</span>
          </template>
          <template #cell-chain="{ row }">
            <button
              v-if="props.type === 'invites'"
              type="button"
              class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
              :title="t('admin.affiliates.inviteTree.viewAction')"
              data-test="affiliate-invite-tree-open"
              @click="openInviteTree(row)"
            >
              <Icon name="grid" size="sm" />
              {{ t('admin.affiliates.inviteTree.viewAction') }}
            </button>
          </template>
          <template #cell-status="{ row }">
            <span :class="['badge whitespace-nowrap', row.unbound_at ? 'badge-gray' : 'badge-success']">
              {{ row.unbound_at ? t('admin.affiliates.records.statusUnbound') : t('admin.affiliates.records.statusActive') }}
            </span>
          </template>
          <template #cell-total_rebate="{ row }">
            <AmountText :value="row.total_rebate" />
          </template>
          <template #cell-order_amount="{ row }">
            <NullableAmountText :value="row.order_amount" />
          </template>
          <template #cell-pay_amount="{ row }">
            <span v-if="row.pay_amount == null" class="text-sm text-gray-400 dark:text-dark-500">-</span>
            <span v-else class="text-sm text-gray-900 dark:text-white">¥{{ formatAmount(row.pay_amount) }}</span>
          </template>
          <template #cell-rebate_amount="{ row }">
            <AmountText :value="row.rebate_amount" strong />
          </template>
          <template #cell-action="{ row }">
            <span :class="['badge whitespace-nowrap', row.action === 'withdraw' ? 'badge-warning' : 'badge-primary']">
              {{ outflowTypeLabel(row.action) }}
            </span>
          </template>
          <template #cell-amount="{ row }">
            <AmountText :value="row.amount" strong />
          </template>
          <template #cell-balance_after="{ row }">
            <NullableAmountText :value="row.balance_after" />
          </template>
          <template #cell-available_quota_after="{ row }">
            <NullableAmountText :value="row.available_quota_after" />
          </template>
          <template #cell-frozen_quota_after="{ row }">
            <NullableAmountText :value="row.frozen_quota_after" />
          </template>
          <template #cell-history_quota_after="{ row }">
            <NullableAmountText :value="row.history_quota_after" />
          </template>
          <template #cell-created_at="{ row }">
            <span class="text-sm text-gray-700 dark:text-gray-300">{{ formatDateTime(row.created_at) }}</span>
          </template>
        </DataTable>
      </template>

      <template #pagination>
        <Pagination
          v-if="pagination.total > 0"
          :page="pagination.page"
          :total="pagination.total"
          :page-size="pagination.page_size"
          @update:page="handlePageChange"
          @update:pageSize="handlePageSizeChange"
        />
      </template>
    </TablePageLayout>

    <AffiliateOfflineWithdrawDialog
      v-if="props.type === 'transfers'"
      :show="withdrawDialog"
      @close="withdrawDialog = false"
      @success="handleWithdrawSuccess"
    />

    <AffiliateBindRelationDialog
      v-if="props.type === 'invites'"
      :show="bindDialog"
      @close="bindDialog = false"
      @success="handleRelationChanged"
    />

    <AffiliateInviteTreeDialog
      v-if="props.type === 'invites'"
      :show="inviteTreeDialog"
      :focus-user-id="inviteTreeFocusId"
      @close="inviteTreeDialog = false"
    />

    <ConfirmDialog
      :show="unbindDialog"
      :title="t('admin.affiliates.unbind.title')"
      :message="t('admin.affiliates.unbind.confirm', { count: selectedActiveCount })"
      :confirm-text="t('admin.affiliates.unbind.confirmAction')"
      :cancel-text="t('common.cancel')"
      :danger="true"
      @confirm="confirmUnbind"
      @cancel="unbindDialog = false"
    />

    <BaseDialog
      :show="overviewDialog"
      :title="t('admin.affiliates.overview.title')"
      width="normal"
      @close="overviewDialog = false"
    >
      <div v-if="overviewLoading" class="flex justify-center py-8">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
      </div>
      <div v-else-if="selectedOverview" class="space-y-4">
        <div class="rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-dark-700 dark:bg-dark-800">
          <div class="font-mono text-sm text-gray-900 dark:text-white">#{{ selectedOverview.user_id }}</div>
          <div class="mt-1 text-sm font-medium text-gray-900 dark:text-white">{{ selectedOverview.email || '-' }}</div>
          <div class="mt-0.5 text-sm text-gray-500 dark:text-dark-400">{{ selectedOverview.username || '-' }}</div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <OverviewStat :label="t('admin.affiliates.overview.affCode')" :value="selectedOverview.aff_code || '-'" mono />
          <OverviewStat :label="t('admin.affiliates.overview.rebateRate')" :value="formatPercent(selectedOverview.rebate_rate_percent)" />
          <OverviewStat :label="t('admin.affiliates.overview.invitedCount')" :value="String(selectedOverview.invited_count)" />
          <OverviewStat :label="t('admin.affiliates.overview.rebatedInviteeCount')" :value="String(selectedOverview.rebated_invitee_count)" />
          <OverviewStat :label="t('admin.affiliates.overview.availableQuota')" :value="'$' + formatAmount(selectedOverview.available_quota)" />
          <OverviewStat :label="t('admin.affiliates.overview.historyQuota')" :value="'$' + formatAmount(selectedOverview.history_quota)" />
        </div>
      </div>
    </BaseDialog>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import TablePageLayout from '@/components/layout/TablePageLayout.vue'
import DataTable from '@/components/common/DataTable.vue'
import Pagination from '@/components/common/Pagination.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import OrderStatusBadge from '@/components/payment/OrderStatusBadge.vue'
import AffiliateOfflineWithdrawDialog from './AffiliateOfflineWithdrawDialog.vue'
import AffiliateBindRelationDialog from './AffiliateBindRelationDialog.vue'
import AffiliateInviteTreeDialog from './AffiliateInviteTreeDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import type { Column } from '@/components/common/types'
import { useAppStore } from '@/stores/app'
import { affiliatesAPI, type AffiliateInviteRecord, type AffiliateRebateRecord, type AffiliateTransferRecord, type AffiliateUserOverview, type ListAffiliateRecordsParams } from '@/api/admin/affiliates'
import type { PaginatedResponse } from '@/types'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { formatDateTime as formatDisplayDateTime } from '@/utils/format'

type RecordType = 'invites' | 'rebates' | 'transfers'
type AffiliateRecord = AffiliateInviteRecord | AffiliateRebateRecord | AffiliateTransferRecord

const props = defineProps<{
  type: RecordType
}>()

const { t } = useI18n()
const appStore = useAppStore()
const loading = ref(false)
const records = ref<AffiliateRecord[]>([])
const filters = reactive({ search: '', start_at: '', end_at: '' })
const pagination = reactive({ page: 1, page_size: 20, total: 0 })
const overviewDialog = ref(false)
const overviewLoading = ref(false)
const selectedOverview = ref<AffiliateUserOverview | null>(null)
const withdrawDialog = ref(false)
const bindDialog = ref(false)
const inviteTreeDialog = ref(false)
const inviteTreeFocusId = ref<number | null>(null)
const unbindDialog = ref(false)
const selectedInviteeIds = ref(new Set<number>())
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const selectedActiveCount = computed(() => selectedInviteeIds.value.size)
const allActiveSelected = computed(() => {
  const activeRows = records.value.filter((row) => isActiveInvite(row)) as AffiliateInviteRecord[]
  return activeRows.length > 0 && activeRows.every((row) => selectedInviteeIds.value.has(row.invitee_id))
})

function isActiveInvite(row: AffiliateRecord): boolean {
  return props.type === 'invites' && (row as AffiliateInviteRecord).unbound_at == null && (row as AffiliateInviteRecord).invitee_id > 0
}

function toggleSelectRow(row: AffiliateRecord, event: Event) {
  const record = row as AffiliateInviteRecord
  if (record.unbound_at != null || !record.invitee_id) return
  const next = new Set(selectedInviteeIds.value)
  if ((event.target as HTMLInputElement).checked) {
    next.add(record.invitee_id)
  } else {
    next.delete(record.invitee_id)
  }
  selectedInviteeIds.value = next
}

function toggleSelectAllActive(event: Event) {
  const next = new Set(selectedInviteeIds.value)
  const activeRows = records.value.filter((row) => isActiveInvite(row)) as AffiliateInviteRecord[]
  if ((event.target as HTMLInputElement).checked) {
    activeRows.forEach((row) => next.add(row.invitee_id))
  } else {
    activeRows.forEach((row) => next.delete(row.invitee_id))
  }
  selectedInviteeIds.value = next
}

function clearSelection() {
  selectedInviteeIds.value = new Set<number>()
}

/** 翻页/筛选后剔除不在当前页的勾选项，避免误把不可见记录批量解除。 */
function pruneSelection() {
  if (selectedInviteeIds.value.size === 0) return
  const visible = new Set(
    (records.value as AffiliateInviteRecord[]).filter((row) => row.unbound_at == null && row.invitee_id > 0).map((row) => row.invitee_id),
  )
  const next = new Set<number>()
  selectedInviteeIds.value.forEach((id) => {
    if (visible.has(id)) next.add(id)
  })
  selectedInviteeIds.value = next
}

function openInviteTree(row: AffiliateRecord) {
  const record = row as AffiliateInviteRecord
  if (!record.invitee_id) return
  inviteTreeFocusId.value = record.invitee_id
  inviteTreeDialog.value = true
}

function handleRelationChanged() {
  bindDialog.value = false
  clearSelection()
  reloadFromFirstPage()
}

async function confirmUnbind() {
  const ids = Array.from(selectedInviteeIds.value)
  if (ids.length === 0) {
    unbindDialog.value = false
    return
  }
  try {
    const unbound = await affiliatesAPI.unbindInviteBindings({ invitee_ids: ids })
    appStore.showSuccess(t('admin.affiliates.unbind.success', { count: unbound }))
    clearSelection()
    unbindDialog.value = false
    await loadRecords()
  } catch (error) {
    appStore.showError(extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('admin.affiliates.unbind.failed')))
  }
}

const columns = computed<Column[]>(() => {
  if (props.type === 'invites') {
    return [
      { key: 'select', label: '', sortable: false },
      { key: 'inviter', label: t('admin.affiliates.records.inviter'), sortable: true },
      { key: 'invitee', label: t('admin.affiliates.records.invitee'), sortable: true },
      { key: 'aff_code', label: t('admin.affiliates.records.affCode'), sortable: true },
      { key: 'total_rebate', label: t('admin.affiliates.records.totalRebate'), sortable: true },
      { key: 'status', label: t('admin.affiliates.records.status') },
      { key: 'chain', label: t('admin.affiliates.records.chainAction') },
      { key: 'created_at', label: t('admin.affiliates.records.invitedAt'), sortable: true },
    ]
  }
  if (props.type === 'rebates') {
    return [
      { key: 'order', label: t('admin.affiliates.records.order'), sortable: true },
      { key: 'inviter', label: t('admin.affiliates.records.inviter'), sortable: true },
      { key: 'invitee', label: t('admin.affiliates.records.invitee'), sortable: true },
      { key: 'order_amount', label: t('admin.affiliates.records.orderAmount'), sortable: true },
      { key: 'pay_amount', label: t('admin.affiliates.records.payAmount'), sortable: true },
      { key: 'rebate_amount', label: t('admin.affiliates.records.rebateAmount') },
      { key: 'payment_type', label: t('admin.affiliates.records.paymentType'), sortable: true },
      { key: 'order_status', label: t('admin.affiliates.records.orderStatus'), sortable: true },
      { key: 'created_at', label: t('admin.affiliates.records.rebatedAt'), sortable: true },
    ]
  }
  return [
    { key: 'user', label: t('admin.affiliates.records.user'), sortable: true },
    { key: 'action', label: t('admin.affiliates.records.outflowType'), sortable: true },
    { key: 'amount', label: t('admin.affiliates.records.transferAmount'), sortable: true },
    { key: 'balance_after', label: t('admin.affiliates.records.balanceAfter'), sortable: true },
    { key: 'available_quota_after', label: t('admin.affiliates.records.availableQuotaAfter'), sortable: true },
    { key: 'frozen_quota_after', label: t('admin.affiliates.records.frozenQuotaAfter'), sortable: true },
    { key: 'history_quota_after', label: t('admin.affiliates.records.historyQuotaAfter'), sortable: true },
    { key: 'created_at', label: t('admin.affiliates.records.transferredAt'), sortable: true },
  ]
})

const sortStorageKey = computed(() => `admin-affiliate-${props.type}-table-sort`)

function loadInitialSortState(): { sort_by: string; sort_order: 'asc' | 'desc' } {
  const fallback = { sort_by: 'created_at', sort_order: 'desc' as 'asc' | 'desc' }
  try {
    const raw = localStorage.getItem(sortStorageKey.value)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { key?: string; order?: string }
    const key = typeof parsed.key === 'string' ? parsed.key : ''
    if (!columns.value.some((column) => column.key === key && column.sortable)) return fallback
    return {
      sort_by: key,
      sort_order: parsed.order === 'asc' ? 'asc' : 'desc',
    }
  } catch {
    return fallback
  }
}

const sortState = reactive(loadInitialSortState())

function userTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

function buildParams(): ListAffiliateRecordsParams {
  return {
    page: pagination.page,
    page_size: pagination.page_size,
    search: filters.search.trim() || undefined,
    start_at: filters.start_at || undefined,
    end_at: filters.end_at || undefined,
    sort_by: sortState.sort_by,
    sort_order: sortState.sort_order,
    timezone: userTimezone(),
  }
}

async function fetchRecords(params: ListAffiliateRecordsParams): Promise<PaginatedResponse<AffiliateRecord>> {
  if (props.type === 'invites') {
    return affiliatesAPI.listInviteRecords(params)
  }
  if (props.type === 'rebates') {
    return affiliatesAPI.listRebateRecords(params)
  }
  return affiliatesAPI.listTransferRecords(params)
}

async function loadRecords() {
  loading.value = true
  try {
    const res = await fetchRecords(buildParams())
    records.value = res.items || []
    pagination.total = res.total || 0
    pruneSelection()
  } catch (error) {
    appStore.showError(extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('common.error')))
  } finally {
    loading.value = false
  }
}

function debounceLoad() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => reloadFromFirstPage(), 300)
}

function reloadFromFirstPage() {
  pagination.page = 1
  void loadRecords()
}

function handlePageChange(page: number) {
  pagination.page = page
  void loadRecords()
}

function handlePageSizeChange(size: number) {
  pagination.page_size = size
  pagination.page = 1
  void loadRecords()
}

function handleSort(key: string, order: 'asc' | 'desc') {
  sortState.sort_by = key
  sortState.sort_order = order
  pagination.page = 1
  void loadRecords()
}

function handleWithdrawSuccess() {
  withdrawDialog.value = false
  reloadFromFirstPage()
}

function outflowTypeLabel(action: string | null | undefined): string {
  return action === 'withdraw'
    ? t('admin.affiliates.outflowTypes.withdraw')
    : t('admin.affiliates.outflowTypes.transfer')
}

function formatAmount(value: number | null | undefined): string {
  return Number(value || 0).toFixed(2)
}

function formatPercent(value: number | null | undefined): string {
  const rounded = Math.round(Number(value || 0) * 100) / 100
  return `${Number.isInteger(rounded) ? rounded.toString() : rounded.toString()}%`
}

function formatDateTime(value: string | null | undefined): string {
  return value ? formatDisplayDateTime(value) : '-'
}

async function openUserOverview(userId: number) {
  if (!userId) return
  overviewDialog.value = true
  overviewLoading.value = true
  selectedOverview.value = null
  try {
    selectedOverview.value = await affiliatesAPI.getUserOverview(userId)
  } catch (error) {
    overviewDialog.value = false
    appStore.showError(extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('common.error')))
  } finally {
    overviewLoading.value = false
  }
}

const UserCell = defineComponent({
  props: {
    id: { type: Number, required: true },
    email: { type: String, default: '' },
    username: { type: String, default: '' },
    clickable: { type: Boolean, default: false },
  },
  emits: ['open'],
  setup(cellProps, { emit }) {
    return () => h('div', { class: 'space-y-0.5' }, [
      h('div', { class: 'font-mono text-sm text-gray-900 dark:text-white' }, `#${cellProps.id}`),
      h(cellProps.clickable ? 'button' : 'div', {
        class: cellProps.clickable
          ? 'max-w-56 truncate text-left text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400 dark:hover:text-primary-300'
          : 'max-w-56 truncate text-sm text-gray-700 dark:text-gray-300',
        type: cellProps.clickable ? 'button' : undefined,
        onClick: cellProps.clickable ? () => emit('open', cellProps.id) : undefined,
      }, cellProps.email || '-'),
      h('div', { class: 'max-w-56 truncate text-sm text-gray-500 dark:text-dark-400' }, cellProps.username || '-'),
    ])
  },
})

const AmountText = defineComponent({
  props: {
    value: { type: Number, default: 0 },
    strong: { type: Boolean, default: false },
  },
  setup(amountProps) {
    return () => h('span', {
      class: amountProps.strong
        ? 'text-sm font-semibold text-emerald-600 dark:text-emerald-400'
        : 'text-sm text-gray-900 dark:text-white',
    }, `$${formatAmount(amountProps.value)}`)
  },
})

const NullableAmountText = defineComponent({
  props: {
    value: { type: Number as PropType<number | null | undefined>, default: null },
  },
  setup(amountProps) {
    return () => {
      const value = amountProps.value
      if (value === null || value === undefined) {
        return h('span', { class: 'text-sm text-gray-400 dark:text-dark-500' }, '-')
      }
      return h(AmountText, { value })
    }
  },
})

const OverviewStat = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
    mono: { type: Boolean, default: false },
  },
  setup(statProps) {
    return () => h('div', { class: 'rounded-lg border border-gray-100 bg-white p-3 dark:border-dark-700 dark:bg-dark-900' }, [
      h('div', { class: 'text-sm text-gray-500 dark:text-dark-400' }, statProps.label),
      h('div', {
        class: statProps.mono
          ? 'mt-1 font-mono text-base font-semibold text-gray-900 dark:text-white'
          : 'mt-1 text-base font-semibold text-gray-900 dark:text-white',
      }, statProps.value),
    ])
  },
})

onMounted(() => {
  void loadRecords()
})
</script>
