import { describe, expect, it } from 'vitest'
import zh from '@/i18n/locales/zh/common'
import en from '@/i18n/locales/en/common'
import { extractI18nErrorMessage } from '@/utils/apiError'

/**
 * vite 将 vue-i18n 别名到 runtime 构建（CSP 安全），字符串消息在测试环境无法编译，
 * 这里用一个最小解析器直接对资源树做点路径查找 + {placeholder} 插值，
 * 同时覆盖组合逻辑与资源内容。
 */
function makeTranslator(messages: Record<string, unknown>) {
  const resolve = (key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        return (node as Record<string, unknown>)[part]
      }
      return undefined
    }, messages)
  const t = (key: string, params?: Record<string, string>) => {
    const template = resolve(key)
    if (typeof template !== 'string') return key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`)
  }
  const te = (key: string) => typeof resolve(key) === 'string'
  return Object.assign(t, { te })
}

const zhT = makeTranslator({ common: zh.common })
const enT = makeTranslator({ common: en.common })

// API 客户端拦截器把响应打平为 { status, code, message, reason, metadata } 后 reject。
function validationError(field: string, tag: string) {
  return {
    status: 400,
    code: 400,
    reason: 'VALIDATION_FAILED',
    message: "Invalid request: Key: 'CreateUserRequest.email' Error:Field validation for 'email' failed on the 'email' tag",
    metadata: { field, tag }
  }
}

describe('extractI18nErrorMessage VALIDATION_FAILED', () => {
  it('composes field + rule labels from metadata (zh)', () => {
    expect(
      extractI18nErrorMessage(validationError('email', 'email'), zhT as never, 'admin.users', 'fallback')
    ).toBe('「邮箱」格式不正确')
  })

  it('localizes required rule with the field label', () => {
    expect(
      extractI18nErrorMessage(validationError('password', 'required'), zhT as never, 'admin.users', 'fallback')
    ).toBe('「密码」不能为空')
  })

  it('falls back to field-only phrasing for unknown tags', () => {
    expect(
      extractI18nErrorMessage(validationError('quota', 'exotic'), zhT as never, 'admin.users', 'fallback')
    ).toBe('「额度」无效')
  })

  it('returns the generic invalid-body hint for malformed JSON (no field)', () => {
    expect(
      extractI18nErrorMessage(validationError('', 'json'), zhT as never, 'admin.users', 'fallback')
    ).toBe('请求内容格式不正确，请检查后重试')
  })

  it('renders English labels in the en locale', () => {
    expect(
      extractI18nErrorMessage(validationError('email', 'email'), enT as never, 'admin.users', 'fallback')
    ).toBe('"email address" has an invalid format')
  })
})
