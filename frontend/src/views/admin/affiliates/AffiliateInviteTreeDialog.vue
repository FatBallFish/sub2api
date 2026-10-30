<template>
  <BaseDialog
    :show="show"
    :title="t('admin.affiliates.inviteTree.title')"
    width="wide"
    @close="handleClose"
  >
    <div v-if="loading" class="flex justify-center py-12">
      <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
    </div>
    <template v-else-if="tree">
      <p class="mb-3 text-sm text-gray-500 dark:text-dark-400">
        {{ t('admin.affiliates.inviteTree.description') }}
        <span v-if="tree.truncated" class="ml-1 font-medium text-amber-600 dark:text-amber-400">
          {{ t('admin.affiliates.inviteTree.truncated') }}
        </span>
      </p>
      <div class="max-h-[60vh] overflow-y-auto rounded-lg border border-gray-100 bg-white p-4 dark:border-dark-700 dark:bg-dark-900" data-testid="invite-tree-container">
        <div
          v-for="row in treeRows"
          :key="row.node.user_id"
          class="relative flex items-start gap-2 rounded-md py-1.5 pr-2 transition-colors"
          :class="row.node.user_id === tree.focus_user_id
            ? 'bg-primary-50 ring-1 ring-primary-200 dark:bg-primary-900/20 dark:ring-primary-700/50'
            : 'hover:bg-gray-50 dark:hover:bg-dark-800'"
          :style="{ paddingLeft: `${row.depth * 1.75}rem` }"
        >
          <!-- 每层深度的竖向连接线，形成树轴 -->
          <template v-for="level in row.depth" :key="level">
            <span
              class="absolute top-0 bottom-0 w-px bg-gray-200 dark:bg-dark-700"
              :style="{ left: `${(level - 1) * 1.75 + 0.55}rem` }"
            />
          </template>
          <Icon v-if="row.depth > 0" name="link" size="sm" class="mt-1 shrink-0 text-gray-300 dark:text-dark-600" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-mono text-xs text-gray-400 dark:text-dark-500">#{{ row.node.user_id }}</span>
              <span class="text-sm font-medium" :class="row.node.deleted ? 'text-gray-400 line-through dark:text-dark-500' : 'text-gray-900 dark:text-white'">
                {{ row.node.email || '-' }}
              </span>
              <span v-if="row.node.username" class="text-xs text-gray-500 dark:text-dark-400">({{ row.node.username }})</span>
              <span v-if="row.node.aff_code" class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-dark-800 dark:text-gray-300">
                {{ row.node.aff_code }}
              </span>
              <span v-if="row.node.user_id === tree.root_user_id" class="badge badge-primary whitespace-nowrap">{{ t('admin.affiliates.inviteTree.root') }}</span>
              <span v-if="row.node.user_id === tree.focus_user_id" class="badge badge-warning whitespace-nowrap">{{ t('admin.affiliates.inviteTree.focus') }}</span>
              <span v-if="row.node.deleted" class="badge whitespace-nowrap">{{ t('admin.affiliates.inviteTree.deletedUser') }}</span>
            </div>
            <div v-if="row.node.invited_at" class="mt-0.5 text-xs text-gray-400 dark:text-dark-500">
              {{ t('admin.affiliates.records.invitedAt') }}: {{ formatDateTime(row.node.invited_at) }}
            </div>
          </div>
          <span v-if="childCount(row.node.user_id) > 0" class="shrink-0 self-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-dark-800 dark:text-gray-400">
            {{ t('admin.affiliates.inviteTree.childrenCount', { count: childCount(row.node.user_id) }) }}
          </span>
        </div>
      </div>
    </template>
    <p v-else-if="loadError" class="py-8 text-center text-sm text-red-600 dark:text-red-400">{{ loadError }}</p>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { getInviteTree, type AffiliateInviteTree, type AffiliateInviteTreeNode } from '@/api/admin/affiliates'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { formatDateTime as formatDisplayDateTime } from '@/utils/format'

const props = defineProps<{ show: boolean; focusUserId: number | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const loading = ref(false)
const tree = ref<AffiliateInviteTree | null>(null)
const loadError = ref('')

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      void loadTree()
    }
  },
)

async function loadTree() {
  if (!props.focusUserId) return
  loading.value = true
  tree.value = null
  loadError.value = ''
  try {
    tree.value = await getInviteTree(props.focusUserId)
  } catch (error) {
    loadError.value = extractI18nErrorMessage(error, t, 'admin.affiliates.errors', t('common.error'))
  } finally {
    loading.value = false
  }
}

/** children 索引：inviter_id -> 子节点列表（按邀请时间升序稳定排列）。 */
const childrenMap = computed(() => {
  const map = new Map<number, AffiliateInviteTreeNode[]>()
  if (!tree.value) return map
  for (const node of tree.value.nodes) {
    if (node.inviter_id == null) continue
    const bucket = map.get(node.inviter_id) || []
    bucket.push(node)
    map.set(node.inviter_id, bucket)
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => (a.invited_at || '').localeCompare(b.invited_at || '') || a.user_id - b.user_id)
  }
  return map
})

function childCount(userId: number): number {
  return childrenMap.value.get(userId)?.length || 0
}

/** DFS 先序展开：根在上、子级缩进，形成完整树轴。 */
const treeRows = computed<{ node: AffiliateInviteTreeNode; depth: number }[]>(() => {
  if (!tree.value) return []
  const rows: { node: AffiliateInviteTreeNode; depth: number }[] = []
  const roots = tree.value.nodes.filter((node) => node.inviter_id == null)
  const walk = (node: AffiliateInviteTreeNode, depth: number) => {
    rows.push({ node, depth })
    for (const child of childrenMap.value.get(node.user_id) || []) {
      walk(child, depth + 1)
    }
  }
  // 常规情况只有一个根（root_user_id）；防御性地渲染所有无父节点。
  for (const root of roots.length > 0 ? roots : tree.value.nodes) {
    walk(root, 0)
  }
  return rows
})

function handleClose() {
  emit('close')
}

function formatDateTime(value: string | null | undefined): string {
  return value ? formatDisplayDateTime(value) : '-'
}
</script>
