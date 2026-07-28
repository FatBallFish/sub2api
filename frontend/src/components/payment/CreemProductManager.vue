<template>
  <section class="space-y-3 border-t border-gray-200 pt-4 dark:border-dark-700">
    <div class="flex items-center justify-between">
      <div>
        <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Creem Products</h4>
        <p class="mt-1 text-xs text-gray-500">Only active one-time Products can be bound.</p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" @click="showCreate = !showCreate">{{ showCreate ? 'Cancel' : 'Add Product' }}</button>
    </div>

    <form v-if="showCreate" class="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 p-3 dark:border-dark-600" @submit.prevent="createBinding">
      <input v-model.trim="draft.product_id" class="input col-span-2" required placeholder="Product ID" />
      <select v-model="draft.target_type" class="input">
        <option value="balance">Balance</option>
        <option value="group_plan">Group plan</option>
        <option value="global_plan">Global plan</option>
      </select>
      <input v-if="draft.target_type === 'balance'" v-model.number="draft.credited_balance" class="input" type="number" min="0.01" step="0.01" required placeholder="Credited balance" />
      <select v-else v-model.number="draft.plan_id" class="input" required>
        <option :value="0" disabled>Select plan</option>
        <option v-for="plan in matchingPlans" :key="plan.id" :value="plan.id">{{ plan.name }} - {{ plan.price }}</option>
      </select>
      <input v-model.number="draft.sort_order" class="input" type="number" placeholder="Sort order" />
      <button type="submit" class="btn btn-primary" :disabled="busy">Resolve and bind</button>
    </form>

    <p v-if="error" class="text-xs text-red-600">{{ error }}</p>
    <div v-if="bindings.length" class="overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-600">
      <table class="min-w-full text-xs">
        <thead class="bg-gray-50 text-left text-gray-500 dark:bg-dark-700"><tr><th class="p-2">Product</th><th class="p-2">Price</th><th class="p-2">Target</th><th class="p-2">Health</th><th class="p-2 text-right">Actions</th></tr></thead>
        <tbody class="divide-y divide-gray-100 dark:divide-dark-700">
          <tr v-for="binding in bindings" :key="binding.id">
            <td class="p-2"><div class="font-medium">{{ binding.product_name || binding.external_product_id }}</div><div class="text-gray-400">{{ binding.external_product_id }}</div></td>
            <td class="p-2">{{ formatMinor(binding.price_minor, binding.currency) }}<div class="text-gray-400">{{ binding.billing_type }} · {{ binding.environment }}</div></td>
            <td class="p-2">{{ binding.target_type }}<div class="text-gray-400">{{ binding.plan_id ? `Plan #${binding.plan_id}` : `+${binding.credited_balance}` }}</div></td>
            <td class="p-2"><span :class="binding.health_status === 'healthy' ? 'text-green-600' : 'text-amber-600'">{{ binding.health_status }}</span><div v-if="binding.health_reason" class="max-w-48 truncate text-gray-400" :title="binding.health_reason">{{ binding.health_reason }}</div></td>
            <td class="p-2 text-right whitespace-nowrap">
              <button type="button" class="mr-2 text-primary-600" @click="toggleBinding(binding)">{{ binding.enabled ? 'Disable' : 'Enable' }}</button>
              <button type="button" class="mr-2 text-primary-600" @click="syncBinding(binding.id)">Sync</button>
              <button type="button" class="text-red-600" @click="deleteBinding(binding.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!busy" class="text-xs text-gray-500">No Creem Products configured.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { CreemProductBinding, SubscriptionPlan } from '@/types/payment'

const props = defineProps<{ providerId: number }>()
const bindings = ref<CreemProductBinding[]>([])
const plans = ref<SubscriptionPlan[]>([])
const busy = ref(false)
const error = ref('')
const showCreate = ref(false)
const draft = reactive({ product_id: '', target_type: 'balance' as 'balance' | 'group_plan' | 'global_plan', plan_id: 0, credited_balance: 0, sort_order: 0 })
const matchingPlans = computed(() => plans.value.filter(plan => plan.plan_scope === (draft.target_type === 'global_plan' ? 'global' : 'group')))

async function load() {
  busy.value = true
  error.value = ''
  try {
	const adminPaymentAPI = (await import('@/api/admin/payment')).default
    const [bindingResp, planResp] = await Promise.all([adminPaymentAPI.getCreemProducts(props.providerId), adminPaymentAPI.getPlans()])
    bindings.value = bindingResp.data || []
    plans.value = planResp.data || []
  } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Failed to load Creem Products.' }
  finally { busy.value = false }
}

async function createBinding() {
  busy.value = true
  error.value = ''
  try {
	const adminPaymentAPI = (await import('@/api/admin/payment')).default
    await adminPaymentAPI.createCreemProduct(props.providerId, {
      product_id: draft.product_id, target_type: draft.target_type,
      plan_id: draft.target_type === 'balance' ? null : draft.plan_id,
      credited_balance: draft.target_type === 'balance' ? draft.credited_balance : null,
      enabled: true, sort_order: draft.sort_order,
    })
    showCreate.value = false
    draft.product_id = ''
    await load()
  } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Failed to bind Product.' }
  finally { busy.value = false }
}

async function toggleBinding(binding: CreemProductBinding) {
	const adminPaymentAPI = (await import('@/api/admin/payment')).default
  await adminPaymentAPI.updateCreemProduct(props.providerId, binding.id, { enabled: !binding.enabled })
  await load()
}
async function syncBinding(id: number) { const api = (await import('@/api/admin/payment')).default; await api.syncCreemProduct(props.providerId, id); await load() }
async function deleteBinding(id: number) { if (window.confirm('Delete this Creem Product binding?')) { const api = (await import('@/api/admin/payment')).default; await api.deleteCreemProduct(props.providerId, id); await load() } }
function formatMinor(value: number, currency: string) { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value / 100) }

onMounted(load)
</script>
