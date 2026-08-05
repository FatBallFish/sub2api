import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminOrdersView from '../AdminOrdersView.vue'
import type { PaymentOrder } from '@/types/payment'

const mocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
  refundOrder: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}))

vi.mock('@/api/admin/payment', () => {
  const adminPaymentAPI = {
    getOrders: mocks.getOrders,
    getOrder: vi.fn(),
    cancelOrder: vi.fn(),
    retryRecharge: vi.fn(),
    refundOrder: mocks.refundOrder,
    queryRefund: vi.fn(),
  }
  return { adminPaymentAPI, default: adminPaymentAPI }
})

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showError: mocks.showError,
    showSuccess: mocks.showSuccess,
  }),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}))

const order = {
  id: 42,
  out_trade_no: 'order-42',
  status: 'COMPLETED',
  order_type: 'balance',
  payment_type: 'stripe',
  amount: 100,
  pay_amount: 100,
  fee_rate: 0,
  refund_amount: 0,
  currency: 'USD',
  created_at: '2026-08-06T00:00:00Z',
  expires_at: '2026-08-06T01:00:00Z',
} as PaymentOrder

describe('AdminOrdersView refund force flow', () => {
  beforeEach(() => {
    mocks.getOrders.mockReset().mockResolvedValue({
      data: { items: [order], total: 1, page: 1, page_size: 20 },
    })
    mocks.refundOrder.mockReset()
    mocks.showError.mockReset()
    mocks.showSuccess.mockReset()
  })

  it('keeps the dialog open and requires explicit force confirmation', async () => {
    mocks.refundOrder
      .mockResolvedValueOnce({
        data: {
          success: false,
          require_force: true,
          warning: 'user balance is insufficient for deduction, use force',
        },
      })
      .mockResolvedValueOnce({ data: { success: true } })

    const wrapper = mount(AdminOrdersView, {
      global: {
        stubs: {
          AppLayout: { template: '<main><slot /></main>' },
          OrderTable: {
            props: ['orders'],
            template: '<div><div v-for="row in orders" :key="row.id"><slot name="actions" :row="row" /></div></div>',
          },
          BaseDialog: {
            props: ['show'],
            template: '<section v-if="show" data-testid="refund-dialog"><slot /><slot name="footer" /></section>',
          },
          Pagination: true,
          Select: true,
          Icon: true,
          OrderStatusBadge: true,
        },
      },
    })
    await flushPromises()

    const refundButton = wrapper.findAll('button').find((button) => button.text() === 'payment.admin.refund')
    expect(refundButton).toBeDefined()
    await refundButton!.trigger('click')
    await wrapper.get('#refund-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="refund-dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('user balance is insufficient for deduction, use force')
    expect(wrapper.find('#force-refund').exists()).toBe(true)
    expect(wrapper.get('button[form="refund-form"]').attributes('disabled')).toBeDefined()
    expect(mocks.refundOrder).toHaveBeenNthCalledWith(1, 42, expect.objectContaining({ force: false }))

    await wrapper.get('#force-refund').setValue(true)
    expect(wrapper.get('button[form="refund-form"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('#refund-form').trigger('submit')
    await flushPromises()

    expect(mocks.refundOrder).toHaveBeenNthCalledWith(2, 42, expect.objectContaining({ force: true }))
    expect(wrapper.find('[data-testid="refund-dialog"]').exists()).toBe(false)
    expect(mocks.showError).not.toHaveBeenCalled()
  })
})
