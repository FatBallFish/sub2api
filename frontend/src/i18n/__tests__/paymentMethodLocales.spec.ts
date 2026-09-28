import { describe, expect, it } from 'vitest'

import en from '../locales/en'
import zh from '../locales/zh'

const requiredPaymentMethods = ['alipay', 'wxpay', 'stripe', 'airwallex', 'jeepay', 'paypal'] as const

describe('payment method locale keys', () => {
  it('contains zh labels for configured payment methods', () => {
    for (const method of requiredPaymentMethods) {
      expect(zh.payment.methods[method], method).toBeTruthy()
    }
  })

  it('contains en labels for configured payment methods', () => {
    for (const method of requiredPaymentMethods) {
      expect(en.payment.methods[method], method).toBeTruthy()
    }
  })
})
